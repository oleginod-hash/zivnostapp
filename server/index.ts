import 'dotenv/config'
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DATA_DIR } from './db.js'
import { settingsRouter } from './routes/settings.js'
import { companiesRouter } from './routes/companies.js'
import { invoicesRouter } from './routes/invoices.js'
import { contractsRouter } from './routes/contracts.js'
import { toursRouter } from './routes/tours.js'
import { ordersRouter } from './routes/orders.js'
import { expensesRouter } from './routes/expenses.js'
import { financeRouter } from './routes/finance.js'
import { aiRouter } from './routes/ai.js'
import { searchRouter } from './routes/search.js'
import { trashRouter } from './routes/trash.js'
import { allowanceRouter } from './routes/allowance.js'
import { taxReportRouter } from './routes/taxreport.js'
import { mailRouter } from './routes/mail.js'
import { registryRouter } from './routes/registry.js'
import { templatesRouter } from './routes/templates.js'
import { bankaRouter } from './routes/banka.js'
import { terminyRouter } from './routes/terminy.js'
import { spustiAutoZalohy, stavZaloh } from './lib/autoZaloha.js'
import { upracKos } from './lib/kos.js'

const PORT = Number(process.env.PORT) || 3000
const app = express()

/**
 * Appka nemá prihlásenie, preto smie byť dostupná len z tohto počítača.
 * Server počúva iba na lokálnej adrese (nižšie) a navyše odmietne požiadavku,
 * ktorá sa tvári, že ide na inú adresu – tak by sa k dátam mohla dostať cudzia
 * webstránka otvorená v prehliadači (DNS rebinding). Zápisy z cudzej stránky
 * zastaví kontrola hlavičky Origin.
 */
const MIESTNE_ADRESY = new Set(['localhost', '127.0.0.1', '[::1]'])
app.use((req, res, next) => {
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()
  if (!MIESTNE_ADRESY.has(host)) return res.status(403).send('Živnosťapp je dostupná len z tohto počítača.')

  const origin = req.headers.origin
  if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
    let zPocitaca = false
    try {
      zPocitaca = MIESTNE_ADRESY.has(new URL(origin).hostname.toLowerCase())
    } catch {
      // neplatná hlavička – berieme ako cudziu
    }
    if (!zPocitaca) return res.status(403).json({ chyba: 'Požiadavka z inej stránky bola odmietnutá.' })
  }
  next()
})

app.use(express.json({ limit: '2mb' }))

app.use('/api/nastavenia', settingsRouter)
app.use('/api/firmy', companiesRouter)
app.use('/api/faktury', invoicesRouter)
app.use('/api/zmluvy', contractsRouter)
app.use('/api/turnusy', toursRouter)
app.use('/api/objednavky', ordersRouter)
app.use('/api/vydavky', expensesRouter)
app.use('/api/financie', financeRouter)
app.use('/api/ai', aiRouter)
app.use('/api/hladat', searchRouter)
app.use('/api/kos', trashRouter)
app.get('/api/zalohy/stav', (_req, res) => res.json(stavZaloh()))
app.use('/api/stravne', allowanceRouter)
app.use('/api/danovy-podklad', taxReportRouter)
app.use('/api/mail', mailRouter)
app.use('/api/register', registryRouter)
app.use('/api/sablony', templatesRouter)
app.use('/api/banka', bankaRouter)
app.use('/api/terminy', terminyRouter)

// Keď appka beží dlho a medzitým sa zostaví nová verzia, stránky sa načítajú
// už nové, no server v pamäti ostane starý – a nové polia potichu zahodí.
// Porovnávame obsah kódu servera pri štarte a teraz (nie dátum súborov –
// zostavenie prepíše všetky súbory, aj keď sa v nich nič nezmenilo).
const priecinokServera = path.dirname(fileURLToPath(import.meta.url))
function odtlacokKodu(): string {
  const h = crypto.createHash('sha1')
  const prejdi = (priecinok: string) => {
    const polozky = fs.readdirSync(priecinok, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const p of polozky) {
      const cesta = path.join(priecinok, p.name)
      if (p.isDirectory()) prejdi(cesta)
      else if (/\.(js|ts)$/.test(p.name)) h.update(p.name).update(fs.readFileSync(cesta))
    }
  }
  prejdi(priecinokServera)
  return h.digest('hex')
}
const odtlacokPriStarte = odtlacokKodu()
app.get('/api/verzia', (_req, res) => {
  let zastarana = false
  try {
    zastarana = odtlacokKodu() !== odtlacokPriStarte
  } catch {
    // súbory sa práve prepisujú – skúsime nabudúce
  }
  res.json({ zastarana })
})

app.use('/api', (_req, res) => res.status(404).json({ chyba: 'Neznámy endpoint.' }))

// V produkcii servírujeme aj zbuildovaný frontend z rovnakého portu.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(__dirname, '..', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Chyby pri nahrávaní súborov (veľkosť, typ) sú chybou vstupu, nie servera.
  if (err?.name === 'MulterError' || err?.message?.startsWith('Nepodporovaný typ')) {
    const sprava = err.code === 'LIMIT_FILE_SIZE' ? 'Súbor je väčší než 25 MB.' : err.message
    return res.status(400).json({ chyba: sprava })
  }
  console.error('[chyba]', err)
  res.status(500).json({ chyba: err?.message || 'Neočakávaná chyba servera.' })
})

// Denná záloha (pri štarte a potom každú hodinu) a upratanie koša – ticho na pozadí.
spustiAutoZalohy()
upracKos()

// Len lokálna adresa – z Wi-Fi ani z iného počítača v sieti sa k appke dostať nedá.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Živnosťapp API beží na http://localhost:${PORT}`)
  console.log(`  Dáta: ${DATA_DIR}\n`)
})
// Aj IPv6 slučka, keby prehliadač skúšal „localhost" najprv cez ::1.
// Kde IPv6 nie je, nevadí – stačí adresa vyššie.
const serverIpv6 = http.createServer(app)
serverIpv6.on('error', () => {})
serverIpv6.listen(PORT, '::1')
