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
  ['--headless=new', `--remote-debugging-port=${LADIACI_PORT}`, `--user-data-dir=${PROFIL}`, '--no-first-run', '--disable-gpu', 'about:blank'],
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
  ['/vydavky', 'Výdavky'], ['/banka', 'Výpis z banky'], ['/financie', 'Financie'], ['/danovy-podklad', 'Daňový podklad'],
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
await klik('.riadok-akcii button.primar')
await cakaj(600)
const oznamBanky = `document.querySelector('.oznam .oznam-text')?.textContent ?? ''`
t.over('zápis ohlási, čo sa zapísalo', (await js(oznamBanky)).startsWith('Zapísané: 1 platba k faktúram'), true)
t.over('faktúra je uhradená', (await api('GET', `/faktury/${idFaktur[0]}`)).d.stav_zobraz, 'zaplatena')
t.over('platba je vo výpise označená ako zapísaná', await js(`document.querySelector('.tabulka-obal tbody .stitok')?.textContent`), 'už zapísaná')
await klik('.oznam-akcia')
await cakaj(1000)
t.over('„Vrátiť späť" import zruší', (await api('GET', `/faktury/${idFaktur[0]}`)).d.stav_zobraz !== 'zaplatena', true)

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
  'faktúry sú karty s popisom pri každej hodnote',
  await js(`(() => { const t = document.querySelector('.tabulka-faktur'); return [t.hasAttribute('data-karty'), getComputedStyle(t.querySelector('thead')).display, t.querySelector('tbody td:nth-child(2)').dataset.popis] })()`),
  [true, 'none', 'Odberateľ'],
)
await klik('.spodne-menu button')
await cakaj(300)
t.over('„Viac" vysunie celé menu', await bocneMenuVidno(), true)
await klik('.sidebar a[href="/firmy"]')
await cakaj(300)
t.over('po výbere stránky sa menu samo zavrie', [await js('location.pathname'), await bocneMenuVidno()], ['/firmy', false])

ws.close()
chrome.kill()
t.koniec()
