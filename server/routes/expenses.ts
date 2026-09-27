import { Router } from 'express'
import fs from 'node:fs'
import multer from 'multer'
import { db } from '../db.js'
import { doKosa } from '../lib/kos.js'
import { hladajVStlpcoch, skDatum, vzorHladania, zaokruhli } from '../lib/format.js'
import { prilohyModul } from '../lib/prilohy.js'
import { jeMena, kurzPreDoklad, naEura } from '../lib/kurzy.js'
import { citajEfakturu } from '../lib/efaktura.js'

export const expensesRouter = Router()

const subory = prilohyModul({
  tabulka: 'expense_files',
  cudziKluc: 'expense_id',
  rodic: 'expenses',
  priecinok: 'doklady',
  // K e-faktúre (XML) sa priloží aj PDF, ktoré je v nej vložené – XML sa čítať nedá.
  doplnPrilohy: (cesta, nazov) => {
    if (!/\.xml$/i.test(nazov)) return []
    try {
      const pdf = citajEfakturu(fs.readFileSync(cesta)).pdf
      return pdf ? [{ nazov: pdf.nazov, data: pdf.data, mime: 'application/pdf' }] : []
    } catch {
      return []
    }
  },
})
expensesRouter.use(subory.router)

const PLATBY = ['karta', 'hotovost', 'prevod', 'ine'] as const
const POLIA = ['datum', 'popis', 'kategoria', 'platba', 'poznamka'] as const
/** Údaje z e-faktúry – pri úprave, ktorá ich nepošle (napr. asistent), ostávajú. */
const POLIA_DOKLADU = ['doklad_cislo', 'dodavatel_ico', 'variabilny'] as const
const STLPCE = [...POLIA, ...POLIA_DOKLADU, 'druh', 'company_id', 'tour_id', 'suma', 'odpocitat', 'mena', 'suma_mena', 'kurz', 'dph']

/**
 * V tejto tabuľke sú aj súkromné príjmy. Na bankovom výpise chodia spolu
 * s výdavkami, takže sa zadávajú na jednom mieste – ale do podnikania
 * nepatria: nie sú príjmom pre daň ani daňovým výdavkom.
 */
const DRUHY = ['vydavok', 'prijem'] as const
export type Druh = (typeof DRUHY)[number]

function telo(body: any) {
  const h: Record<string, unknown> = {}
  for (const p of POLIA) h[p] = String(body?.[p] ?? '').trim()
  if (!PLATBY.includes(h.platba as any)) h.platba = 'karta'
  h.druh = DRUHY.includes(body?.druh) ? body.druh : 'vydavok'
  h.company_id = body?.company_id ? Number(body.company_id) : null
  h.tour_id = body?.tour_id ? Number(body.tour_id) : null
  h.suma = zaokruhli(Number(body?.suma) || 0)
  // DPH z dokladu – platiteľ si ju odpočíta (pri súkromnom príjme nemá zmysel).
  h.dph = h.druh === 'prijem' ? 0 : zaokruhli(Number(body?.dph) || 0)
  for (const p of POLIA_DOKLADU) h[p] = String(body?.[p] ?? '').trim()
  // Súkromný príjem nie je výdavok, takže sa nedá odpočítať – aj keby to
  // niekto poslal, prepíšeme to, nech sa to nedostane do daňového podkladu.
  h.odpocitat = h.druh === 'prijem' || body?.odpocitat === false || body?.odpocitat === 0 ? 0 : 1

  // Výdavok spadajúci do obdobia turnusu sa k nemu priradí sám – nemá zmysel
  // pri každom bločku z cesty znova vyberať turnus zo zoznamu.
  // `bezTurnusu: true` znamená, že používateľ turnus vedome odobral.
  if (h.druh === 'vydavok' && !h.tour_id && !body?.bezTurnusu && h.datum) {
    h.tour_id = najdiTurnusPreDatum(String(h.datum))
  }
  return h
}

const zadana = (v: unknown) => v !== undefined && v !== null && v !== '' && Number(v) !== 0

/**
 * Výdavok v cudzej mene. Všetky súčty a daň pracujú so sumou v eurách –
 * tá sa dopočíta z kurzu ECB, alebo ju používateľ zadá sám (napr. podľa výpisu
 * z banky, keď sa platilo kartou). Vráti chybu, keď sa suma v eurách nedá určiť.
 */
async function doplnMenu(h: Record<string, unknown>, body: any): Promise<string | null> {
  const mena = String(body?.mena ?? 'EUR').trim().toUpperCase() || 'EUR'
  if (!jeMena(mena)) return 'Neznáma mena.'
  h.mena = mena
  if (mena === 'EUR') {
    h.suma_mena = null
    h.kurz = null
    return null
  }
  const sumaMena = Number(body?.suma_mena)
  if (!Number.isFinite(sumaMena) || sumaMena === 0) return `Zadaj sumu v ${mena}.`
  h.suma_mena = zaokruhli(sumaMena)
  const sumaZadana = zadana(body?.suma)
  let kurz = Number(body?.kurz) > 0 ? Number(body.kurz) : null
  // Suma v eurách aj v mene bez kurzu – kurz je ich podiel.
  if (!kurz && sumaZadana) kurz = Math.abs(sumaMena / Number(body.suma))
  if (!kurz) {
    try {
      kurz = (await kurzPreDoklad(mena, String(h.datum))).kurz
    } catch (e: any) {
      return e.message
    }
  }
  h.kurz = Math.round(kurz * 1e6) / 1e6
  if (!sumaZadana) h.suma = naEura(sumaMena, h.kurz as number)
  return null
}

/** Tá istá faktúra od toho istého dodávateľa už je zapísaná? */
function zapisanaEfaktura(ico: string, cislo: string, okremId?: number | string) {
  if (!ico || !cislo) return undefined
  return db
    .prepare('SELECT id, datum, popis FROM expenses WHERE dodavatel_ico = ? AND doklad_cislo = ? AND id <> ?')
    .get(ico, cislo, Number(okremId) || 0) as { id: number; datum: string; popis: string } | undefined
}

/** Turnus, do ktorého obdobia dátum spadá. Pri prekryve vyhrá ten, čo začal neskôr. */
export function najdiTurnusPreDatum(datum: string): number | null {
  const t = db
    .prepare(
      `SELECT id FROM tours
       WHERE zruseny = 0 AND ? BETWEEN datum_od AND datum_do
       ORDER BY datum_od DESC LIMIT 1`,
    )
    .get(datum) as { id: number } | undefined
  return t?.id ?? null
}

// ── Zoznam ────────────────────────────────────────────────────
expensesRouter.get('/', (req, res) => {
  const podmienky: string[] = []
  const params: Record<string, unknown> = {}

  if (req.query.od) {
    podmienky.push('v.datum >= @od')
    params.od = String(req.query.od)
  }
  if (req.query.do) {
    podmienky.push('v.datum <= @do')
    params.do = String(req.query.do)
  }
  if (req.query.druh === 'vydavok' || req.query.druh === 'prijem') {
    podmienky.push('v.druh = @druh')
    params.druh = String(req.query.druh)
  }
  if (req.query.kategoria) {
    podmienky.push('v.kategoria = @kategoria')
    params.kategoria = String(req.query.kategoria)
  }
  // Nie je to kategória, ale v zozname sa vyberá z toho istého miesta –
  // „ukáž mi všetko, čo ide do daňového podkladu" je najčastejšia otázka.
  if (req.query.uznatelne === '1') podmienky.push('v.odpocitat = 1')
  if (req.query.uznatelne === '0') podmienky.push('v.odpocitat = 0')
  if (req.query.turnus) {
    podmienky.push('v.tour_id = @turnus')
    params.turnus = Number(req.query.turnus)
  }
  const hladat = String(req.query.hladat ?? '').trim()
  if (hladat) {
    podmienky.push(hladajVStlpcoch(['v.popis', 'v.poznamka', 'v.kategoria', 't.nazov']))
    params.q = vzorHladania(hladat)
  }

  const where = podmienky.length ? 'WHERE ' + podmienky.join(' AND ') : ''
  res.json(
    db
      .prepare(
        `SELECT v.*, t.nazov AS turnus_nazov, c.nazov AS firma_nazov,
                (SELECT COUNT(*) FROM expense_files f WHERE f.expense_id = v.id) AS pocet_priloh
         FROM expenses v
         LEFT JOIN tours t ON t.id = v.tour_id
         LEFT JOIN companies c ON c.id = v.company_id
         ${where}
         ORDER BY v.datum DESC, v.id DESC`,
      )
      .all(params),
  )
})

/** Kategórie, ktoré už používateľ použil – dopĺňajú prednastavený zoznam. */
expensesRouter.get('/kategorie', (req, res) => {
  const k = db
    .prepare(
      `SELECT DISTINCT kategoria FROM expenses
       WHERE kategoria <> '' AND (@druh = '' OR druh = @druh)
       ORDER BY kategoria COLLATE NOCASE`,
    )
    .all({ druh: String(req.query.druh ?? '') }) as { kategoria: string }[]
  res.json(k.map((x) => x.kategoria))
})

/** Súčty za rovnaký filter, aké práve vidí zoznam. */
expensesRouter.get('/suhrn', (req, res) => {
  const r = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN druh = 'vydavok' THEN suma END), 0) AS vydavky,
         COALESCE(SUM(CASE WHEN druh = 'vydavok' AND odpocitat = 1 THEN suma END), 0) AS uznatelne,
         COALESCE(SUM(CASE WHEN druh = 'prijem' THEN suma END), 0) AS sukromne_prijmy,
         COALESCE(SUM(CASE WHEN druh = 'vydavok' THEN 1 END), 0) AS pocet_vydavkov,
         COALESCE(SUM(CASE WHEN druh = 'prijem' THEN 1 END), 0) AS pocet_prijmov
       FROM expenses
       WHERE (@od = '' OR datum >= @od) AND (@do = '' OR datum <= @do)`,
    )
    .get({ od: String(req.query.od ?? ''), do: String(req.query.do ?? '') })
  res.json(r)
})

/** Kurz ECB pre výdavok v cudzej mene – formulár si ho vypýta pri výbere meny a dátumu. */
expensesRouter.get('/kurz', async (req, res) => {
  try {
    res.json(await kurzPreDoklad(String(req.query.mena ?? '').toUpperCase(), String(req.query.datum ?? '')))
  } catch (e: any) {
    res.status(400).json({ chyba: e.message })
  }
})

// ── E-faktúra od dodávateľa ───────────────────────────────────
const nahratieXml = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } })

/**
 * Prečíta e-faktúru (XML) a navrhne z nej výdavok. Nič sa nezapíše – formulár
 * sa vyplní, používateľ ho skontroluje a uloží, XML sa priloží ako doklad.
 */
expensesRouter.post('/efaktura', nahratieXml.single('subor'), (req, res) => {
  if (!req.file) return res.status(400).json({ chyba: 'Vyber súbor s e-faktúrou (XML).' })
  let ef
  try {
    ef = citajEfakturu(req.file.buffer)
  } catch (e: any) {
    return res.status(400).json({ chyba: e.message })
  }
  const d = ef.dodavatel
  const moje = (db.prepare('SELECT ico FROM settings WHERE id = 1').get() as { ico: string }).ico.replace(/\D/g, '')
  // Rovnaká kategória ako pri poslednej faktúre od toho istého dodávateľa.
  const kategoria = d.ico
    ? ((db
        .prepare("SELECT kategoria FROM expenses WHERE dodavatel_ico = ? AND kategoria <> '' ORDER BY datum DESC, id DESC LIMIT 1")
        .get(d.ico) as { kategoria: string } | undefined)?.kategoria ?? '')
    : ''
  const poznamka = [
    ef.splatnost && ef.k_uhrade > 0 ? `Splatná do ${skDatum(ef.splatnost)}` : '',
    ef.vs ? `VS ${ef.vs}` : '',
    ef.iban && ef.k_uhrade > 0 ? `IBAN ${ef.iban}` : '',
    ef.polozky.length ? `Položky: ${ef.polozky.slice(0, 5).join(', ')}${ef.polozky.length > 5 ? '…' : ''}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const cudzia = ef.mena !== 'EUR'
  res.json({
    efaktura: {
      ...ef,
      pdf: !!ef.pdf,
      // Faktúra vystavená na iné IČO – asi patrí niekomu inému.
      ine_ico: moje && ef.odberatel.ico && ef.odberatel.ico !== moje ? ef.odberatel.ico : '',
    },
    navrh: {
      datum: ef.datum,
      popis: `${d.nazov || 'Dodávateľ'} – ${ef.dobropis ? 'dobropis' : 'faktúra'} ${ef.cislo}`.trim(),
      kategoria,
      suma: cudzia ? 0 : ef.suma,
      mena: ef.mena,
      suma_mena: cudzia ? ef.suma : null,
      platba: 'prevod',
      poznamka,
      doklad_cislo: ef.cislo,
      dodavatel_ico: d.ico,
      variabilny: ef.vs,
      // DPH z e-faktúry v eurách – pri cudzej mene ju treba prepočítať ručne.
      dph: cudzia ? 0 : ef.dph,
    },
    zapisana: zapisanaEfaktura(d.ico, ef.cislo) ?? null,
  })
})

expensesRouter.get('/:id', (req, res) => {
  const v = db
    .prepare(
      `SELECT v.*, t.nazov AS turnus_nazov, c.nazov AS firma_nazov
       FROM expenses v
       LEFT JOIN tours t ON t.id = v.tour_id
       LEFT JOIN companies c ON c.id = v.company_id
       WHERE v.id = ?`,
    )
    .get(req.params.id)
  if (!v) return res.status(404).json({ chyba: 'Výdavok neexistuje.' })
  res.json({ ...(v as object), prilohy: subory.zoznam(req.params.id) })
})

expensesRouter.post('/', async (req, res) => {
  const h = telo(req.body)
  if (!h.popis) return res.status(400).json({ chyba: 'Popis výdavku je povinný.' })
  if (!h.datum) return res.status(400).json({ chyba: 'Dátum je povinný.' })
  const chybaMeny = await doplnMenu(h, req.body)
  if (chybaMeny) return res.status(400).json({ chyba: chybaMeny })
  const zapisana = zapisanaEfaktura(String(h.dodavatel_ico), String(h.doklad_cislo))
  if (zapisana) {
    return res.status(409).json({ chyba: `Táto faktúra už je zapísaná – výdavok z ${skDatum(zapisana.datum)} „${zapisana.popis}".` })
  }
  const info = db
    .prepare(`INSERT INTO expenses (${STLPCE.join(', ')}) VALUES (${STLPCE.map((s) => '@' + s).join(', ')})`)
    .run(h)
  res.json({ id: Number(info.lastInsertRowid) })
})

expensesRouter.put('/:id', async (req, res) => {
  const teraz = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!teraz) return res.status(404).json({ chyba: 'Výdavok neexistuje.' })
  // Mena a údaje z e-faktúry ostávajú, keď ich úprava nepošle.
  const body = { ...req.body }
  for (const p of [...POLIA_DOKLADU, 'mena', 'suma_mena', 'kurz', 'dph']) if (!(p in body)) body[p] = teraz[p]
  const h = telo(body)
  if (!h.popis) return res.status(400).json({ chyba: 'Popis výdavku je povinný.' })
  if (!h.datum) return res.status(400).json({ chyba: 'Dátum je povinný.' })
  const chybaMeny = await doplnMenu(h, body)
  if (chybaMeny) return res.status(400).json({ chyba: chybaMeny })
  const set = STLPCE.map((s) => `${s} = @${s}`).join(', ')
  db.prepare(`UPDATE expenses SET ${set} WHERE id = @id`).run({ ...h, id: req.params.id })
  res.json({ ok: true })
})

expensesRouter.delete('/:id', (req, res) => {
  const v = db.prepare('SELECT popis, suma FROM expenses WHERE id = ?').get(req.params.id) as any
  if (!v) return res.status(404).json({ chyba: 'Výdavok neexistuje.' })
  // Doklady ostávajú na disku, kým je výdavok v koši.
  doKosa('expenses', Number(req.params.id), `${v.popis} (${v.suma} €)`)
  res.json({ ok: true, doKosa: true })
})
