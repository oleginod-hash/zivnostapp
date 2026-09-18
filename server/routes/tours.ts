import { Router } from 'express'
import { db } from '../db.js'
import { doKosa } from '../lib/kos.js'
import { OBJEDNAVKA_SUMY_SQL } from './orders.js'
import { STAV_SQL as STAV_FAKTURY_SQL, UHRADENE_SQL, VYFAKTUROVANE_SQL } from '../lib/platby.js'
import { hladajVStlpcoch, vzorHladania } from '../lib/format.js'

export const toursRouter = Router()

/**
 * Stav turnusu sa neukladá – vyplýva z dátumov. Ručne sa dá nastaviť
 * len zrušenie, lebo to z kalendára vyčítať nejde.
 */
const STAV_SQL = `
  CASE
    WHEN t.zruseny = 1 THEN 'zruseny'
    WHEN date('now') < t.datum_od THEN 'planovany'
    WHEN date('now') > t.datum_do THEN 'ukonceny'
    ELSE 'prebieha'
  END AS stav`

/**
 * Koľko z turnusu už bolo vyfakturované a koľko z toho je zaplatené.
 * Koncepty ešte nie sú vyfakturované a zálohová faktúra kryjúca starý dlh
 * je len jeho splátkou – jej suma je už v pôvodnej faktúre. Zaplatené sa
 * ráta z platieb (aj cez krycie zálohy), najviac do výšky faktúry.
 */
const SUMY_SQL = `
  (SELECT COALESCE(SUM(i.suma), 0) FROM invoices i WHERE i.tour_id = t.id AND ${VYFAKTUROVANE_SQL}) AS vyfakturovane,
  (SELECT COALESCE(SUM(MIN(i.suma, ${UHRADENE_SQL})), 0) FROM invoices i
    WHERE i.tour_id = t.id AND ${VYFAKTUROVANE_SQL}) AS zaplatene,
  (SELECT COALESCE(SUM(o.suma), 0) FROM orders o WHERE o.tour_id = t.id AND o.stav <> 'zrusena') AS objednane,
  (SELECT COUNT(*) FROM orders o WHERE o.tour_id = t.id) AS pocet_objednavok`

const POLIA = ['nazov', 'krajina', 'miesto', 'datum_od', 'datum_do', 'poznamka'] as const

function telo(body: any) {
  const h: Record<string, unknown> = {}
  for (const p of POLIA) h[p] = String(body?.[p] ?? '').trim()
  h.company_id = body?.company_id ? Number(body.company_id) : null
  h.zruseny = body?.zruseny ? 1 : 0
  return h
}

// ── Zoznam ────────────────────────────────────────────────────
toursRouter.get('/', (req, res) => {
  const podmienky: string[] = []
  const params: Record<string, unknown> = {}

  const stav = String(req.query.stav ?? '')
  if (stav === 'zruseny') podmienky.push('t.zruseny = 1')
  else if (stav === 'planovany') podmienky.push("t.zruseny = 0 AND date('now') < t.datum_od")
  else if (stav === 'prebieha') podmienky.push("t.zruseny = 0 AND date('now') BETWEEN t.datum_od AND t.datum_do")
  else if (stav === 'ukonceny') podmienky.push("t.zruseny = 0 AND date('now') > t.datum_do")

  if (req.query.firma) {
    podmienky.push('t.company_id = @firma')
    params.firma = Number(req.query.firma)
  }
  if (req.query.rok) {
    podmienky.push("strftime('%Y', t.datum_od) = @rok")
    params.rok = String(req.query.rok)
  }
  const hladat = String(req.query.hladat ?? '').trim()
  if (hladat) {
    podmienky.push(hladajVStlpcoch(['t.nazov', 't.krajina', 't.miesto', 't.poznamka', 'c.nazov']))
    params.q = vzorHladania(hladat)
  }

  const where = podmienky.length ? 'WHERE ' + podmienky.join(' AND ') : ''
  res.json(
    db
      .prepare(
        `SELECT t.*, c.nazov AS firma_nazov, ${STAV_SQL}, ${SUMY_SQL}
         FROM tours t LEFT JOIN companies c ON c.id = t.company_id
         ${where}
         ORDER BY t.datum_od DESC, t.id DESC`,
      )
      .all(params),
  )
})

toursRouter.get('/suhrn', (_req, res) => {
  const r = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN zruseny = 0 AND date('now') BETWEEN datum_od AND datum_do THEN 1 END), 0) AS prebiehaju,
         COALESCE(SUM(CASE WHEN zruseny = 0 AND date('now') < datum_od THEN 1 END), 0) AS planovane,
         COALESCE(SUM(CASE WHEN zruseny = 0 AND date('now') > datum_do THEN 1 END), 0) AS ukoncene
       FROM tours`,
    )
    .get()
  const roky = db
    .prepare("SELECT DISTINCT strftime('%Y', datum_od) AS rok FROM tours ORDER BY rok DESC")
    .all() as { rok: string }[]

  // Turnusy, ktoré skončili, ale ešte nie sú celé vyfakturované.
  const nevyfakturovane = db
    .prepare(
      `SELECT t.id, t.nazov, t.datum_do, c.nazov AS firma_nazov,
              (SELECT COALESCE(SUM(o.suma), 0) FROM orders o WHERE o.tour_id = t.id AND o.stav <> 'zrusena') AS objednane,
              (SELECT COALESCE(SUM(i.suma), 0) FROM invoices i WHERE i.tour_id = t.id AND ${VYFAKTUROVANE_SQL}) AS vyfakturovane
       FROM tours t LEFT JOIN companies c ON c.id = t.company_id
       WHERE t.zruseny = 0 AND date('now') > t.datum_do
       ORDER BY t.datum_do DESC
       LIMIT 20`,
    )
    .all() as any[]

  res.json({
    ...(r as object),
    roky: roky.map((x) => x.rok),
    nevyfakturovane: nevyfakturovane.filter((t) => t.vyfakturovane === 0 || t.vyfakturovane < t.objednane).slice(0, 5),
  })
})

// ── Detail vrátane objednávok a faktúr ────────────────────────
toursRouter.get('/:id', (req, res) => {
  const t = db
    .prepare(
      `SELECT t.*, c.nazov AS firma_nazov, ${STAV_SQL}, ${SUMY_SQL}
       FROM tours t LEFT JOIN companies c ON c.id = t.company_id WHERE t.id = ?`,
    )
    .get(req.params.id)
  if (!t) return res.status(404).json({ chyba: 'Turnus neexistuje.' })

  const objednavky = db
    .prepare(
      `SELECT o.*, c.nazov AS firma_nazov, ${OBJEDNAVKA_SUMY_SQL}
       FROM orders o LEFT JOIN companies c ON c.id = o.company_id
       WHERE o.tour_id = ? ORDER BY o.datum, o.id`,
    )
    .all(req.params.id)

  const faktury = db
    .prepare(
      `SELECT i.id, i.cislo, i.typ, i.datum_vystav, i.datum_splat, i.suma, i.stav, ${STAV_FAKTURY_SQL}
       FROM invoices i WHERE i.tour_id = ? ORDER BY i.datum_vystav, i.id`,
    )
    .all(req.params.id)

  res.json({ ...(t as object), objednavky, faktury })
})

// ── Zápis ─────────────────────────────────────────────────────
toursRouter.post('/', (req, res) => {
  const h = telo(req.body)
  if (!h.nazov) return res.status(400).json({ chyba: 'Názov turnusu je povinný.' })
  if (!h.datum_od || !h.datum_do) return res.status(400).json({ chyba: 'Vyplň dátum od aj do.' })
  if ((h.datum_do as string) < (h.datum_od as string)) {
    return res.status(400).json({ chyba: 'Dátum do nemôže byť skôr než dátum od.' })
  }
  const stlpce = [...POLIA, 'company_id', 'zruseny']
  const info = db
    .prepare(`INSERT INTO tours (${stlpce.join(', ')}) VALUES (${stlpce.map((s) => '@' + s).join(', ')})`)
    .run(h)
  res.json({ id: Number(info.lastInsertRowid) })
})

toursRouter.put('/:id', (req, res) => {
  const h = telo(req.body)
  if (!h.nazov) return res.status(400).json({ chyba: 'Názov turnusu je povinný.' })
  if (!h.datum_od || !h.datum_do) return res.status(400).json({ chyba: 'Vyplň dátum od aj do.' })
  if ((h.datum_do as string) < (h.datum_od as string)) {
    return res.status(400).json({ chyba: 'Dátum do nemôže byť skôr než dátum od.' })
  }
  const stlpce = [...POLIA, 'company_id', 'zruseny']
  const set = stlpce.map((s) => `${s} = @${s}`).join(', ')
  const info = db.prepare(`UPDATE tours SET ${set} WHERE id = @id`).run({ ...h, id: req.params.id })
  if (!info.changes) return res.status(404).json({ chyba: 'Turnus neexistuje.' })
  res.json({ ok: true })
})

toursRouter.delete('/:id', (req, res) => {
  const naviazane = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM invoices WHERE tour_id = @id) AS faktury,
              (SELECT COUNT(*) FROM orders   WHERE tour_id = @id) AS objednavky`,
    )
    .get({ id: req.params.id }) as { faktury: number; objednavky: number }

  if (naviazane.faktury > 0) {
    return res.status(400).json({
      chyba: `Na turnus je naviazaných ${naviazane.faktury} faktúr. Namiesto mazania ho označ ako zrušený.`,
    })
  }
  const t = db.prepare('SELECT nazov FROM tours WHERE id = ?').get(req.params.id) as any
  if (!t) return res.status(404).json({ chyba: 'Turnus neexistuje.' })
  doKosa('tours', Number(req.params.id), t.nazov)
  res.json({ ok: true, doKosa: true, uvolneneObjednavky: naviazane.objednavky })
})
