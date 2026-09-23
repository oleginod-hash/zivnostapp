// Spoločné pomôcky pre overovacie testy. Každý test beží vo vlastnom procese
// s vlastným dočasným priečinkom dát a portom – skutočné dáta sa nikdy nemenia.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Návratový kód testu, ktorý sa nemal ako spustiť (napr. chýba Chrome). */
export const PRESKOCENE = 10

/**
 * Dočasný priečinok pre dáta testu. Keď test spúšťa `index.mjs`, priečinok
 * pripraví on a po skončení ho aj zmaže (databázu kým beží proces, zmazať nejde).
 */
export function docasnyPriecinok() {
  return process.env.OVERENIE_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'zivnostapp-overenie-'))
}

export function nahodnyPort() {
  return 5300 + Math.floor(Math.random() * 600)
}

/**
 * Modul zo zostaveného servera – ten istý, ktorý používa bežiaci server testu.
 * S `dotaz` sa načíta ako nová, samostatná kópia (napr. s iným nastavením).
 */
export function modulServera(cesta, dotaz = '') {
  return import(pathToFileURL(path.join(KOREN, 'dist-server', cesta)).href + (dotaz ? `?${dotaz}` : ''))
}

/**
 * Spustí zostavený server nad daným priečinkom dát. Premenné nastavujeme ešte
 * pred načítaním servera – .env ich potom neprepíše, takže testy nikdy
 * nesiahnu na skutočné dáta, nezavolajú skutočné AI ani neodošlú e-mail.
 */
export async function spustiServer(dataDir, port) {
  process.env.DATA_DIR = dataDir
  process.env.PORT = String(port)
  process.env.ANTHROPIC_API_KEY = ''
  process.env.SMTP_HOST = ''
  process.env.CASOVE_PASMO = 'Europe/Bratislava'
  if (!fs.existsSync(path.join(KOREN, 'dist-server', 'index.js'))) {
    throw new Error('Chýba zostavený server – najprv spusti npm run build.')
  }
  // Hlásenia servera (migrácie, záloha, adresa) by výpis testu zahltili.
  // Chyby (console.error) ostávajú viditeľné.
  if (!process.env.OVERENIE_PODROBNE) console.log = () => {}
  await modulServera('index.js')
  await new Promise((r) => setTimeout(r, 400))
  return `http://localhost:${port}/api`
}

export function vytvorApi(zaklad) {
  return async (metoda, cesta, telo, hlavicky = {}) => {
    const formular = telo instanceof FormData
    const r = await fetch(zaklad + cesta, {
      method: metoda,
      headers: telo !== undefined && !formular ? { 'Content-Type': 'application/json', ...hlavicky } : hlavicky,
      body: telo === undefined ? undefined : formular ? telo : JSON.stringify(telo),
    })
    const typ = r.headers.get('content-type') ?? ''
    if (!typ.includes('json') && !typ.startsWith('text/')) {
      return { stav: r.status, d: Buffer.from(await r.arrayBuffer()), typ }
    }
    const text = await r.text()
    let d
    try {
      d = text ? JSON.parse(text) : null
    } catch {
      d = text
    }
    return { stav: r.status, d, typ }
  }
}

/** Požiadavka s ľubovoľnou hlavičkou Host (fetch ju meniť nedovolí). */
export function ziadostSHostom(port, cesta, host) {
  return new Promise((r) => {
    http
      .get({ host: '127.0.0.1', port, path: cesta, headers: { Host: host } }, (res) => {
        res.resume()
        r(res.statusCode)
      })
      .on('error', () => r(0))
  })
}

const vypis = (text) => process.stdout.write(text + '\n')

/** Jednoduché kontroly s prehľadným výpisom a súhrnom na konci. */
export function kontroly(nazov) {
  let ok = 0
  let chyby = 0
  vypis(`\n── ${nazov}`)
  return {
    over(popis, skutocne, cakane) {
      const sedi = JSON.stringify(skutocne) === JSON.stringify(cakane)
      if (sedi) ok++
      else chyby++
      vypis(
        `${sedi ? '  OK   ' : '  CHYBA'} ${popis}` +
          (sedi ? '' : `\n         je:        ${JSON.stringify(skutocne)}\n         čakal som: ${JSON.stringify(cakane)}`),
      )
    },
    sekcia(nadpis) {
      vypis(`   ${nadpis}`)
    },
    koniec() {
      vypis(`   ${ok} v poriadku, ${chyby} chýb`)
      process.exit(chyby ? 1 : 0)
    },
  }
}

/** Test sa nedá spustiť (chýba Chrome, chýbajú skutočné dáta…) – nie je to chyba. */
export function preskoc(nazov, dovod) {
  vypis(`\n── ${nazov}\n   preskočené: ${dovod}`)
  process.exit(PRESKOCENE)
}

export const cakaj = (ms) => new Promise((r) => setTimeout(r, ms))

/** Čaká, kým podmienka nezačne platiť – najdlhšie `ms` milisekúnd. */
export async function pockaj(podmienka, ms = 5000) {
  const koniec = Date.now() + ms
  while (Date.now() < koniec) {
    if (await podmienka()) return true
    await cakaj(100)
  }
  return false
}
