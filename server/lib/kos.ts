import { db } from '../db.js'
import {
  ENTITY, nacitajStav, obnovPlatby, obnovPolozky, stlpceStavu, suboryPriloh, zmazSubory,
} from './historiaZmien.js'

/**
 * Kôš. Mazanie v appke znamená presun sem, nie stratu – záznam sa dá do
 * 30 dní vrátiť. Ukladáme celý snapshot vrátane naviazaných položiek, platieb
 * a príloh, takže obnovenie vráti aj pôvodné ID a väzby ostanú platné.
 * Súbory príloh ostávajú na disku, kým je záznam v koši; zmiznú až s ním.
 */
const DNI_V_KOSI = 30

export type PolozkaKosa = {
  id: number
  tabulka: string
  zaznam_id: number
  stav: string
  popis: string
  zmazane_at: string
}

/** Presunie záznam do koša a odstráni ho z pôvodnej tabuľky. */
export function doKosa(tabulka: string, id: number, popis: string): boolean {
  const entita = ENTITY[tabulka]
  if (!entita) throw new Error(`Neznámy typ záznamu (${tabulka}).`)

  const stav = nacitajStav(tabulka, id)
  if (!stav) return false

  const presun = db.transaction(() => {
    db.prepare('INSERT INTO kos (tabulka, zaznam_id, stav, popis) VALUES (?, ?, ?, ?)').run(
      tabulka,
      id,
      JSON.stringify(stav),
      popis,
    )
    db.prepare(`DELETE FROM ${tabulka} WHERE id = ?`).run(id)
  })
  presun()
  return true
}

export function zoznamKosa(): (PolozkaKosa & { nazov_typu: string })[] {
  const riadky = db
    .prepare("SELECT * FROM kos WHERE zmazane_at > datetime('now', ?) ORDER BY id DESC")
    .all(`-${DNI_V_KOSI} days`) as PolozkaKosa[]
  return riadky.map((r) => ({ ...r, nazov_typu: ENTITY[r.tabulka]?.nazov ?? r.tabulka }))
}

/** Vráti záznam z koša späť aj s pôvodným ID. */
export function obnovZKosa(kosId: number): { ok: boolean; sprava: string } {
  const polozka = db.prepare('SELECT * FROM kos WHERE id = ?').get(kosId) as PolozkaKosa | undefined
  if (!polozka) return { ok: false, sprava: 'Položka v koši neexistuje.' }

  const entita = ENTITY[polozka.tabulka]
  if (!entita) return { ok: false, sprava: `Neznámy typ záznamu (${polozka.tabulka}).` }

  const uzExistuje = db.prepare(`SELECT 1 FROM ${polozka.tabulka} WHERE id = ?`).get(polozka.zaznam_id)
  if (uzExistuje) return { ok: false, sprava: 'Záznam s týmto číslom už zase existuje.' }

  const stav = JSON.parse(polozka.stav)
  const stlpce = stlpceStavu(stav)
  const id = polozka.zaznam_id

  // Faktúru, ktorú zálohová faktúra kryla, mohol medzitým niekto zmazať.
  // Zálohu vrátime aj tak, len bez tej väzby.
  if (polozka.tabulka === 'invoices' && stlpce.kryje_id) {
    if (!db.prepare('SELECT 1 FROM invoices WHERE id = ?').get(stlpce.kryje_id)) stlpce.kryje_id = null
  }

  try {
    const obnov = db.transaction(() => {
      const kluce = Object.keys(stlpce)
      db.prepare(
        `INSERT INTO ${polozka.tabulka} (${kluce.join(', ')}) VALUES (${kluce.map((k) => '@' + k).join(', ')})`,
      ).run(stlpce)

      obnovPolozky(polozka.tabulka, id, stav)
      obnovPlatby(polozka.tabulka, id, stav)

      // Zálohové faktúry, ktoré túto faktúru kryli, pri jej zmazaní väzbu stratili.
      if (entita.platby && Array.isArray(stav._kryte_zalohami)) {
        const naviaz = db.prepare(
          "UPDATE invoices SET kryje_id = ? WHERE id = ? AND kryje_id IS NULL AND typ = 'zaloha'",
        )
        for (const zalohaId of stav._kryte_zalohami) naviaz.run(id, zalohaId)
      }

      if (entita.prilohy && Array.isArray(stav._prilohy)) {
        const p = entita.prilohy
        const vloz = db.prepare(
          `INSERT INTO ${p.tabulka} (${p.kluc}, nazov, ulozeny_nazov, velkost, mime, created_at)
           VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
        )
        for (const s of stav._prilohy) vloz.run(id, s.nazov, s.ulozeny_nazov, s.velkost, s.mime, s.created_at ?? null)
      }

      db.prepare('DELETE FROM kos WHERE id = ?').run(kosId)
    })
    obnov()
    return { ok: true, sprava: `${entita.nazov} je späť.` }
  } catch (e: any) {
    // Typicky keď medzitým zanikla firma alebo turnus, na ktorý sa záznam viazal,
    // alebo keď už existuje faktúra s rovnakým číslom.
    return { ok: false, sprava: `Obnoviť sa nepodarilo: ${e.message}` }
  }
}

/**
 * Nenávratne odstráni položky koša aj so súbormi ich príloh. Súbory mažeme až
 * po zmazaní z databázy – keby niečo zlyhalo, radšej ostane súbor navyše.
 */
function odstranNavzdy(riadky: PolozkaKosa[]): number {
  if (!riadky.length) return 0
  const zmaz = db.prepare('DELETE FROM kos WHERE id = ?')
  const vymaz = db.transaction(() => riadky.reduce((n, r) => n + zmaz.run(r.id).changes, 0))
  const pocet = vymaz()

  for (const r of riadky) {
    if (!ENTITY[r.tabulka]?.prilohy) continue
    try {
      zmazSubory(r.tabulka, suboryPriloh(r.tabulka, JSON.parse(r.stav)._prilohy))
    } catch {
      /* poškodený záznam v koši – súbory necháme tak */
    }
  }
  return pocet
}

/** Nenávratné zmazanie jednej položky z koša. */
export function vysypJednu(kosId: number): boolean {
  return odstranNavzdy(db.prepare('SELECT * FROM kos WHERE id = ?').all(kosId) as PolozkaKosa[]) > 0
}

/**
 * Nenávratné zmazanie viacerých položiek naraz. Bez zoznamu id vysype
 * celý kôš – to je jediné miesto v appke, kde sa dáta naozaj stratia.
 */
export function vysypVybrane(idcka?: number[]): number {
  if (!idcka) return odstranNavzdy(db.prepare('SELECT * FROM kos').all() as PolozkaKosa[])
  if (!idcka.length) return 0
  const otazniky = idcka.map(() => '?').join(', ')
  return odstranNavzdy(db.prepare(`SELECT * FROM kos WHERE id IN (${otazniky})`).all(...idcka) as PolozkaKosa[])
}

/**
 * Vrátenie viacerých položiek naraz. Každú skúsime zvlášť – keď sa jedna
 * nedá obnoviť (napr. jej firma medzitým zmizla), ostatné to nezastaví.
 */
export function obnovVybrane(idcka: number[]): { vratene: number; chyby: string[] } {
  let vratene = 0
  const chyby: string[] = []
  for (const id of idcka) {
    const v = obnovZKosa(id)
    if (v.ok) vratene++
    else chyby.push(v.sprava)
  }
  return { vratene, chyby }
}

/** Automatické upratanie – čo je v koši dlhšie než 30 dní, zmizne aj so súbormi. */
export function upracKos(): number {
  return odstranNavzdy(
    db.prepare("SELECT * FROM kos WHERE zmazane_at <= datetime('now', ?)").all(`-${DNI_V_KOSI} days`) as PolozkaKosa[],
  )
}
