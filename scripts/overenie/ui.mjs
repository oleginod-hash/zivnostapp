// Obrazovky appky v neviditeľnom Chrome (1275 × 748, svetlý režim) nad
// vymyslenými údajmi: žiadne chyby v konzole, nič nepretŕča do strany,
// písmo aspoň 12 px, kontrast textu podľa normy (WCAG AA) a základné
// akcie – zmazanie a „Uhradená" s vrátením späť, vlastné okná s otázkou.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  KOREN, cakaj, docasnyPriecinok, kontroly, modulServera, nahodnyPort, pockaj, preskoc, spustiServer, vytvorApi,
} from './spolocne.mjs'

// Tmavý režim: OVERENIE_TEMA=tmavy node scripts/overenie/ui.mjs
const TEMA = process.env.OVERENIE_TEMA === 'tmavy' ? 'tmavy' : 'svetly'
const NAZOV = `Obrazovky appky (Chrome, 1275 × 748, ${TEMA === 'tmavy' ? 'tmavý' : 'svetlý'} režim)`
const SIRKA = 1275
const VYSKA = 748

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => p && fs.existsSync(p))
if (!CHROME) preskoc(NAZOV, 'nenašiel som Chrome ani Edge (cestu môžeš zadať v premennej CHROME_PATH)')
if (!fs.existsSync(path.join(KOREN, 'dist', 'index.html'))) {
  throw new Error('Chýba zostavená appka – najprv spusti npm run build.')
}

const t = kontroly(NAZOV)
const DATA = docasnyPriecinok()
const PORT = nahodnyPort()
/** Vymyslená adresa počítača v sieti Tailscale – Chrome ju pošle na tento počítač. */
const TS = 'moj-pc.tail1234.ts.net'
// Vymyslený kľúč: asistent sa tvári zapnutý (dá sa priložiť fotka), no nikdy sa nevolá.
const api = vytvorApi(await spustiServer(DATA, PORT, { aiKluc: 'test-kluc-nikdy-sa-nepouzije' }))
const ADRESA = `http://localhost:${PORT}`
const { dnesISO } = await modulServera('lib/format.js')
const { db, FILES_DIR } = await modulServera('db.js')

// ── Vymyslené údaje, aby mali obrazovky čo ukázať ─────────────
const dnes = dnesISO()
const posun = (dni) => {
  const d = new Date(dnes + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + dni)
  return d.toISOString().slice(0, 10)
}
await api('PUT', '/nastavenia', { meno: 'Ján Testovací', adresa: 'Hlavná 1', psc_mesto: '811 01 Bratislava', ico: '12345678' })
const firmy = []
for (const nazov of ['Ľubica Nováková s.r.o.', 'Montážna a stavebná spoločnosť Východ s.r.o.', 'Stavby Horák s.r.o.']) {
  firmy.push((await api('POST', '/firmy', { nazov, krajina: 'Slovensko', email: 'faktury@example.com' })).d.id)
}
const turnus = (
  await api('POST', '/turnusy', { nazov: 'Turnus Mníchov', krajina: 'Nemecko', company_id: firmy[2], datum_od: posun(-40), datum_do: posun(-20) })
).d.id
const faktury = [
  { company_id: firmy[0], datum_vystav: posun(-60), datum_splat: posun(-46), polozky: [{ popis: 'Montáž', mnozstvo: 40, jednotka: 'hod', cena: 25 }] },
  { company_id: firmy[1], datum_vystav: posun(-30), datum_splat: posun(-16), polozky: [{ popis: 'Zváranie', mnozstvo: 60, jednotka: 'hod', cena: 28 }], platby: [{ datum: posun(-10), suma: 500 }] },
  { company_id: firmy[2], tour_id: turnus, datum_vystav: posun(-19), datum_splat: posun(-5), stav: 'zaplatena', datum_uhrady: posun(-3), polozky: [{ popis: 'Práce na turnuse', mnozstvo: 120, jednotka: 'hod', cena: 27.5 }] },
  { company_id: firmy[0], datum_vystav: posun(-2), datum_splat: posun(12), polozky: [{ popis: 'Oprava konštrukcie', mnozstvo: 8, jednotka: 'hod', cena: 30 }] },
  { company_id: firmy[1], stav: 'koncept', datum_vystav: dnes, polozky: [{ popis: 'Rozpracovaná zákazka', mnozstvo: 1, cena: 900 }] },
]
const idFaktur = []
for (const f of faktury) idFaktur.push((await api('POST', '/faktury', f)).d.id)
for (const [dni, popis, kategoria, suma] of [
  [-35, 'Zváracie elektródy', 'Materiál', 64.9],
  [-25, 'Nafta cestou na turnus', 'PHM', 88.4],
  [-8, 'Pracovná obuv', 'Náradie', 49.99],
]) {
  await api('POST', '/vydavky', { datum: posun(dni), popis, kategoria, suma })
}

// ── Chrome ────────────────────────────────────────────────────
const LADIACI_PORT = 9300 + Math.floor(Math.random() * 400)
const PROFIL = path.join(DATA, 'chrome-profil')
const chrome = spawn(
  CHROME,
  [
    '--headless=new', `--remote-debugging-port=${LADIACI_PORT}`, `--user-data-dir=${PROFIL}`, '--no-first-run', '--disable-gpu',
    `--host-resolver-rules=MAP ${TS} 127.0.0.1`, 'about:blank',
  ],
  { stdio: 'ignore' },
)
process.on('exit', () => chrome.kill())

let ciel
for (let i = 0; i < 75 && !ciel; i++) {
  try {
    ciel = await (await fetch(`http://127.0.0.1:${LADIACI_PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  } catch {
    await cakaj(200)
  }
}
if (!ciel) throw new Error('Chrome sa nepodarilo spustiť.')

const ws = new WebSocket(ciel.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let dalsieId = 1
const cakajuce = new Map()
const chybyKonzoly = []
let systemoveOkna = 0
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && cakajuce.has(m.id)) {
    cakajuce.get(m.id)(m)
    cakajuce.delete(m.id)
  } else if (m.method === 'Runtime.exceptionThrown') {
    chybyKonzoly.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    chybyKonzoly.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    chybyKonzoly.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`.trim())
  } else if (m.method === 'Page.javascriptDialogOpening') {
    // Otázku prehliadača pri zatváraní okna s neuloženými zmenami (beforeunload)
    // appka inak ako systémovým oknom položiť nevie – tá sa nepočíta.
    const priOdchode = m.params.type === 'beforeunload'
    if (!priOdchode) systemoveOkna++
    ws.send(JSON.stringify({ id: dalsieId++, method: 'Page.handleJavaScriptDialog', params: { accept: priOdchode } }))
  }
})
const cdp = (method, params = {}) =>
  new Promise((r) => {
    const id = dalsieId++
    cakajuce.set(id, r)
    ws.send(JSON.stringify({ id, method, params }))
  })
const js = async (vyraz) =>
  (await cdp('Runtime.evaluate', { expression: vyraz, returnByValue: true, awaitPromise: true })).result?.result?.value

async function otvor(cesta) {
  await cdp('Page.navigate', { url: ADRESA + cesta })
  // Stránka je hotová, keď sa načítala a nič sa už nenačítava (žiadne „Načítavam…").
  await pockaj(() => js(`document.readyState === 'complete' && !!document.querySelector('.obsah')`), 8000)
  await cakaj(1200)
}

async function klik(selektor, poradie = 0) {
  const bod = await js(`(() => {
    const e = document.querySelectorAll(${JSON.stringify(selektor)})[${poradie}]
    if (!e) return null
    e.scrollIntoView({ block: 'center' })
    const r = e.getBoundingClientRect()
    return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]
  })()`)
  if (!bod) throw new Error('Na stránke chýba ' + selektor)
  await cakaj(200)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp('Input.dispatchMouseEvent', { type, x: bod[0], y: bod[1], button: 'left', clickCount: 1 })
  }
  await cakaj(700)
}

await cdp('Page.enable')
await cdp('Runtime.enable')
await cdp('Log.enable')
await cdp('Emulation.setDeviceMetricsOverride', { width: SIRKA, height: VYSKA, deviceScaleFactor: 1, mobile: false })
await cdp('Page.navigate', { url: ADRESA + '/' })
await cakaj(1500)
await js(`localStorage.setItem('zivnostapp-tema', '${TEMA}'); true`)

// ── Každá obrazovka: chyby, šírka, písmo, kontrast ────────────
// Kontrast počítame ako prehliadač: priesvitné pozadia a farby sa skladajú
// s tým, čo je pod nimi. Vynechávame vypnuté ovládacie prvky (norma ich
// nevyžaduje) a dekoratívne iniciály firiem (.avatar, skryté pre čítačky).
const MERANIE = `(() => {
  const rgba = (s) => { const c = (s.match(/[\\d.]+/g) || []).map(Number); return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 1] }
  const zloz = (hore, dole) => [0, 1, 2].map((i) => hore[i] * hore[3] + dole[i] * (1 - hore[3]))
  const pozadie = (el) => {
    const vrstvy = []
    for (let e = el; e; e = e.parentElement) vrstvy.push(rgba(getComputedStyle(e).backgroundColor))
    return vrstvy.reverse().reduce((spodok, v) => zloz(v, spodok), [255, 255, 255])
  }
  const jas = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const slabe = []
  let najmensie = 99
  let najmensieKde = ''
  for (const el of document.querySelectorAll('.obsah *, .spodne-menu *')) {
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('')
    if (text.length < 2) continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    if (el.closest('.avatar, [disabled], [aria-disabled="true"]')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden') continue
    const px = parseFloat(cs.fontSize)
    if (px < najmensie) { najmensie = px; najmensieKde = el.className || el.tagName }
    const pod = pozadie(el)
    const farba = zloz(rgba(cs.color), pod)
    const [a, b] = [jas(farba), jas(pod)].sort((x, y) => y - x)
    const pomer = (a + 0.05) / (b + 0.05)
    const velky = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700)
    if (pomer < (velky ? 3 : 4.5)) slabe.push(text.slice(0, 30) + ' (' + pomer.toFixed(2) + ')')
  }
  const pretekajuce = [...document.querySelectorAll('.obsah *')]
    .filter((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1)
    .map((e) => e.className || e.tagName)
  return {
    slabe, najmensie, najmensieKde, pretekajuce,
    stranaSaPosuva: document.documentElement.scrollWidth > innerWidth + 1,
  }
})()`

// ── Prvé spustenie: sprievodca ────────────────────────────────
// React si hodnotu poľa drží sám – nastavíme ju tak, ako keby ju napísal človek.
const nastav = (selektor, hodnota) =>
  js(`(() => {
    const e = document.querySelector(${JSON.stringify(selektor)})
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(hodnota)})
    e.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
const krokSprievodcu = () => js(`document.querySelector('.sprievodca-krok')?.textContent.trim() ?? null`)
const dalej = async () => {
  await klik('.sprievodca-akcie button[type=submit]')
  await cakaj(400)
}
const zmeraj = async (nazov) => {
  const m = await js(MERANIE)
  t.over(`${nazov}: nič nepretŕča, písmo aspoň 12 px, kontrast podľa normy`, [m.stranaSaPosuva, m.pretekajuce, m.najmensie >= 12, m.slabe], [false, [], true, []])
}

t.sekcia('Sprievodca prvým spustením')
chybyKonzoly.length = 0
await otvor('/')
t.over('nová appka otvorí najprv sprievodcu', await js('location.pathname'), '/sprievodca')
t.over('začína prvým z piatich krokov', await krokSprievodcu(), 'Krok 1 z 5')
await zmeraj('krok 1')
await nastav('#s-meno', '')
await dalej()
t.over('bez mena nepustí ďalej a povie prečo', [await krokSprievodcu(), await js(`document.querySelector('.sprievodca .chyba')?.textContent`)], ['Krok 1 z 5', 'Vyplň meno – bez neho sa faktúra vystaviť nedá.'])
await nastav('#s-meno', 'Ján Testovací')
await dalej()
t.over('po vyplnení mena ide na adresu', await krokSprievodcu(), 'Krok 2 z 5')
await nastav('#s-adresa', 'Hlavná 12')
await nastav('#s-psc', '089 01 Svidník')
await dalej()
await nastav('#s-iban', 'SK24 1100 0000 0026 1234 5679')
await cakaj(200)
t.over('preklep v IBAN-e appka zbadá', await js(`!!document.querySelector('.sprievodca .napoveda .chybna')`), true)
await nastav('#s-iban', 'SK24 1100 0000 0026 1234 5678')
await cakaj(200)
t.over('správny IBAN prejde', await js(`!document.querySelector('.sprievodca .napoveda .chybna')`), true)
await dalej()
t.over('štvrtý krok: kde pracuje', await krokSprievodcu(), 'Krok 4 z 5')
await zmeraj('krok 4 (voľby)')
await klik('.volba', 1)
t.over('voľba „turnusy v zahraničí" je vybraná', await js(`document.querySelectorAll('.volba')[1].getAttribute('aria-checked')`), 'true')
await dalej()
await klik('.volba', 1)
t.over('pri § 7a sa objaví pole na IČ DPH', await js(`!!document.querySelector('#s-icdph')`), true)
await klik('.volba', 0)
await klik('.sprievodca-riadok button', 2)
await dalej()
t.over('na konci „Hotovo"', await js(`document.querySelector('.sprievodca h1')?.textContent`), 'Hotovo, môžeš začať')
await zmeraj('záver')
const ulozene = (await api('GET', '/nastavenia')).d
t.over(
  'všetko sa uložilo',
  [ulozene.sprievodca_hotovy, ulozene.adresa, ulozene.iban, ulozene.praca_v_zahranici, ulozene.dph_rezim, ulozene.splatnost_dni],
  [1, 'Hlavná 12', 'SK24 1100 0000 0026 1234 5678', 1, 'neplatitel', 30],
)
t.over('bez chýb v konzole', chybyKonzoly, [])
await otvor('/')
t.over('po sprievodcovi sa appka otvára Prehľadom', await js('location.pathname'), '/')

const OBRAZOVKY = [
  ['/', 'Prehľad'], ['/terminy', 'Termíny'], ['/faktury', 'Faktúry'], ['/faktury/nova', 'Nová faktúra'], ['/upomienky', 'Upomienky'],
  ['/turnusy', 'Turnusy'], ['/objednavky', 'Objednávky'], ['/zmluvy', 'Zmluvy'], ['/firmy', 'Firmy'],
  ['/vydavky', 'Výdavky'], ['/banka', 'Výpis z banky'], ['/financie', 'Financie'], ['/dph', 'DPH'], ['/danovy-podklad', 'Daňový podklad'],
  ['/asistent', 'Asistent'], ['/kos', 'Kôš'], ['/nastavenia', 'Nastavenia'],
]
for (const [cesta, nazov] of OBRAZOVKY) {
  chybyKonzoly.length = 0
  await otvor(cesta)
  const m = await js(MERANIE)
  t.sekcia(nazov)
  t.over('bez chýb v konzole', chybyKonzoly, [])
  t.over('nič nepretŕča do strany', [m.stranaSaPosuva, m.pretekajuce], [false, []])
  t.over('písmo aspoň 12 px', m.najmensie >= 12 ? true : `${m.najmensie} px (${m.najmensieKde})`, true)
  t.over('kontrast textu podľa normy', m.slabe, [])
}

// ── Fotka pre asistenta ───────────────────────────────────────
// Fotka z mobilu (tu 4000 × 3000) sa pred odoslaním zmenší na 2000 px na dlhšej strane.
t.sekcia('Fotka pre asistenta')
await otvor('/asistent')
await js(`(async () => {
  const platno = document.createElement('canvas')
  platno.width = 4000
  platno.height = 3000
  const k = platno.getContext('2d')
  for (let i = 0; i < 400; i++) {
    k.fillStyle = 'hsl(' + (i * 37) % 360 + ', 70%, 50%)'
    k.fillRect((i * 97) % 4000, (i * 53) % 3000, 300, 200)
  }
  const blob = await new Promise((r) => platno.toBlob(r, 'image/jpeg', 0.98))
  const prenos = new DataTransfer()
  prenos.items.add(new File([blob], 'blocik z mobilu.jpg', { type: 'image/jpeg' }))
  const vstup = document.querySelector('.ai-stranka input[type=file]')
  vstup.files = prenos.files
  vstup.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)
await pockaj(() => !!db.prepare('SELECT 1 FROM chat_files').get(), 8000)
const nahrata = db.prepare('SELECT nazov, ulozeny_nazov, mime, velkost FROM chat_files ORDER BY id DESC LIMIT 1').get()
/** Šírka a výška JPEG-u z hlavičky (značka SOF). */
function rozmeryJpeg(b) {
  for (let i = 2; i + 9 < b.length; i += 2 + b.readUInt16BE(i + 2)) {
    if (b[i] !== 0xff) return null
    if ([0xc0, 0xc1, 0xc2].includes(b[i + 1])) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]
  }
  return null
}
const subor = nahrata && fs.readFileSync(path.join(FILES_DIR, 'chat', nahrata.ulozeny_nazov))
t.over('fotka sa nahrala ako JPEG', [nahrata?.nazov, nahrata?.mime], ['blocik z mobilu.jpg', 'image/jpeg'])
t.over('zmenšená na 2000 × 1500 px', subor && rozmeryJpeg(subor), [2000, 1500])
t.over('a má menej než 2 MB', !!nahrata && nahrata.velkost < 2 * 1024 * 1024, true)

// ── Termíny ───────────────────────────────────────────────────
t.sekcia('Termíny')
const najblizsiaSplatnost = (await api('GET', `/faktury/${idFaktur[3]}`)).d.cislo
await otvor('/')
t.over(
  'Prehľad ukazuje najbližšie termíny aj splatnosť faktúry',
  await js(`[...document.querySelectorAll('.terminy-zoznam .termin-nazov')].map((e) => e.textContent).includes('Splatnosť faktúry ${najblizsiaSplatnost}')`),
  true,
)
await otvor('/terminy')
t.over('stránka Termíny ich zoskupí po mesiacoch', await js(`document.querySelectorAll('.panel .terminy-zoznam').length > 0`), true)

// ── Výpis z banky ─────────────────────────────────────────────
t.sekcia('Výpis z banky')
const najstarsia = (await api('GET', `/faktury/${idFaktur[0]}`)).d
const vypisCsv = [
  'Dátum;Suma;Variabilný symbol;Názov protiúčtu;Správa pre príjemcu',
  `${posun(-1).split('-').reverse().join('.')};${String(najstarsia.otvoreny_zostatok).replace('.', ',')};${najstarsia.variabilny};Ľubica Nováková s.r.o.;Úhrada faktúry`,
  `${posun(-2).split('-').reverse().join('.')};-35,00;;Ján Novák;obed`,
].join('\n')
await otvor('/banka')
await js(`(() => {
  const prenos = new DataTransfer()
  prenos.items.add(new File([${JSON.stringify(vypisCsv)}], 'vypis.csv', { type: 'text/csv' }))
  const vstup = document.querySelector('.hlavicka input[type=file]')
  vstup.files = prenos.files
  vstup.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)
await pockaj(() => js(`!!document.querySelector('.tabulka-obal tbody select')`), 8000)
t.over('platba z výpisu je navrhnutá k správnej faktúre', await js(`document.querySelector('.tabulka-obal tbody select').value`), `f:${idFaktur[0]}`)
t.over(
  'odchádzajúca platba je v samostatnej tabuľke a bez návrhu sa nezapíše',
  await js(`[document.querySelectorAll('.tabulka-vydajov tbody tr').length, document.querySelector('.tabulka-vydajov select')?.value]`),
  [1, 'preskocit'],
)
await zmeraj('Výpis z banky s návrhmi')
await klik('.riadok-akcii button.primar')
await cakaj(600)
const oznamBanky = `document.querySelector('.oznam .oznam-text')?.textContent ?? ''`
t.over('zápis ohlási, čo sa zapísalo', (await js(oznamBanky)).startsWith('Zapísané: 1 platba k faktúram'), true)
t.over('faktúra je uhradená', (await api('GET', `/faktury/${idFaktur[0]}`)).d.stav_zobraz, 'zaplatena')
t.over('platba je vo výpise označená ako zapísaná', await js(`document.querySelector('.tabulka-obal tbody .stitok')?.textContent`), 'už zapísaná')
await klik('.oznam-akcia')
await cakaj(1000)
t.over('„Vrátiť späť" import zruší', (await api('GET', `/faktury/${idFaktur[0]}`)).d.stav_zobraz !== 'zaplatena', true)

// ── Prístup z telefónu ────────────────────────────────────────
// Vymyslený Tailscale, v ktorom je prístup zapnutý. Telefón predstiera Chrome
// otvorením appky na adrese Tailscale (tá vedie späť na tento počítač).
t.sekcia('Prístup z telefónu')
const { nahradSpustac } = await modulServera('lib/pristup.js')
nahradSpustac(async (args) => {
  const prikaz = args.join(' ')
  if (prikaz === 'status --json') return { kod: 0, vystup: JSON.stringify({ BackendState: 'Running', Self: { DNSName: TS + '.' } }) }
  if (prikaz === 'serve status --json') {
    return { kod: 0, vystup: JSON.stringify({ Web: { [`${TS}:443`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${PORT}` } } } } }) }
  }
  return { kod: 1, vystup: '' }
})
await otvor('/nastavenia')
await pockaj(() => js(`!!document.querySelector('.pristup-qr .qr-kod')?.naturalWidth`), 5000)
t.over(
  'Nastavenia ukážu QR kód a adresu pre telefón',
  await js(`[!!document.querySelector('.pristup-qr .qr-kod')?.naturalWidth, document.querySelector('.pristup-adresa')?.textContent]`),
  [true, `https://${TS}`],
)
await zmeraj('Nastavenia s QR kódom')
await otvor('/vydavky')
const tlacidloFotky = `[...document.querySelectorAll('.hlavicka button')].find((b) => b.textContent.includes('Odfotiť telefónom'))`
t.over('vo Výdavkoch je „Odfotiť telefónom"', await js(`!!${tlacidloFotky}`), true)
await js(`${tlacidloFotky}.click(); true`)
await cakaj(800)
t.over('…ukáže QR kód na nový výdavok', await js(`document.querySelector('.dialog h2')?.textContent`), 'Odfotiť doklad telefónom')
await zmeraj('Okno s QR kódom')
await api('POST', '/vydavky', { datum: dnes, popis: 'Doklad z telefónu', kategoria: 'Materiál', suma: 12.5 })
await pockaj(() => js(`!document.querySelector('.dialog')`), 8000)
t.over(
  '…keď z telefónu príde výdavok, okno sa zavrie a appka to ohlási',
  [await js(`!document.querySelector('.dialog')`), await js(oznamBanky)],
  [true, 'Výdavok z telefónu je uložený.'],
)
const manifest = await fetch(ADRESA + '/manifest.webmanifest')
t.over('appka sa v telefóne dá pridať na plochu (manifest s ikonami)', [manifest.status, (await manifest.json()).icons.length], [200, 3])

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
chybyKonzoly.length = 0
await cdp('Page.navigate', { url: `http://${TS}:${PORT}/vydavky?novy=1&foto=1` })
await pockaj(() => js(`document.readyState === 'complete' && !!document.querySelector('.obsah')`), 8000)
await cakaj(1200)
t.over(
  'telefón cez adresu Tailscale otvorí nový výdavok s fotoaparátom na prvom mieste',
  await js(`[location.hostname, !!document.querySelector('.foto-dokladu'), document.querySelector('input[capture]')?.getAttribute('capture'), document.activeElement?.tagName]`),
  [TS, true, 'environment', 'BODY'],
)
await zmeraj('Nový výdavok v telefóne')
await cdp('Page.navigate', { url: `http://${TS}:${PORT}/nastavenia` })
await pockaj(() => js(`document.readyState === 'complete' && !!document.querySelector('.obsah')`), 8000)
await cakaj(1200)
t.over(
  'v telefóne Nastavenia nepustia prístup vypnúť',
  await js(`[document.body.textContent.includes('Appku práve používaš cez telefón'), [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Vypnúť prístup'))]`),
  [true, false],
)
t.over('bez chýb v konzole', chybyKonzoly, [])
await cdp('Emulation.setDeviceMetricsOverride', { width: SIRKA, height: VYSKA, deviceScaleFactor: 1, mobile: false })
nahradSpustac(null)

// ── Cudzia mena a e-faktúra vo výdavku ───────────────────────
t.sekcia('Cudzia mena a e-faktúra')
const fetchPredKurzami = globalThis.fetch
globalThis.fetch = async (url, ...zvysok) => {
  if (!String(url).startsWith('https://api.frankfurter.dev/')) return fetchPredKurzami(url, ...zvysok)
  return new Response(JSON.stringify({ amount: 1, base: 'EUR', date: posun(-1), rates: { CZK: 25 } }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
const zvol = (selektor, hodnota) =>
  js(`(() => {
    const e = document.querySelector(${JSON.stringify(selektor)})
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, ${JSON.stringify(hodnota)})
    e.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
await otvor('/vydavky')
await klik('.hlavicka .primar')
await zvol('.suma-s-menou select', 'CZK')
await nastav('#suma-vydavku', '1250')
await pockaj(() => js(`document.querySelector('#suma-v-eurach')?.value === '50'`), 5000)
t.over(
  'pri českých korunách appka doplní kurz ECB a sumu v eurách',
  await js(`[document.querySelector('#kurz-vydavku')?.value, document.querySelector('#suma-v-eurach')?.value, document.querySelector('label[for=suma-vydavku]')?.textContent]`),
  ['25', '50', 'Suma (CZK) *'],
)
await nastav('.panel input[autofocus], .panel .pole-siroke input', 'Nafta v Česku')
await zmeraj('Výdavok v cudzej mene')
await klik('.panel .riadok-akcii .primar')
await pockaj(() => js(`[...document.querySelectorAll('tbody tr')].some((r) => r.textContent.includes('Nafta v Česku'))`), 5000)
t.over(
  'v zozname je suma v eurách aj v korunách',
  await js(`[...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Nafta v Česku'))?.querySelector('td.cislo')?.innerText.replace(/\\s+/g, ' ')`),
  '50,00 € 1 250,00 CZK',
)
globalThis.fetch = fetchPredKurzami

const efakturaXml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>2026000123</cbc:ID><cbc:IssueDate>${posun(-3)}</cbc:IssueDate><cbc:DueDate>${posun(11)}</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Orange Slovensko, a.s.</cbc:RegistrationName><cbc:CompanyID>35697270</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Ján Testovací</cbc:RegistrationName><cbc:CompanyID>12345678</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cbc:PaymentID>2026000123</cbc:PaymentID></cac:PaymentMeans>
  <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="EUR">24.99</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">24.99</cbc:PayableAmount></cac:LegalMonetaryTotal>
</Invoice>`
await otvor('/vydavky')
await klik('.hlavicka .primar')
await js(`(() => {
  const prenos = new DataTransfer()
  prenos.items.add(new File([${JSON.stringify(efakturaXml)}], 'faktura.xml', { type: 'application/xml' }))
  const vstup = document.querySelector('.riadok-nastroju input[type=file]')
  vstup.files = prenos.files
  vstup.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)
await pockaj(() => js(`!!document.querySelector('.panel .info-pruh')`), 5000)
t.over(
  'e-faktúra (XML) vyplní formulár a pripraví sa ako doklad',
  await js(`[document.querySelector('#suma-vydavku').value, document.querySelector('.panel .pole-siroke input').value, document.querySelector('.panel .info-pruh').textContent.includes('Orange Slovensko, a.s.'), [...document.querySelector('.panel').querySelectorAll('.typ-s-ikonou')].map((e) => e.textContent.trim())]`),
  ['24.99', 'Orange Slovensko, a.s. – faktúra 2026000123', true, ['faktura.xml']],
)
await zmeraj('Výdavok z e-faktúry')
await klik('.panel .riadok-akcii button', 0)

// ── Výkaz hodín ───────────────────────────────────────────────
t.sekcia('Výkaz hodín pri turnuse')
await otvor(`/turnusy/${turnus}`)
t.over('pri ukončenom turnuse bez hodín je výkaz zbalený', await js(`document.querySelector('details.vykaz-hodin')?.open`), false)
await klik('details.vykaz-hodin > summary')
await nastav('#sadzba-turnusu', '27.5')
await klik('.vykaz-hromadne-riadok button')
// Pondelok až sobota v období turnusu (40 až 20 dní dozadu) po 10 hodín.
let pracovnych = 0
for (let d = -40; d <= -20; d++) if (new Date(posun(d) + 'T12:00:00Z').getUTCDay() !== 0) pracovnych++
t.over(
  '„Vyplniť" dá 10 h každému dňu okrem nedieľ a spočíta sumu',
  (await js(`document.querySelector('.vykaz-sucet').textContent`)).replace(/\s+/g, ' '),
  `Spolu ${pracovnych * 10} h × 27,50 € = ${new Intl.NumberFormat('sk-SK', { minimumFractionDigits: 2 }).format(pracovnych * 275)} €`.replace(/\s+/g, ' '),
)
await zmeraj('Výkaz hodín')
await klik('.vykaz-hodin .riadok-akcii .primar')
t.over('turnus už má faktúru – appka sa spýta', await js(`document.querySelector('.dialog.maly h2')?.textContent`), 'K turnusu už je faktúra')
await klik('.dialog.maly .riadok-akcii button', 1)
await pockaj(() => js(`location.pathname.startsWith('/faktury/') && location.pathname !== '/faktury/nova'`), 8000)
const zVykazu = (await api('GET', '/faktury' + (await js('location.pathname')).slice('/faktury'.length))).d
t.over(
  'faktúra za turnus: koncept s hodinami a sadzbou z výkazu',
  [zVykazu.stav, zVykazu.tour_id, zVykazu.polozky[0].mnozstvo, zVykazu.polozky[0].jednotka, zVykazu.polozky[0].cena],
  ['koncept', turnus, pracovnych * 10, 'hod', 27.5],
)
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await otvor(`/turnusy/${turnus}`)
await zmeraj('Výkaz hodín – telefón')
await cdp('Emulation.setDeviceMetricsOverride', { width: SIRKA, height: VYSKA, deviceScaleFactor: 1, mobile: false })
await api('DELETE', `/faktury/${zVykazu.id}`)

// ── Časová os faktúry a logo ──────────────────────────────────
t.sekcia('Časová os faktúry a logo')
const sPlatbou = (await api('GET', `/faktury/${idFaktur[1]}`)).d
const datumZnacky = posun(-25).split('-').reverse().map((x) => String(Number(x))).join('.')
await api('PUT', `/faktury/${idFaktur[1]}`, { poznamka: `[${datumZnacky} odoslané na faktury@example.com]` })
await otvor(`/faktury/${idFaktur[1]}`)
t.over(
  'časová os: vystavená, odoslaná, platba a splatnosť po termíne',
  await js(`[...document.querySelectorAll('.casova-os li .casova-os-text')].map((e) => e.textContent)`),
  ['Vystavená', 'Odoslaná e-mailom na faktury@example.com', 'Splatnosť – 16 dní po splatnosti', 'Platba 500,00 €'],
)
await zmeraj('Časová os faktúry')
await api('PUT', `/faktury/${idFaktur[1]}`, { poznamka: sPlatbou.poznamka })
const logoPng = new FormData()
logoPng.append('logo', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')]), 'logo.png')
await api('POST', '/nastavenia/logo', logoPng)
await otvor('/nastavenia')
await pockaj(() => js(`!!document.querySelector('.logo-nastavenie img')?.naturalWidth`), 5000)
t.over('v Nastaveniach je náhľad loga', await js(`!!document.querySelector('.logo-nastavenie img')?.naturalWidth`), true)
await api('POST', '/nastavenia/logo/odobrat')

// ── Akcie s „Vrátiť späť" a vlastné okná ─────────────────────
t.sekcia('Akcie na faktúrach')
const riadky = `document.querySelectorAll('.tabulka-faktur tbody tr').length`
const oznam = `document.querySelector('.oznam .oznam-text')?.textContent`
await otvor('/faktury')
const pred = await js(riadky)
const cislo = await js(`document.querySelector('.tabulka-faktur tbody tr .cislo-faktury').textContent`)
await klik('.tabulka-faktur .akcie-riadku .zmazat')
t.over('zmazanie: faktúra zmizne zo zoznamu', await js(riadky), pred - 1)
t.over('…ukáže sa oznámenie', await js(oznam), `Faktúra ${cislo} je v koši.`)
await klik('.oznam-akcia')
await cakaj(800)
t.over('…a „Vrátiť späť" ju vráti', await js(riadky), pred)

const stavRiadku = (c) =>
  js(`[...document.querySelectorAll('.tabulka-faktur tbody tr')].find((r) => r.querySelector('.cislo-faktury')?.textContent === ${JSON.stringify(c)})?.querySelector('.stitok')?.textContent.trim()`)
const nezaplatena = await js(
  `[...document.querySelectorAll('.tabulka-faktur tbody tr')].find((r) => r.querySelector('.vyplatit'))?.querySelector('.cislo-faktury').textContent`,
)
await klik('.tabulka-faktur .akcie-riadku .vyplatit')
t.over('„Uhradená": oznámenie', (await js(oznam))?.startsWith(`Faktúra ${nezaplatena}`), true)
t.over('…faktúra je vyplatená', await stavRiadku(nezaplatena), 'Uhradená')
await klik('.oznam-akcia')
await cakaj(800)
t.over('…a „Vrátiť späť" platbu zruší', (await stavRiadku(nezaplatena)) !== 'Uhradená', true)

t.sekcia('Otázky vo vlastnom okne')
await otvor('/faktury/nova')
await js(`(() => { const e = document.querySelector('.obsah input:not([type=date])'); e.focus(); e.select?.(); return true })()`)
await cdp('Input.insertText', { text: '2099999' })
await cakaj(400)
await klik('a[href="/vydavky"]')
t.over('odchod z rozpísanej faktúry: appka sa spýta', (await js(`document.querySelector('.dialog.maly h2')?.textContent`)) ?? null, 'Máš neuložené zmeny. Naozaj chceš odísť?')
await klik('.dialog.maly .riadok-akcii button', 0)
t.over('…po „Ostať tu" ostane formulár otvorený', await js(`location.pathname`), '/faktury/nova')
await klik('a[href="/vydavky"]')
await klik('.dialog.maly .riadok-akcii button', 1)
t.over('…po „Odísť bez uloženia" sa prejde ďalej', await js(`location.pathname`), '/vydavky')

await otvor('/faktury')
await klik('.tabulka-faktur .akcie-riadku .zmazat')
await otvor('/kos')
await klik('tbody button.nebezpecne')
t.over('zmazanie natrvalo sa pýta vo vlastnom okne', (await js(`document.querySelector('.dialog.maly h2')?.textContent`))?.includes('natrvalo'), true)
await klik('.dialog.maly .riadok-akcii button', 0)
t.over('…po „Zrušiť" sa okno zavrie', await js(`!document.querySelector('.dialog.maly')`), true)
t.over('appka nepoužila ani jedno systémové okno', systemoveOkna, 0)

// ── Platiteľ DPH ──────────────────────────────────────────────
// Zostane zapnuté aj pre telefón nižšie – tam sa tak skontroluje aj faktúra s DPH a stránka DPH.
t.sekcia('Platiteľ DPH')
await api('PUT', '/nastavenia', { dph_rezim: 'platitel', ic_dph: 'SK2020123456' })
const fakturaSDph = (await api('POST', '/faktury', {
  company_id: firmy[0], datum_dodania: posun(-3), polozky: [{ popis: 'Montáž', mnozstvo: 10, jednotka: 'hod', cena: 30 }],
})).d.id
await otvor(`/faktury/${fakturaSDph}`)
t.over(
  'faktúra platiteľa má stĺpec DPH a súčet s DPH',
  await js(`[[...document.querySelectorAll('thead th')].some((th) => th.textContent === 'DPH'), document.querySelector('.sucty-dph')?.textContent.includes('Celkom s DPH: 369,00')]`),
  [true, true],
)
await zmeraj('Faktúra s DPH')
await otvor('/dph')
t.over(
  'v menu pribudne DPH a prehľad má 12 mesiacov',
  await js(`[!!document.querySelector('.sidebar a[href="/dph"]'), document.querySelectorAll('.tabulka-dph tbody tr').length]`),
  [true, 12],
)
await zmeraj('Prehľad DPH')

// ── Telefón ───────────────────────────────────────────────────
// Rovnaké obrazovky na šírke telefónu: bočné menu sa vysúva, dole je lišta,
// tabuľky s viac stĺpcami sú karty a nič nesmie pretŕčať do strany.
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
for (const [cesta, nazov] of OBRAZOVKY) {
  chybyKonzoly.length = 0
  await otvor(cesta)
  const m = await js(MERANIE)
  t.sekcia(`${nazov} – telefón`)
  t.over('bez chýb v konzole', chybyKonzoly, [])
  t.over(
    'nič nepretŕča, písmo aspoň 12 px, kontrast podľa normy',
    [m.stranaSaPosuva, m.pretekajuce, m.najmensie >= 12 ? true : `${m.najmensie} px (${m.najmensieKde})`, m.slabe],
    [false, [], true, []],
  )
}

t.sekcia('Ovládanie na telefóne')
await otvor('/faktury')
const bocneMenuVidno = () => js(`document.querySelector('.sidebar').getBoundingClientRect().right > 0`)
t.over('dole je lišta s hlavnými stránkami', await js(`getComputedStyle(document.querySelector('.spodne-menu')).display`), 'grid')
t.over('bočné menu je schované', await bocneMenuVidno(), false)
t.over(
  'faktúry v troch riadkoch: číslo a dátum, odberateľ, stav a suma',
  await js(`(() => { const r = document.querySelector('.zoznam-faktur .faktura-riadok'); return [!!r.querySelector('.cislo-faktury'), !!r.querySelector('.faktura-riadok-firma'), !!r.querySelector('.faktura-riadok-suma .stitok, .faktura-riadok-suma strong'), r.getBoundingClientRect().height < 200, !document.querySelector('.tabulka-faktur')] })()`),
  [true, true, true, true, true],
)
await klik('.faktura-riadok .menu-akcii button')
t.over(
  'ponuka ⋮ pri faktúre: uhradená, PDF, kôš',
  await js(`[...document.querySelectorAll('.menu-akcii-zoznam [role=menuitem]')].map((e) => e.textContent.trim())`),
  ['Označiť ako uhradenú', 'Otvoriť PDF', 'Presunúť do koša'],
)
await klik('.spodne-menu a[href="/faktury"]')
t.over('filtre firmy, turnusu a roka sú schované pod tlačidlom Filter', await js(`[!!document.querySelector('.tlacidlo-filtra'), document.querySelectorAll('.filtre select').length]`), [true, 0])
await klik('.tlacidlo-filtra')
t.over('…a ťuknutím sa ukážu', await js(`document.querySelectorAll('.filtre select').length`), 3)
await otvor(`/faktury/${idFaktur[3]}`)
t.over(
  'faktúra v telefóne: položky ako riadky, „Viac údajov" zbalené, Uložiť stále po ruke',
  await js(`[document.querySelectorAll('.polozka-riadok').length > 0, document.querySelector('details.viac-udajov').open, getComputedStyle(document.querySelector('.lepkave-akcie')).position]`),
  [true, false, 'sticky'],
)
await klik('.polozka-riadok')
t.over('ťuknutím sa položka otvorí na úpravu', await js(`!!document.querySelector('.polozka-editor input')`), true)
await zmeraj('Úprava položky v telefóne')
// Dlhý popis položky sa zalomí a neprekryje sumu (na iPhone sa v tlačidle nezalamoval).
const dlhaPolozka = (await api('POST', '/faktury', {
  company_id: firmy[0],
  polozky: [{ popis: 'Dokončovacie stavebné práce – KW 37/38 Pleidelsheim, montáž oceľovej konštrukcie', mnozstvo: 1, cena: 1323 }],
})).d.id
await otvor(`/faktury/${dlhaPolozka}`)
t.over(
  'dlhý popis položky sa zalomí a neprekryje sumu',
  await js(`(() => { const r = document.querySelector('.polozka-riadok').getBoundingClientRect(); const n = document.querySelector('.polozka-nazov').getBoundingClientRect(); const s = document.querySelector('.polozka-suma').getBoundingClientRect(); return [n.right <= s.left + 1, n.right <= r.right, n.height > 30] })()`),
  [true, true, true],
)
await klik('.odkaz-tlacidlo')
t.over('„Viac údajov" pri odberateľovi otvorí jeho údaje', await js(`document.querySelector('#odberatel-nazov')?.value`), 'Ľubica Nováková s.r.o.')
await zmeraj('Údaje odberateľa v telefóne')
await nastav('#odberatel-kontaktna_osoba', 'Ing. Peter Kováč')
await klik('.okno-udajov .riadok-akcii .primar')
await pockaj(async () => (await api('GET', `/firmy/${firmy[0]}`)).d.kontaktna_osoba === 'Ing. Peter Kováč', 5000)
t.over('…a uloží ich k firme', (await api('GET', `/firmy/${firmy[0]}`)).d.kontaktna_osoba, 'Ing. Peter Kováč')
await klik('.odkaz-tlacidlo', 1)
t.over('„Viac údajov" pri dodávateľovi ukáže moje údaje z Nastavení', await js(`document.querySelector('#dodavatel-meno')?.value`), (await api('GET', '/nastavenia')).d.meno)
await klik('.okno-udajov .riadok-akcii button', 0)
await api('DELETE', `/faktury/${dlhaPolozka}`)
await otvor('/financie')
t.over(
  'súčty vo Financiách sú v telefóne jeden zoznam pod sebou',
  await js(`(() => { const k = [...document.querySelectorAll('.karty.kompaktne > .karticka')].map((x) => x.getBoundingClientRect()); return k.length > 2 && k.every((x) => Math.round(x.left) === Math.round(k[0].left)) })()`),
  true,
)
await otvor('/faktury')
await klik('.spodne-menu button')
await cakaj(300)
t.over('„Viac" vysunie celé menu', await bocneMenuVidno(), true)
await klik('.sidebar a[href="/firmy"]')
await cakaj(300)
t.over('po výbere stránky sa menu samo zavrie', [await js('location.pathname'), await bocneMenuVidno()], ['/firmy', false])
t.over(
  'výdavky sú samostatné karty s popisom pri každej hodnote',
  await (async () => {
    await otvor('/vydavky')
    return js(`(() => { const t = document.querySelector('.panel.tesny table'); const r = t.querySelector('tbody tr'); const cs = getComputedStyle(r); return [t.hasAttribute('data-karty'), r.querySelector('td:nth-child(3)').dataset.popis, cs.marginBottom, cs.borderTopStyle] })()`)
  })(),
  [true, 'Kategória', '12px', 'solid'],
)
await otvor('/faktury')
t.over(
  'záložky faktúr sú v rovnakej mriežke po dve',
  await js(`(() => { const b = [...document.querySelectorAll('.taby button')].map((x) => x.getBoundingClientRect()); return [b.length, Math.round(b[0].width) === Math.round(b[1].width), Math.round(b[0].left) === Math.round(b[2].left)] })()`),
  [4, true, true],
)
await otvor('/')
t.over(
  'dlaždice na Prehľade nič neorežú (stav turnusu, sumy)',
  await js(`[...document.querySelectorAll('.dlazdica-tabulka td')].filter((td) => { const p = td.closest('.panel').getBoundingClientRect(); const r = td.getBoundingClientRect(); return r.width > 0 && r.right > p.right + 1 }).length`),
  0,
)
// iPhone so zobrazenými lištami prehliadača má okno len asi 660 px na výšku.
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 660, deviceScaleFactor: 1, mobile: true })
await otvor('/')
await klik('.spodne-menu button')
await cakaj(300)
t.over(
  'aj na nízkom okne ukáže „Viac" všetky stránky (Zmluvy, Firmy, Asistent…)',
  await js(`['/zmluvy', '/firmy', '/asistent', '/upomienky'].every((c) => document.querySelector('.sidebar a[href="' + c + '"]')?.getBoundingClientRect().height > 30)`),
  true,
)

ws.close()
chrome.kill()
t.koniec()
