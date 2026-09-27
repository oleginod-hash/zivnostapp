import { Router, type Request } from 'express'
import QRCode from 'qrcode'
import { vypniPristup, zapniPristup, zistiStav } from '../lib/pristup.js'

export const pristupRouter = Router()

const PORT = () => Number(process.env.PORT) || 3000
const MIESTNE = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Požiadavka prišla z tohto počítača, nie z telefónu cez Tailscale. */
export function zPocitaca(req: Request): boolean {
  // Tailscale k požiadavke z telefónu pridá, odkiaľ prišla – keby niekedy
  // nezachoval adresu v hlavičke Host, spoznáme ju aj takto.
  if (req.headers['x-forwarded-for'] || req.headers['tailscale-user-login']) return false
  return MIESTNE.has(String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase())
}

pristupRouter.get('/', async (req, res) => {
  const stav = await zistiStav(PORT())
  res.json({ ...stav, z_pocitaca: zPocitaca(req) })
})

// Zapnúť a vypnúť sa dá len pri počítači – z telefónu by si človek
// vypnutím odrezal spojenie, ktorým práve appku ovláda.
pristupRouter.post('/zapnut', async (req, res) => {
  if (!zPocitaca(req)) return res.status(403).json({ chyba: 'Prístup z telefónu sa zapína pri počítači.' })
  const r = await zapniPristup(PORT())
  res.status(r.ok || r.povolit ? 200 : 400).json(r.ok || r.povolit ? { ...r, ...(await zistiStav(PORT())) } : r)
})

pristupRouter.post('/vypnut', async (req, res) => {
  if (!zPocitaca(req)) return res.status(403).json({ chyba: 'Prístup z telefónu sa vypína pri počítači.' })
  const r = await vypniPristup(PORT())
  if (!r.ok) return res.status(400).json(r)
  res.json({ ...r, ...(await zistiStav(PORT())) })
})

/** QR kód s adresou appky pre telefón – voliteľne rovno na konkrétnu stránku. */
pristupRouter.get('/qr', async (req, res) => {
  const stav = await zistiStav(PORT())
  if (!stav.adresa) return res.status(404).json({ chyba: 'Prístup z telefónu nie je zapnutý.' })
  const cesta = String(req.query.cesta ?? '/')
  // Len cesta v rámci appky – QR nikdy nepošle telefón na cudziu stránku.
  if (!cesta.startsWith('/') || cesta.startsWith('//')) return res.status(400).json({ chyba: 'Neplatná cesta.' })
  const svg = await QRCode.toString(stav.adresa + cesta, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' })
  res.type('image/svg+xml').send(svg)
})
