import { Router } from 'express'
import { db } from '../db.js'
import { doKosa } from '../lib/kos.js'

export const companiesRouter = Router()

const POLIA = [
  'nazov', 'kontaktna_osoba', 'adresa', 'psc_mesto', 'krajina', 'ico', 'dic', 'ic_dph', 'email', 'telefon', 'poznamka',
] as const

function telo(req: any) {
  const h: Record<string, string> = {}
  for (const p of POLIA) h[p] = String(req.body?.[p] ?? '').trim()
  return h
}

companiesRouter.get('/', (req, res) => {
  const vratane = req.query.archivovane === '1'
  const sql = vratane
    ? 'SELECT * FROM companies ORDER BY archived, nazov COLLATE NOCASE'
    : 'SELECT * FROM companies WHERE archived = 0 ORDER BY nazov COLLATE NOCASE'
  res.json(db.prepare(sql).all())
})

companiesRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ chyba: 'Firma neexistuje.' })
  res.json(row)
})

companiesRouter.post('/', (req, res) => {
  const h = telo(req)
  if (!h.nazov) return res.status(400).json({ chyba: 'Názov firmy je povinný.' })
  const info = db.prepare(
    `INSERT INTO companies (${POLIA.join(', ')}) VALUES (${POLIA.map((p) => '@' + p).join(', ')})`,
  ).run(h)
  res.json(db.prepare('SELECT * FROM companies WHERE id = ?').get(info.lastInsertRowid))
})

companiesRouter.put('/:id', (req, res) => {
  const teraz = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id) as Record<string, any> | undefined
  if (!teraz) return res.status(404).json({ chyba: 'Firma neexistuje.' })
  // Pole, ktoré v požiadavke chýba, ostáva – nevymaže sa len preto, že ho niekto neposlal.
  const h = telo(req)
  for (const p of POLIA) if (req.body?.[p] === undefined) h[p] = teraz[p] ?? ''
  if (!h.nazov) return res.status(400).json({ chyba: 'Názov firmy je povinný.' })
  const set = POLIA.map((p) => `${p} = @${p}`).join(', ')
  const info = db.prepare(`UPDATE companies SET ${set} WHERE id = @id`).run({ ...h, id: req.params.id })
  if (!info.changes) return res.status(404).json({ chyba: 'Firma neexistuje.' })
  res.json(db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id))
})

/** Firmu s faktúrami nemažeme – iba archivujeme, aby história ostala celá. */
companiesRouter.delete('/:id', (req, res) => {
  const pocet = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE company_id = ?').get(req.params.id) as { n: number }
  if (pocet.n > 0) {
    db.prepare('UPDATE companies SET archived = 1 WHERE id = ?').run(req.params.id)
    return res.json({ ok: true, archivovana: true, pocetFaktur: pocet.n })
  }
  const firma = db.prepare('SELECT nazov FROM companies WHERE id = ?').get(req.params.id) as any
  if (!firma) return res.status(404).json({ chyba: 'Firma neexistuje.' })
  doKosa('companies', Number(req.params.id), firma.nazov)
  res.json({ ok: true, archivovana: false, doKosa: true })
})

companiesRouter.post('/:id/obnovit', (req, res) => {
  db.prepare('UPDATE companies SET archived = 0 WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})
