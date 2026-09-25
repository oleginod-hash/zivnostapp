import fs from 'node:fs'
import path from 'node:path'
import { db, FILES_DIR } from '../db.js'

/**
 * História zmien, ktoré v dátach urobil AI pomocník.
 *
 * Pred každým zápisom si odložíme predchádzajúci stav záznamu, takže sa
 * dá vrátiť späť. Týka sa to VÝHRADNE zmien od asistenta – to, čo používateľ
 * urobí ručne v appke, sem nepatrí a vrátiť sa nedá.
 */

export type Operacia = 'vytvorenie' | 'uprava'

type Prilohy = { tabulka: string; kluc: string; priecinok: string }

/**
 * Tabuľky, ktoré smie undo a kôš obnoviť, a ako sa volajú v odpovedi
 * používateľovi. Pri každej je aj to, čo k záznamu patrí v iných tabuľkách –
 * databáza to pri zmazaní záznamu odstráni, preto si to odkladáme spolu s ním.
 */
export const ENTITY: Record<string, { nazov: string; polozky?: string; platby?: boolean; prilohy?: Prilohy }> = {
  invoices: { nazov: 'faktúra', polozky: 'invoice_items', platby: true },
  companies: { nazov: 'firma' },
  contracts: { nazov: 'zmluva', prilohy: { tabulka: 'contract_files', kluc: 'contract_id', priecinok: 'zmluvy' } },
  tours: { nazov: 'turnus' },
  orders: { nazov: 'objednávka' },
  expenses: { nazov: 'výdavok', prilohy: { tabulka: 'expense_files', kluc: 'expense_id', priecinok: 'doklady' } },
  settings: { nazov: 'nastavenia' },
}

/**
 * Celý stav záznamu vrátane toho, čo k nemu patrí: položky a platby faktúry,
 * zálohové faktúry, ktoré ju kryjú, a prílohy zmlúv a výdavkov. Kľúče
 * s podčiarkovníkom nie sú stĺpce tabuľky.
 */
export function nacitajStav(tabulka: string, id: number): any | null {
  const entita = ENTITY[tabulka]
  if (!entita) return null
  const riadok = db.prepare(`SELECT * FROM ${tabulka} WHERE id = ?`).get(id)
  if (!riadok) return null

  const stav: any = { ...(riadok as object) }
  if (entita.polozky) {
    stav._polozky = db.prepare(`SELECT * FROM ${entita.polozky} WHERE invoice_id = ? ORDER BY poradie, id`).all(id)
  }
  if (entita.platby) {
    stav._platby = db
      .prepare('SELECT datum, suma, poznamka, created_at FROM invoice_payments WHERE invoice_id = ? ORDER BY datum, id')
      .all(id)
    stav._kryte_zalohami = (db.prepare('SELECT id FROM invoices WHERE kryje_id = ?').all(id) as { id: number }[]).map(
      (r) => r.id,
    )
  }
  if (entita.prilohy) {
    const p = entita.prilohy
    stav._prilohy = db
      .prepare(`SELECT nazov, ulozeny_nazov, velkost, mime, created_at FROM ${p.tabulka} WHERE ${p.kluc} = ? ORDER BY id`)
      .all(id)
  }
  return stav
}

/** Len skutočné stĺpce zo zálohovaného stavu – bez naviazaných zoznamov. */
export function stlpceStavu(stav: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(stav).filter(([k]) => !k.startsWith('_')))
}

/** Vráti položky faktúry zo zálohovaného stavu. */
export function obnovPolozky(tabulka: string, id: number, stav: any) {
  const entita = ENTITY[tabulka]
  if (!entita?.polozky || !Array.isArray(stav._polozky)) return
  db.prepare(`DELETE FROM ${entita.polozky} WHERE invoice_id = ?`).run(id)
  const vloz = db.prepare(
    `INSERT INTO ${entita.polozky} (invoice_id, poradie, popis, mnozstvo, jednotka, cena) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  for (const p of stav._polozky) vloz.run(id, p.poradie, p.popis, p.mnozstvo, p.jednotka, p.cena)
}

/**
 * Vráti platby faktúry zo zálohovaného stavu. Staršie zálohy (spred tejto
 * úpravy) zoznam platieb nemajú – vtedy platby nechávame, ako sú.
 */
export function obnovPlatby(tabulka: string, id: number, stav: any) {
  if (!ENTITY[tabulka]?.platby || !Array.isArray(stav._platby)) return
  db.prepare('DELETE FROM invoice_payments WHERE invoice_id = ?').run(id)
  const vloz = db.prepare(
    `INSERT INTO invoice_payments (invoice_id, datum, suma, poznamka, created_at)
     VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  )
  for (const p of stav._platby) vloz.run(id, p.datum, p.suma, p.poznamka ?? '', p.created_at ?? null)
}

/** Súbory príloh na disku, ktoré k záznamu patria. */
export function suboryPriloh(tabulka: string, prilohy: { ulozeny_nazov: string }[] | undefined): string[] {
  const p = ENTITY[tabulka]?.prilohy
  if (!p || !Array.isArray(prilohy)) return []
  return prilohy.map((x) => path.join(FILES_DIR, p.priecinok, x.ulozeny_nazov))
}

/**
 * Zmaže súbory z disku – ale len tie, na ktoré už žiadny záznam neodkazuje.
 * Chyba pri mazaní nevadí: súbor mohol zmiznúť už predtým.
 */
export function zmazSubory(tabulka: string, subory: string[]) {
  const p = ENTITY[tabulka]?.prilohy
  if (!p) return
  const pouzivany = db.prepare(`SELECT 1 FROM ${p.tabulka} WHERE ulozeny_nazov = ?`)
  for (const cesta of subory) {
    if (pouzivany.get(path.basename(cesta))) continue
    try {
      fs.unlinkSync(cesta)
    } catch {
      /* už neexistuje */
    }
  }
}

export function zapisZmenu(vstup: {
  conversation_id: number | null
  nastroj: string
  tabulka: string
  zaznam_id: number
  operacia: Operacia
  stav_pred: any | null
  popis: string
}) {
  // Konverzácia mohla medzitým zaniknúť – zmenu si vtedy odložíme bez väzby na ňu,
  // nech kvôli tomu nespadne samotný zápis dát.
  const konverzaciaExistuje =
    vstup.conversation_id != null &&
    !!db.prepare('SELECT 1 FROM ai_conversations WHERE id = ?').get(vstup.conversation_id)

  db.prepare(
    `INSERT INTO ai_zmeny (conversation_id, nastroj, tabulka, zaznam_id, operacia, stav_pred, popis)
     VALUES (@conversation_id, @nastroj, @tabulka, @zaznam_id, @operacia, @stav_pred, @popis)`,
  ).run({
    ...vstup,
    conversation_id: konverzaciaExistuje ? vstup.conversation_id : null,
    stav_pred: vstup.stav_pred ? JSON.stringify(vstup.stav_pred) : null,
  })
}

export type Zmena = {
  id: number
  conversation_id: number | null
  nastroj: string
  tabulka: string
  zaznam_id: number
  operacia: Operacia
  stav_pred: string | null
  popis: string
  vratene: number
  created_at: string
}

export function zoznamZmien(conversation_id: number | null, limit = 10): Zmena[] {
  const kde = conversation_id ? 'WHERE conversation_id = @conversation_id' : ''
  return db
    .prepare(`SELECT * FROM ai_zmeny ${kde} ORDER BY id DESC LIMIT @limit`)
    .all({ conversation_id, limit }) as Zmena[]
}

/**
 * Vráti jednu zmenu späť.
 *
 * Pri úprave obnoví pôvodné hodnoty vrátane položiek a platieb faktúry. Pri
 * vytvorení odstráni záznam, ktorý asistent práve založil – to je jediné
 * miesto v celej appke, kde sa niečo maže automaticky, a týka sa výhradne
 * záznamov, ktoré pred jeho akciou neexistovali. Údaje, ktoré si používateľ
 * zapísal sám, sa takto zmazať nedajú.
 */
export function vratZmenu(zmena: Zmena): { ok: boolean; sprava: string } {
  if (zmena.vratene) return { ok: false, sprava: 'Táto zmena už bola vrátená.' }
  const entita = ENTITY[zmena.tabulka]
  if (!entita) return { ok: false, sprava: `Neznámy typ záznamu (${zmena.tabulka}).` }

  const existuje = db.prepare(`SELECT 1 FROM ${zmena.tabulka} WHERE id = ?`).get(zmena.zaznam_id)
  let suboryNaZmazanie: string[] = []

  const vykonaj = db.transaction(() => {
    if (zmena.operacia === 'vytvorenie') {
      if (!existuje) return `${entita.nazov} už neexistuje, nie je čo vrátiť.`
      // Doklady, ktoré asistent k záznamu priložil, by inak ostali na disku bez majiteľa.
      suboryNaZmazanie = suboryPriloh(zmena.tabulka, nacitajStav(zmena.tabulka, zmena.zaznam_id)?._prilohy)
      db.prepare(`DELETE FROM ${zmena.tabulka} WHERE id = ?`).run(zmena.zaznam_id)
      return `Odstránil som záznam, ktorý som predtým vytvoril (${entita.nazov}: ${zmena.popis}).`
    }

    // Úprava – vrátime pôvodné hodnoty.
    const pred = zmena.stav_pred ? JSON.parse(zmena.stav_pred) : null
    if (!pred) return 'Pôvodný stav sa nepodarilo načítať.'
    if (!existuje) return `${entita.nazov} medzitým zanikla, nedá sa obnoviť.`

    const { id: _id, ...stlpce } = stlpceStavu(pred)
    const set = Object.keys(stlpce)
      .map((k) => `${k} = @${k}`)
      .join(', ')
    db.prepare(`UPDATE ${zmena.tabulka} SET ${set} WHERE id = @__id`).run({ ...stlpce, __id: zmena.zaznam_id })
    obnovPolozky(zmena.tabulka, zmena.zaznam_id, pred)
    obnovPlatby(zmena.tabulka, zmena.zaznam_id, pred)
    return `Vrátil som do pôvodného stavu: ${entita.nazov} – ${zmena.popis}.`
  })

  const sprava = vykonaj()
  db.prepare('UPDATE ai_zmeny SET vratene = 1 WHERE id = ?').run(zmena.id)
  zmazSubory(zmena.tabulka, suboryNaZmazanie)
  return { ok: true, sprava }
}
