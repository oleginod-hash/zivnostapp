import { Router } from 'express'
import { obnovVybrane, obnovZKosa, upracKos, vysypJednu, vysypVybrane, zoznamKosa } from '../lib/kos.js'

export const trashRouter = Router()

trashRouter.get('/', (_req, res) => {
  res.json(zoznamKosa())
})

trashRouter.post('/:id/obnovit', (req, res) => {
  const v = obnovZKosa(Number(req.params.id))
  if (!v.ok) return res.status(400).json({ chyba: v.sprava })
  res.json({ ok: true, sprava: v.sprava })
})

/** Nenávratné zmazanie – toto je jediná cesta, ako dáta naozaj stratiť. */
trashRouter.delete('/:id', (req, res) => {
  if (!vysypJednu(Number(req.params.id))) {
    return res.status(404).json({ chyba: 'Položka v koši neexistuje.' })
  }
  res.json({ ok: true })
})

/**
 * Hromadné vysypanie. Bez `id` v tele sa vysype celý kôš – preto to musí byť
 * POST s výslovným potvrdením na strane appky, nie omylom kliknuteľný DELETE.
 */
trashRouter.post('/vysypat', (req, res) => {
  const idcka = Array.isArray(req.body?.id) ? req.body.id.map(Number).filter(Boolean) : null
  if (idcka && !idcka.length) return res.status(400).json({ chyba: 'Nevybral si nič na zmazanie.' })
  res.json({ ok: true, zmazane: vysypVybrane(idcka ?? undefined) })
})

/** Hromadné vrátenie vybraných položiek späť do evidencie. */
trashRouter.post('/obnovit', (req, res) => {
  const idcka = Array.isArray(req.body?.id) ? req.body.id.map(Number).filter(Boolean) : []
  if (!idcka.length) return res.status(400).json({ chyba: 'Nevybral si nič na vrátenie.' })
  res.json({ ok: true, ...obnovVybrane(idcka) })
})

trashRouter.post('/upratat', (_req, res) => {
  res.json({ ok: true, zmazane: upracKos() })
})
