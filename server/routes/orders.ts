import { Router } from 'express'
import { db } from '../db.js'
import { doKosa } from '../lib/kos.js'
import { hladajVStlpcoch, vzorHladania, zaokruhli } from '../lib/format.js'
import { STAV_SQL as STAV_FAKTURY_SQL, VYFAKTUROVANE_SQL } from '../lib/platby.js'

export const ordersRouter = Router()

const STAVY = ['prijata', 'potvrdena', 'zrusena'] as const

/**
 * Koľko z objednávky je vyfakturované. "Vyfakturovaná" nie je uložený stav –
 * vyplýva z toho, či súčet faktúr pokryl dohodnutú sumu.
 */
const VYFAKTUROVANE_OBJEDNAVKY = `(SELECT COALESCE(SUM(i.suma), 0) FROM invoices i WHERE i.order_id = o.id AND ${VYFAKTUROVANE_SQL})`

export const OBJEDNAVKA_SUMY_SQL = `
  ${VYFAKTUROVANE_OBJEDNAVKY} AS vyfakturovane,
  CASE
    WHEN o.stav = 'zrusena' THEN 'zrusena'
    WHEN o.suma > 0 AND ${VYFAKTUROVANE_OBJEDNAVKY} >= o.suma
      THEN 'vyfakturovana'
    WHEN (SELECT COUNT(*) FROM invoices i WHERE i.order_id = o.id AND ${VYFAKTUROVANE_SQL}) > 0 THEN 'ciastocne'
    ELSE o.stav
  END AS stav_zobraz`

const POLIA = ['cislo', 'datum', 'popis', 'stav', 'poznamka'] as const

function telo(body: any) {
  const h: Record<string, unknown> = {}
  for (const p of POLIA) h[p] = String(body?.[p] ?? '').trim()
  if (!STAVY.includes(h.stav as any)) h.stav = 'prijata'
  if (!h.datum) h.datum = null
  h.company_id = body?.company_id ? Number(body.company_id) : null
  h.tour_id = body?.tour_id ? Number(body.tour_id) : null
  h.hodinovka = zaokruhli(Number(body?.hodinovka) || 0)
  h.hodiny = Math.max(0, Number(body?.hodiny) || 0)

  // Dohodnutá hodnota objednávky = sadzba × hodiny. Ak hodiny ešte nepoznáš,
  // suma ostane nulová a appka nesleduje, koľko zostáva vyfakturovať.
  // Fixnú sumu (bez hodinovky) sa dá stále zadať priamo.
  h.suma =
    (h.hodinovka as number) > 0 && (h.hodiny as number) > 0
      ? zaokruhli((h.hodinovka as number) * (h.hodiny as number))
      : zaokruhli(Number(body?.suma) || 0)

  // Objednávka bez firmy ju zdedí po turnuse – inak by v zoznamoch chýbal odberateľ.
  if (h.tour_id && !h.company_id) {
    const t = db.prepare('SELECT company_id FROM tours WHERE id = ?').get(h.tour_id) as
      | { company_id: number | null }
      | undefined
    if (t?.company_id) h.company_id = t.company_id
  }
  return h
}

ordersRouter.get('/', (req, res) => {
  const podmienky: string[] = []
  const params: Record<string, unknown> = {}

  const stav = String(req.query.stav ?? '')
  if (STAVY.includes(stav as any)) {
    podmienky.push('o.stav = @stav')
    params.stav = stav
  } else if (stav === 'nevyfakturovane') {
    podmienky.push(
      `o.stav <> 'zrusena' AND (o.suma = 0 OR ${VYFAKTUROVANE_OBJEDNAVKY} < o.suma)`,
    )
  }
  if (req.query.firma) {
    podmienky.push('o.company_id = @firma')
    params.firma = Number(req.query.firma)
  }
  if (req.query.turnus) {
    podmienky.push('o.tour_id = @turnus')
    params.turnus = Number(req.query.turnus)
  }
  const hladat = String(req.query.hladat ?? '').trim()
  if (hladat) {
    podmienky.push(hladajVStlpcoch(['o.cislo', 'o.popis', 'o.poznamka', 'c.nazov', 't.nazov']))
    params.q = vzorHladania(hladat)
  }

  const where = podmienky.length ? 'WHERE ' + podmienky.join(' AND ') : ''
  res.json(
    db
      .prepare(
        `SELECT o.*, c.nazov AS firma_nazov, t.nazov AS turnus_nazov, ${OBJEDNAVKA_SUMY_SQL}
         FROM orders o
         LEFT JOIN companies c ON c.id = o.company_id
         LEFT JOIN tours t ON t.id = o.tour_id
         ${where}
         ORDER BY COALESCE(o.datum, o.created_at) DESC, o.id DESC`,
      )
      .all(params),
  )
})

ordersRouter.get('/:id', (req, res) => {
  const o = db
    .prepare(
      `SELECT o.*, c.nazov AS firma_nazov, t.nazov AS turnus_nazov, ${OBJEDNAVKA_SUMY_SQL}
       FROM orders o
       LEFT JOIN companies c ON c.id = o.company_id
       LEFT JOIN tours t ON t.id = o.tour_id
       WHERE o.id = ?`,
    )
    .get(req.params.id)
  if (!o) return res.status(404).json({ chyba: 'Objednávka neexistuje.' })

  const faktury = db
    .prepare(
      `SELECT i.id, i.cislo, i.typ, i.datum_vystav, i.suma, i.stav, ${STAV_FAKTURY_SQL}
       FROM invoices i WHERE i.order_id = ? ORDER BY i.datum_vystav, i.id`,
    )
    .all(req.params.id)

  res.json({ ...(o as object), faktury })
})

ordersRouter.post('/', (req, res) => {
  const h = telo(req.body)
  if (!h.popis && !h.cislo) return res.status(400).json({ chyba: 'Vyplň aspoň číslo objednávky alebo popis.' })
  const stlpce = [...POLIA, 'company_id', 'tour_id', 'suma', 'hodinovka', 'hodiny']
  const info = db
    .prepare(`INSERT INTO orders (${stlpce.join(', ')}) VALUES (${stlpce.map((s) => '@' + s).join(', ')})`)
    .run(h)
  res.json({ id: Number(info.lastInsertRowid) })
})

ordersRouter.put('/:id', (req, res) => {
  const h = telo(req.body)
  if (!h.popis && !h.cislo) return res.status(400).json({ chyba: 'Vyplň aspoň číslo objednávky alebo popis.' })
  const stlpce = [...POLIA, 'company_id', 'tour_id', 'suma', 'hodinovka', 'hodiny']
  const set = stlpce.map((s) => `${s} = @${s}`).join(', ')
  const info = db.prepare(`UPDATE orders SET ${set} WHERE id = @id`).run({ ...h, id: req.params.id })
  if (!info.changes) return res.status(404).json({ chyba: 'Objednávka neexistuje.' })
  res.json({ ok: true })
})

ordersRouter.delete('/:id', (req, res) => {
  const pocet = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE order_id = ?').get(req.params.id) as { n: number }
  if (pocet.n > 0) {
    return res.status(400).json({
      chyba: `Na objednávku sú naviazané ${pocet.n} faktúry. Namiesto mazania ju označ ako zrušenú.`,
    })
  }
  const o = db.prepare('SELECT cislo, popis FROM orders WHERE id = ?').get(req.params.id) as any
  if (!o) return res.status(404).json({ chyba: 'Objednávka neexistuje.' })
  doKosa('orders', Number(req.params.id), o.cislo || o.popis || 'objednávka')
  res.json({ ok: true, doKosa: true })
})
