import { Router } from 'express'
import { db } from '../db.js'
import { doKosa } from '../lib/kos.js'
import { hladajVStlpcoch, vzorHladania, zaokruhli } from '../lib/format.js'
import { prilohyModul } from '../lib/prilohy.js'

export const expensesRouter = Router()

const subory = prilohyModul({
  tabulka: 'expense_files',
  cudziKluc: 'expense_id',
  rodic: 'expenses',
  priecinok: 'doklady',
})
expensesRouter.use(subory.router)

const PLATBY = ['karta', 'hotovost', 'prevod', 'ine'] as const
const POLIA = ['datum', 'popis', 'kategoria', 'platba', 'poznamka'] as const

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

expensesRouter.post('/', (req, res) => {
  const h = telo(req.body)
  if (!h.popis) return res.status(400).json({ chyba: 'Popis výdavku je povinný.' })
  if (!h.datum) return res.status(400).json({ chyba: 'Dátum je povinný.' })
  const stlpce = [...POLIA, 'druh', 'company_id', 'tour_id', 'suma', 'odpocitat']
  const info = db
    .prepare(`INSERT INTO expenses (${stlpce.join(', ')}) VALUES (${stlpce.map((s) => '@' + s).join(', ')})`)
    .run(h)
  res.json({ id: Number(info.lastInsertRowid) })
})

expensesRouter.put('/:id', (req, res) => {
  const h = telo(req.body)
  if (!h.popis) return res.status(400).json({ chyba: 'Popis výdavku je povinný.' })
  if (!h.datum) return res.status(400).json({ chyba: 'Dátum je povinný.' })
  const stlpce = [...POLIA, 'druh', 'company_id', 'tour_id', 'suma', 'odpocitat']
  const set = stlpce.map((s) => `${s} = @${s}`).join(', ')
  const info = db.prepare(`UPDATE expenses SET ${set} WHERE id = @id`).run({ ...h, id: req.params.id })
  if (!info.changes) return res.status(404).json({ chyba: 'Výdavok neexistuje.' })
  res.json({ ok: true })
})

expensesRouter.delete('/:id', (req, res) => {
  const v = db.prepare('SELECT popis, suma FROM expenses WHERE id = ?').get(req.params.id) as any
  if (!v) return res.status(404).json({ chyba: 'Výdavok neexistuje.' })
  // Doklady ostávajú na disku, kým je výdavok v koši.
  doKosa('expenses', Number(req.params.id), `${v.popis} (${v.suma} €)`)
  res.json({ ok: true, doKosa: true })
})
