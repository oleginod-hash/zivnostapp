import { Router } from 'express'
import { db } from '../db.js'

export const templatesRouter = Router()

/**
 * Šablóny faktúr – uložené položky pre opakovanú fakturáciu.
 * Neukladajú dátumy ani čísla, tie sa vždy generujú nanovo.
 */
type Polozka = { popis: string; mnozstvo: number; jednotka: string; cena: number }

function spracujPolozky(vstup: unknown): Polozka[] {
  if (!Array.isArray(vstup)) return []
  return vstup
    .map((p: any) => ({
      popis: String(p?.popis ?? '').trim(),
      mnozstvo: Number(p?.mnozstvo) || 0,
      jednotka: String(p?.jednotka ?? '').trim() || 'ks',
      cena: Number(p?.cena) || 0,
    }))
    .filter((p) => p.popis !== '' || p.cena !== 0)
}

function rozbal(r: any) {
  return { ...r, polozky: JSON.parse(r.polozky || '[]') as Polozka[] }
}

templatesRouter.get('/', (_req, res) => {
  const riadky = db
    .prepare(
      `SELECT s.*, c.nazov AS firma_nazov FROM invoice_templates s
       LEFT JOIN companies c ON c.id = s.company_id
       ORDER BY s.nazov COLLATE NOCASE`,
    )
    .all() as any[]
  res.json(riadky.map(rozbal))
})

templatesRouter.get('/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM invoice_templates WHERE id = ?').get(req.params.id) as any
  if (!r) return res.status(404).json({ chyba: 'Šablóna neexistuje.' })
  res.json(rozbal(r))
})

templatesRouter.post('/', (req, res) => {
  const nazov = String(req.body?.nazov ?? '').trim()
  if (!nazov) return res.status(400).json({ chyba: 'Názov šablóny je povinný.' })

  const info = db
    .prepare('INSERT INTO invoice_templates (nazov, company_id, poznamka, polozky) VALUES (?, ?, ?, ?)')
    .run(
      nazov,
      req.body?.company_id ? Number(req.body.company_id) : null,
      String(req.body?.poznamka ?? '').trim(),
      JSON.stringify(spracujPolozky(req.body?.polozky)),
    )
  res.json({ id: Number(info.lastInsertRowid) })
})

/** Uloží existujúcu faktúru ako šablónu. */
templatesRouter.post('/z-faktury/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any
  if (!f) return res.status(404).json({ chyba: 'Faktúra neexistuje.' })

  const polozky = db
    .prepare('SELECT popis, mnozstvo, jednotka, cena FROM invoice_items WHERE invoice_id = ? ORDER BY poradie, id')
    .all(req.params.id)

  const firma = f.company_id
    ? (db.prepare('SELECT nazov FROM companies WHERE id = ?').get(f.company_id) as any)
    : null
  const nazov = String(req.body?.nazov ?? '').trim() || `${firma?.nazov ?? 'Faktúra'} – vzor`

  const info = db
    .prepare('INSERT INTO invoice_templates (nazov, company_id, poznamka, polozky) VALUES (?, ?, ?, ?)')
    .run(nazov, f.company_id, f.poznamka, JSON.stringify(polozky))
  res.json({ id: Number(info.lastInsertRowid), nazov })
})

templatesRouter.put('/:id', (req, res) => {
  const nazov = String(req.body?.nazov ?? '').trim()
  if (!nazov) return res.status(400).json({ chyba: 'Názov šablóny je povinný.' })

  const info = db
    .prepare('UPDATE invoice_templates SET nazov = ?, company_id = ?, poznamka = ?, polozky = ? WHERE id = ?')
    .run(
      nazov,
      req.body?.company_id ? Number(req.body.company_id) : null,
      String(req.body?.poznamka ?? '').trim(),
      JSON.stringify(spracujPolozky(req.body?.polozky)),
      req.params.id,
    )
  if (!info.changes) return res.status(404).json({ chyba: 'Šablóna neexistuje.' })
  res.json({ ok: true })
})

/** Šablóny do koša nechodia – nie sú to dáta o podnikaní, len pomôcka. */
templatesRouter.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM invoice_templates WHERE id = ?').run(req.params.id)
  if (!info.changes) return res.status(404).json({ chyba: 'Šablóna neexistuje.' })
  res.json({ ok: true })
})
