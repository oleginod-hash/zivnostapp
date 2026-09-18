import { Router } from 'express'
import { db } from '../db.js'
import { doKosa } from '../lib/kos.js'
import { prilohyModul } from '../lib/prilohy.js'
import { hladajVStlpcoch, vzorHladania } from '../lib/format.js'

export const contractsRouter = Router()

const subory = prilohyModul({
  tabulka: 'contract_files',
  cudziKluc: 'contract_id',
  rodic: 'contracts',
  priecinok: 'zmluvy',
})
contractsRouter.use(subory.router)

const STAVY = ['aktivna', 'ukoncena', 'navrh'] as const
const OBNOVY = ['ziadna', 'automaticka', 'rucna'] as const

/**
 * Expirácia sa neukladá – počítame ju z dátumu platnosti a počtu dní,
 * koľko dopredu chce byť používateľ upozornený.
 */
const EXPIRACIA_SQL = `
  CASE
    WHEN z.stav <> 'aktivna' OR z.platnost_do IS NULL OR z.platnost_do = '' THEN 'ziadna'
    WHEN z.platnost_do < date('now') THEN 'po_expiracii'
    WHEN z.platnost_do <= date('now', '+' || z.pripomienka_dni || ' days') THEN 'coskoro'
    ELSE 'ziadna'
  END AS expiracia,
  CASE
    WHEN z.platnost_do IS NULL OR z.platnost_do = '' THEN NULL
    ELSE CAST(julianday(z.platnost_do) - julianday(date('now')) AS INTEGER)
  END AS dni_do_konca`

const POLIA = [
  'nazov', 'kategoria', 'cislo_zmluvy', 'datum_podpisu', 'platnost_od',
  'platnost_do', 'obnova', 'stav', 'poznamka',
] as const

function telo(body: any) {
  const h: Record<string, unknown> = {}
  for (const p of POLIA) h[p] = String(body?.[p] ?? '').trim()
  if (!STAVY.includes(h.stav as any)) h.stav = 'aktivna'
  if (!OBNOVY.includes(h.obnova as any)) h.obnova = 'ziadna'
  for (const d of ['datum_podpisu', 'platnost_od', 'platnost_do']) {
    if (!h[d]) h[d] = null
  }
  h.company_id = body?.company_id ? Number(body.company_id) : null
  h.vypoved_dni = Math.max(0, Math.round(Number(body?.vypoved_dni) || 0))
  const pripomienka = Math.round(Number(body?.pripomienka_dni))
  h.pripomienka_dni = Number.isFinite(pripomienka) && pripomienka >= 0 && pripomienka <= 365 ? pripomienka : 30
  return h
}

// ── Zoznam ────────────────────────────────────────────────────
contractsRouter.get('/', (req, res) => {
  const podmienky: string[] = []
  const params: Record<string, unknown> = {}

  const stav = String(req.query.stav ?? '')
  if (STAVY.includes(stav as any)) {
    podmienky.push('z.stav = @stav')
    params.stav = stav
  }
  if (req.query.firma) {
    podmienky.push('z.company_id = @firma')
    params.firma = Number(req.query.firma)
  }
  if (req.query.kategoria) {
    podmienky.push('z.kategoria = @kategoria')
    params.kategoria = String(req.query.kategoria)
  }
  const hladat = String(req.query.hladat ?? '').trim()
  if (hladat) {
    podmienky.push(hladajVStlpcoch(['z.nazov', 'z.cislo_zmluvy', 'z.poznamka', 'c.nazov']))
    params.q = vzorHladania(hladat)
  }

  const where = podmienky.length ? 'WHERE ' + podmienky.join(' AND ') : ''
  const riadky = db
    .prepare(
      `SELECT z.*, c.nazov AS firma_nazov,
              (SELECT COUNT(*) FROM contract_files f WHERE f.contract_id = z.id) AS pocet_priloh,
              ${EXPIRACIA_SQL}
       FROM contracts z LEFT JOIN companies c ON c.id = z.company_id
       ${where}
       ORDER BY
         CASE WHEN z.stav = 'aktivna' THEN 0 ELSE 1 END,
         COALESCE(z.platnost_do, '9999-12-31'),
         z.nazov COLLATE NOCASE`,
    )
    .all(params)

  res.json(riadky)
})

// ── Súhrn a pripomienky ───────────────────────────────────────
contractsRouter.get('/suhrn', (_req, res) => {
  const pocty = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN stav = 'aktivna' THEN 1 END), 0) AS aktivne,
         COALESCE(SUM(CASE WHEN stav = 'aktivna' AND platnost_do IS NOT NULL AND platnost_do <> ''
                            AND platnost_do < date('now') THEN 1 END), 0) AS po_expiracii,
         COALESCE(SUM(CASE WHEN stav = 'aktivna' AND platnost_do IS NOT NULL AND platnost_do <> ''
                            AND platnost_do >= date('now')
                            AND platnost_do <= date('now', '+' || pripomienka_dni || ' days') THEN 1 END), 0) AS coskoro
       FROM contracts`,
    )
    .get()

  const pripomienky = db
    .prepare(
      `SELECT z.id, z.nazov, z.platnost_do, z.obnova, c.nazov AS firma_nazov, ${EXPIRACIA_SQL}
       FROM contracts z LEFT JOIN companies c ON c.id = z.company_id
       WHERE z.stav = 'aktivna' AND z.platnost_do IS NOT NULL AND z.platnost_do <> ''
         AND z.platnost_do <= date('now', '+' || z.pripomienka_dni || ' days')
       ORDER BY z.platnost_do
       LIMIT 10`,
    )
    .all()

  const kategorie = db
    .prepare("SELECT DISTINCT kategoria FROM contracts WHERE kategoria <> '' ORDER BY kategoria COLLATE NOCASE")
    .all() as { kategoria: string }[]

  res.json({ ...(pocty as object), pripomienky, kategorie: kategorie.map((k) => k.kategoria) })
})

// ── Detail ────────────────────────────────────────────────────
contractsRouter.get('/:id', (req, res) => {
  const z = db
    .prepare(
      `SELECT z.*, c.nazov AS firma_nazov, ${EXPIRACIA_SQL}
       FROM contracts z LEFT JOIN companies c ON c.id = z.company_id WHERE z.id = ?`,
    )
    .get(req.params.id)
  if (!z) return res.status(404).json({ chyba: 'Zmluva neexistuje.' })
  res.json({ ...(z as object), prilohy: subory.zoznam(req.params.id) })
})

// ── Vytvorenie / úprava ───────────────────────────────────────
contractsRouter.post('/', (req, res) => {
  const h = telo(req.body)
  if (!h.nazov) return res.status(400).json({ chyba: 'Názov zmluvy je povinný.' })
  const stlpce = [...POLIA, 'company_id', 'vypoved_dni', 'pripomienka_dni']
  const info = db
    .prepare(`INSERT INTO contracts (${stlpce.join(', ')}) VALUES (${stlpce.map((s) => '@' + s).join(', ')})`)
    .run(h)
  res.json({ id: Number(info.lastInsertRowid) })
})

contractsRouter.put('/:id', (req, res) => {
  const h = telo(req.body)
  if (!h.nazov) return res.status(400).json({ chyba: 'Názov zmluvy je povinný.' })
  const stlpce = [...POLIA, 'company_id', 'vypoved_dni', 'pripomienka_dni']
  const set = stlpce.map((s) => `${s} = @${s}`).join(', ')
  const info = db.prepare(`UPDATE contracts SET ${set} WHERE id = @id`).run({ ...h, id: req.params.id })
  if (!info.changes) return res.status(404).json({ chyba: 'Zmluva neexistuje.' })
  res.json({ ok: true })
})

contractsRouter.delete('/:id', (req, res) => {
  const z = db.prepare('SELECT nazov FROM contracts WHERE id = ?').get(req.params.id) as any
  if (!z) return res.status(404).json({ chyba: 'Zmluva neexistuje.' })
  // Prílohy ostávajú na disku, kým je zmluva v koši – inak by sa nedala plne obnoviť.
  doKosa('contracts', Number(req.params.id), z.nazov)
  res.json({ ok: true, doKosa: true })
})
