// Logika servera na čistej databáze s vymyslenými údajmi: platby a ich
// vrátenie, zálohové faktúry, kôš, súkromné príjmy, hľadanie, splatnosť,
// časové pásmo, automatické zálohy, ochrana dát a obmedzenia asistenta.
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import {
  docasnyPriecinok, kontroly, modulServera, nahodnyPort, pockaj, spustiServer, vytvorApi, ziadost, ziadostSHostom,
} from './spolocne.mjs'

const t = kontroly('Logika servera (čistá databáza, vymyslené údaje)')
const DATA = docasnyPriecinok()
const PORT = nahodnyPort()
const api = vytvorApi(await spustiServer(DATA, PORT))

const { db, VERZIA_SCHEMY, FILES_DIR, meta, setMeta } = await modulServera('db.js')
const { dnesISO } = await modulServera('lib/format.js')
const { pridajPracovneDni } = await modulServera('lib/pracovneDni.js')
const { autoZalohaAkTreba } = await modulServera('lib/autoZaloha.js')
const { NASTROJE } = await modulServera('lib/aiNastroje.js')
const { volajApi } = await modulServera('lib/internyKlient.js')
const { systemovyPrompt } = await modulServera('lib/aiPrompty.js')

const faktura = async (id) => (await api('GET', `/faktury/${id}`)).d

/** Na chvíľu predstiera, že práve je okamih `iso` (UTC). */
async function vCase(iso, fn) {
  const Povodny = globalThis.Date
  const pevny = Povodny.parse(iso)
  globalThis.Date = class extends Povodny {
    constructor(...a) {
      super(...(a.length ? a : [pevny]))
    }
    static now() {
      return pevny
    }
  }
  try {
    return await fn()
  } finally {
    globalThis.Date = Povodny
  }
}

// ── Databáza a čas ────────────────────────────────────────────
t.sekcia('Databáza a čas')
t.over('nová databáza prešla všetkými migráciami', db.pragma('user_version', { simple: true }), VERZIA_SCHEMY)
t.over('dnes() v SQL vráti dnešok v časovom pásme appky', db.prepare('SELECT dnes() AS d').get().d, dnesISO())

// 31. 3. 2026 o 22:30 UTC je na Slovensku už 1. 4. 0:30 (letný čas).
await vCase('2026-03-31T22:30:00Z', async () => {
  t.over('pol hodiny po polnoci je už nový deň (nie včerajšok podľa UTC)', dnesISO(), '2026-04-01')
  t.over('…aj v SQL', db.prepare('SELECT dnes() AS d').get().d, '2026-04-01')
  t.over('…aj pri novej faktúre', (await api('GET', '/faktury/nova')).d.datum_vystav, '2026-04-01')
})
process.env.CASOVE_PASMO = 'America/New_York'
const { dnesISO: dnesNewYork } = await modulServera('lib/format.js', 'pasmo=new-york')
await vCase('2026-03-31T22:30:00Z', () => {
  t.over('iné časové pásmo (CASOVE_PASMO v .env) dá svoj dátum', dnesNewYork(), '2026-03-31')
})
process.env.CASOVE_PASMO = 'Europe/Bratislavaa'
const povodnaChyba = console.error
console.error = () => {}
const { CASOVE_PASMO: poPreklepe } = await modulServera('lib/format.js', 'pasmo=preklep')
console.error = povodnaChyba
process.env.CASOVE_PASMO = 'Europe/Bratislava'
t.over('preklep v časovom pásme appku nezhodí (platí slovenský čas)', poPreklepe, 'Europe/Bratislava')

// ── Nový používateľ a nastavenia ──────────────────────────────
t.sekcia('Nový používateľ a nastavenia')
const nove = (await api('GET', '/nastavenia')).d
t.over('nový používateľ nemá zapnuté zákazky v zahraničí', nove.praca_v_zahranici, 0)
t.over('nový používateľ dostane sprievodcu prvým spustením', nove.sprievodca_hotovy, 0)
// Asistent opisuje používateľa podľa nastavení – nový používateľ nie je automaticky
// „remeselník na turnusoch v zahraničí" ako pôvodný autor appky.
const vZahranici = () => /pracujúci na zahraničných/.test(systemovyPrompt())
t.over('asistent nového používateľa neberie ako pracujúceho v zahraničí', vZahranici(), false)
await api('PUT', '/nastavenia', { praca_v_zahranici: true })
t.over('po zapnutí v nastaveniach s tým asistent počíta', vZahranici(), true)

await api('PUT', '/nastavenia', { meno: 'Ján Testovací', predmety: 'Montáž konštrukcií' })
await api('PUT', '/nastavenia', { telefon: '+421 900 000 000' })
const n = (await api('GET', '/nastavenia')).d
t.over(
  'čiastočná úprava nastavení nič iné nezmaže',
  [n.meno, n.predmety, n.telefon, n.praca_v_zahranici],
  ['Ján Testovací', 'Montáž konštrukcií', '+421 900 000 000', 1],
)
await api('PUT', '/nastavenia', { sprievodca_hotovy: true })
const poSprievodcovi = (await api('GET', '/nastavenia')).d
t.over('dokončený sprievodca sa zapamätá a nič iné nezmení', [poSprievodcovi.sprievodca_hotovy, poSprievodcovi.meno], [1, 'Ján Testovací'])

// ── Register podľa IČO ────────────────────────────────────────
// Skutočný register sa v testoch nevolá – odpoveď nahradíme vymyslenou,
// v rovnakom tvare, v akom ju vracia api.statistics.sk.
t.sekcia('Register podľa IČO')
const ZIVNOSTNIK = {
  fullNames: [{ value: 'Ján Testovací', validFrom: '2015-03-01' }],
  addresses: [
    { street: 'Stará', buildingNumber: '1', postalCodes: ['08901'], municipality: { value: 'Svidník' }, validTo: '2020-01-01' },
    { street: 'Hlavná', buildingNumber: '12', postalCodes: ['08901'], municipality: { value: 'Svidník' }, country: { value: 'Slovenská republika' } },
  ],
  establishment: '2015-03-01',
  sourceRegister: {
    value: { value: 'Živnostenský register' },
    registrationOffices: [{ value: 'Okresný úrad Svidník' }],
    registrationNumbers: [{ value: '770-12345' }],
  },
}
const povodnyFetch = globalThis.fetch
globalThis.fetch = async (url, ...zvysok) => {
  if (!String(url).startsWith('https://api.statistics.sk/')) return povodnyFetch(url, ...zvysok)
  const ico = new URL(String(url)).searchParams.get('identifier')
  return new Response(JSON.stringify({ results: ico === '12345678' ? [ZIVNOSTNIK] : [] }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
const zRegistra = (await api('GET', '/register/ico/12 345 678')).d
t.over('živnostník z registra: meno a platná adresa', [zRegistra.nazov, zRegistra.adresa, zRegistra.psc_mesto], ['Ján Testovací', 'Hlavná 12', '08901 Svidník'])
t.over(
  '…aj zápis v živnostenskom registri, ktorý sa tlačí na faktúru',
  [zRegistra.register, zRegistra.urad, zRegistra.cislo_registra, zRegistra.vznik],
  ['Živnostenský register', 'Okresný úrad Svidník', '770-12345', '2015-03-01'],
)
const nenajdene = await api('GET', '/register/ico/99999999')
t.over('neznáme IČO povie zrozumiteľne', [nenajdene.stav, nenajdene.d.chyba], [404, 'IČO 99999999 sa v registri nenašlo.'])
globalThis.fetch = povodnyFetch

// ── Splatnosť ─────────────────────────────────────────────────
t.sekcia('Splatnosť')
t.over('25 pracovných dní od 14. 9. 2026 (15. 9. v roku 2026 nie je sviatok)', pridajPracovneDni('2026-09-14', 25), '2026-10-19')
await api('PUT', '/nastavenia', { splatnost_dni: 25, splatnost_pracovne: true })
t.over('nová faktúra: splatnosť v pracovných dňoch', (await api('GET', '/faktury/nova?datum=2026-09-14')).d.datum_splat, '2026-10-19')
await api('PUT', '/nastavenia', { splatnost_pracovne: false })
t.over('nová faktúra: splatnosť v kalendárnych dňoch', (await api('GET', '/faktury/nova?datum=2026-09-14')).d.datum_splat, '2026-10-09')
await api('PUT', '/nastavenia', { splatnost_dni: 14 })

// ── Faktúry a platby ──────────────────────────────────────────
t.sekcia('Faktúry a platby')
const firma = (await api('POST', '/firmy', { nazov: 'Ľubica Nováková s.r.o.', krajina: 'Slovensko' })).d
const f1 = (
  await api('POST', '/faktury', {
    company_id: firma.id,
    datum_vystav: '2026-03-02',
    datum_splat: '2026-03-16',
    polozky: [{ popis: 'Montáž', mnozstvo: 10, jednotka: 'hod', cena: 25 }],
  })
).d.id
let f = await faktura(f1)
t.over('suma faktúry sa vypočíta z položiek', f.suma, 250)
t.over('nezaplatená faktúra je po splatnosti', f.stav_zobraz, 'po_splatnosti')

await api('POST', `/faktury/${f1}/platby`, { suma: 100, datum: '2026-04-10' })
f = await faktura(f1)
t.over('čiastočná platba: stav a zostatok', [f.stav_zobraz, f.otvoreny_zostatok], ['po_splatnosti_ciastocne', 150])

const zaplatena = (await api('POST', `/faktury/${f1}/stav`, { stav: 'zaplatena', datum_uhrady: '2026-04-20' })).d
f = await faktura(f1)
t.over('„Zaplatená" doplatí presne zvyšok', f.platby.map((p) => p.suma), [100, 150])
t.over('…a vráti číslo platby pre „Vrátiť späť"', typeof zaplatena.platba_id, 'number')
t.over('faktúra je vyplatená', [f.stav_zobraz, f.otvoreny_zostatok], ['zaplatena', 0])

await api('DELETE', `/faktury/platby/${zaplatena.platba_id}`)
f = await faktura(f1)
t.over(
  '„Vrátiť späť" vráti faktúru do pôvodného stavu',
  [f.stav_zobraz, f.otvoreny_zostatok, f.platby.length],
  ['po_splatnosti_ciastocne', 150, 1],
)

await api('POST', `/faktury/${f1}/stav`, { stav: 'zaplatena', datum_uhrady: '2026-04-20' })
const znova = (await api('POST', `/faktury/${f1}/stav`, { stav: 'zaplatena', datum_uhrady: '2026-04-20' })).d
t.over('opakované „Zaplatená" už nič nepripíše', [znova.platba_id, (await faktura(f1)).platby.length], [null, 2])

const f3 = (
  await api('POST', '/faktury', {
    company_id: firma.id,
    stav: 'zaplatena',
    datum_vystav: '2026-02-02',
    datum_uhrady: '2026-02-20',
    polozky: [{ popis: 'Oprava', mnozstvo: 1, cena: 80 }],
  })
).d.id
f = await faktura(f3)
t.over(
  'faktúra zadaná rovno ako zaplatená dostane platbu',
  [f.stav, f.stav_zobraz, f.platby.map((p) => [p.datum, p.suma])],
  ['vystavena', 'zaplatena', [['2026-02-20', 80]]],
)

// ── Zálohové faktúry ──────────────────────────────────────────
t.sekcia('Zálohové faktúry')
const f2 = (
  await api('POST', '/faktury', {
    company_id: firma.id,
    datum_vystav: '2026-05-04',
    datum_splat: '2026-05-18',
    polozky: [{ popis: 'Práce máj', mnozstvo: 40, jednotka: 'hod', cena: 25 }],
  })
).d.id
const z1 = (
  await api('POST', '/faktury', {
    company_id: firma.id,
    typ: 'zaloha',
    kryje_id: f2,
    datum_vystav: '2026-06-01',
    datum_splat: '2026-06-15',
    polozky: [{ popis: 'Záloha na dlh', mnozstvo: 1, cena: 400 }],
    platby: [{ datum: '2026-06-10', suma: 400 }],
  })
).d.id
f = await faktura(f2)
t.over(
  'peniaze zo zálohovej faktúry sa rátajú k pôvodnej',
  [f.prijate_zalohami, f.otvoreny_zostatok, f.stav_zobraz],
  [400, 600, 'po_splatnosti_ciastocne'],
)
t.over('pôvodná faktúra vidí svoju zálohovú', f.kryte_zalohami.map((z) => z.id), [z1])

const suhrn = (await api('GET', '/faktury/suhrn')).d
t.over('čakám len skutočný dlh – zálohová sa neráta druhýkrát', suhrn.nezaplatene, 600)
t.over('prijaté spolu = všetky platby', suhrn.zaplatene, 730)
const pocty = (await api('GET', '/faktury/pocty')).d
t.over('záložky: nevyplatené, vyplatené, zálohové', [pocty.nevyplatene, pocty.vyplatene, pocty.zalohy], [1, 2, 1])

const doplatok = (await api('POST', `/faktury/${f2}/stav`, { stav: 'zaplatena', datum_uhrady: '2026-07-01' })).d
t.over('„Zaplatená" pri krytej faktúre doplatí 600, nie 1000', (await faktura(f2)).platby.map((p) => p.suma), [600])
await api('DELETE', `/faktury/platby/${doplatok.platba_id}`)

// ── Financie ──────────────────────────────────────────────────
t.sekcia('Financie')
await api('POST', '/vydavky', { datum: '2026-05-05', popis: 'Materiál', kategoria: 'Materiál', suma: 42.5 })
await api('POST', '/vydavky', { datum: '2026-06-01', popis: 'Dar od rodiny', druh: 'prijem', suma: 500 })
const fin = (await api('GET', '/financie/prehlad?rok=2026')).d
t.over('príjmy sa rátajú z platieb podľa ich dátumu', fin.prijmy, 730)
t.over(
  'súkromný príjem nie je výdavok ani príjem z podnikania',
  [fin.vydavky, fin.sukromne_prijmy, fin.zisk],
  [42.5, 500, 687.5],
)
t.over('Financie a Prehľad čakajú rovnakú sumu', fin.caka_na_zaplatenie, suhrn.nezaplatene)

// ── Hľadanie ──────────────────────────────────────────────────
t.sekcia('Hľadanie')
for (const q of ['lubica', 'ľubica', 'LUBICA', 'novakova']) {
  const v = (await api('GET', `/hladat?q=${encodeURIComponent(q)}`)).d
  t.over(`„${q}" nájde firmu Ľubica Nováková`, v.some((x) => x.typ === 'firma' && x.id === firma.id), true)
}

// ── Kôš ────────────────────────────────────────────────────────
t.sekcia('Kôš')
await api('POST', `/faktury/${f2}/platby`, { suma: 100, datum: '2026-07-01' })
await api('DELETE', `/faktury/${f2}`)
t.over('zmazaná faktúra zmizne zo zoznamu', (await api('GET', `/faktury/${f2}`)).stav, 404)
t.over('zálohová faktúra zatiaľ nekryje nič', (await faktura(z1)).kryje_id, null)
const vKosi = (await api('GET', '/kos')).d.find((k) => k.tabulka === 'invoices' && k.zaznam_id === f2)
t.over('faktúra je v koši', !!vKosi, true)
t.over('vrátenie z koša', (await api('POST', `/kos/${vKosi.id}/obnovit`)).stav, 200)
f = await faktura(f2)
t.over('vrátená faktúra má položky aj platby', [f.suma, f.polozky.length, f.platby.map((p) => p.suma)], [1000, 1, [100]])
t.over(
  '…a zálohová faktúra ju znova kryje',
  [(await faktura(z1)).kryje_id, f.prijate_zalohami, f.otvoreny_zostatok],
  [f2, 400, 500],
)

const vydavok = (await api('POST', '/vydavky', { datum: '2026-07-02', popis: 'Náradie', kategoria: 'Náradie', suma: 19.9 })).d.id
const formular = new FormData()
formular.append('subory', new Blob(['bloček z predajne']), 'blocik.txt')
t.over('príloha k výdavku sa nahrala', (await api('POST', `/vydavky/${vydavok}/subory`, formular)).stav, 200)
const ulozeny = db.prepare('SELECT ulozeny_nazov FROM expense_files WHERE expense_id = ?').get(vydavok).ulozeny_nazov
const subor = path.join(FILES_DIR, 'doklady', ulozeny)
await api('DELETE', `/vydavky/${vydavok}`)
t.over('kým je výdavok v koši, súbor ostáva na disku', fs.existsSync(subor), true)
const kosVydavku = () => api('GET', '/kos').then((r) => r.d.find((k) => k.tabulka === 'expenses' && k.zaznam_id === vydavok))
await api('POST', `/kos/${(await kosVydavku()).id}/obnovit`)
t.over('vrátený výdavok má prílohu', (await api('GET', `/vydavky/${vydavok}`)).d.prilohy.map((p) => p.nazov), ['blocik.txt'])

// ── Číslovanie faktúr ─────────────────────────────────────────
t.sekcia('Číslovanie faktúr')
const cisloPreAugust = async () => (await api('GET', '/faktury/nova?datum=2026-08-01')).d.cislo
const prvaAugust = await cisloPreAugust()
const naZmazanie = (
  await api('POST', '/faktury', { company_id: firma.id, datum_vystav: '2026-08-01', polozky: [{ popis: 'Omyl', mnozstvo: 1, cena: 10 }] })
).d.id
t.over('nová faktúra dostala navrhnuté číslo', (await faktura(naZmazanie)).cislo, prvaAugust)
await api('DELETE', `/faktury/${naZmazanie}`)
t.over('číslo zmazanej faktúry sa ponúkne znova', await cisloPreAugust(), prvaAugust)
const nahrada = (
  await api('POST', '/faktury', { company_id: firma.id, datum_vystav: '2026-08-02', polozky: [{ popis: 'Správne', mnozstvo: 1, cena: 10 }] })
).d.id
t.over('nová faktúra ho aj dostane', (await faktura(nahrada)).cislo, prvaAugust)
const vKosiFaktura = (await api('GET', '/kos')).d.find((k) => k.tabulka === 'invoices' && k.zaznam_id === naZmazanie)
const obsadene = await api('POST', `/kos/${vKosiFaktura.id}/obnovit`)
t.over(
  'zmazaná faktúra s obsadeným číslom sa z koša nevráti a appka povie prečo',
  [obsadene.stav, obsadene.d.chyba],
  [400, `Faktúru ${prvaAugust} nemožno vrátiť – medzitým vznikla iná faktúra s rovnakým číslom.`],
)
await api('DELETE', `/faktury/${nahrada}`)

t.sekcia('Číslovanie zálohových faktúr')
const predCislovanim = (await api('GET', '/nastavenia')).d
await api('PUT', '/nastavenia', { cislo_vzor: '{RRRR}{NNNN}', cislo_vzor_zaloha: '30{RR}{NNNN}' })
const novaZaloha = async () =>
  (await api('POST', '/faktury', { company_id: firma.id, typ: 'zaloha', datum_vystav: '2026-10-01', polozky: [{ popis: 'Záloha', mnozstvo: 1, cena: 250 }] })).d.id
const zaloha1 = await novaZaloha()
const zaloha2 = await novaZaloha()
t.over('zálohová faktúra má vlastný rad podľa vzoru', [(await faktura(zaloha1)).cislo, (await faktura(zaloha2)).cislo], ['30260001', '30260002'])
t.over('návrh čísla pre zálohovú faktúru pokračuje v jej rade', (await api('GET', '/faktury/nova?typ=zaloha&datum=2026-10-02')).d.cislo, '30260003')
const beznaFaktura = (await api('POST', '/faktury', { company_id: firma.id, datum_vystav: '2026-10-01', polozky: [{ popis: 'Práca', mnozstvo: 1, cena: 100 }] })).d.id
t.over('bežná faktúra ostáva vo svojom rade – zálohy ho neposúvajú', (await faktura(beznaFaktura)).cislo.startsWith('2026'), true)
t.over(
  'vzor bez poradia appka neuloží a povie prečo',
  [(await api('PUT', '/nastavenia', { cislo_vzor_zaloha: '30{RR}' })).stav, (await api('GET', '/nastavenia')).d.cislo_vzor_zaloha],
  [400, '30{RR}{NNNN}'],
)
await api('PUT', '/nastavenia', { cislo_vzor_zaloha: '' })
t.over('bez vlastného vzoru má zálohová faktúra rovnaký rad ako faktúry', (await api('GET', '/faktury/nova?typ=zaloha&datum=2026-10-02')).d.cislo.startsWith('2026'), true)
for (const id of [zaloha1, zaloha2, beznaFaktura]) await api('DELETE', `/faktury/${id}`)
await api('PUT', '/nastavenia', { cislo_vzor: predCislovanim.cislo_vzor, cislo_vzor_zaloha: predCislovanim.cislo_vzor_zaloha })

// ── Automatická záloha ────────────────────────────────────────
t.sekcia('Automatická záloha')
const znacka = dnesISO().replace(/-/g, '')
t.over('záloha prebehla hneď po štarte', await pockaj(() => meta('posledna_auto_zaloha') === znacka), true)
const zalohy = path.join(DATA, 'zalohy')
const stara = path.join(zalohy, '20000101-auto')
const rucna = path.join(zalohy, '20000101-1200')
const predStyridsiatimiDnami = new Date(Date.now() - 40 * 86400_000)
for (const p of [stara, rucna]) {
  fs.mkdirSync(p, { recursive: true })
  fs.utimesSync(p, predStyridsiatimiDnami, predStyridsiatimiDnami)
}
// Druhá záloha v ten istý deň sa bežne nerobí – vynútime ju, aby sa do nej
// dostala aj príloha nahratá vyššie.
setMeta('posledna_auto_zaloha', '')
await autoZalohaAkTreba()
const dnesnaZaloha = path.join(zalohy, `${znacka}-auto`)
const kopia = new Database(path.join(dnesnaZaloha, 'app.db'), { readonly: true })
t.over('záloha je čitateľná databáza s aktuálnymi údajmi', kopia.prepare('SELECT COUNT(*) AS n FROM invoices').get().n, 4)
kopia.close()
const vZalohe = path.join(dnesnaZaloha, 'files', 'doklady', ulozeny)
t.over('príloha je v zálohe', fs.existsSync(vZalohe) && fs.readFileSync(vZalohe, 'utf8'), 'bloček z predajne')
t.over('príloha v zálohe nezaberá miesto navyše (pevný odkaz)', fs.statSync(subor).nlink >= 2, true)
t.over('automatická záloha staršia než 30 dní sa zmazala', fs.existsSync(stara), false)
t.over('ručná záloha ostala', fs.existsSync(rucna), true)

await api('DELETE', `/vydavky/${vydavok}`)
await api('DELETE', `/kos/${(await kosVydavku()).id}`)
t.over('po vysypaní z koša sa súbor zmaže z disku', fs.existsSync(subor), false)
t.over('…v zálohe však ostane', fs.existsSync(vZalohe), true)

// ── Ochrana dát ───────────────────────────────────────────────
t.sekcia('Ochrana dát')
t.over(
  'požiadavka na cudziu adresu (DNS rebinding) je odmietnutá',
  await ziadostSHostom(PORT, '/api/nastavenia', 'zly.example.com'),
  403,
)
t.over('požiadavka na localhost prejde', await ziadostSHostom(PORT, '/api/nastavenia', `localhost:${PORT}`), 200)
t.over(
  'zápis z cudzej stránky je odmietnutý',
  (await api('POST', '/firmy', { nazov: 'Cudzia' }, { Origin: 'https://zla-stranka.example' })).stav,
  403,
)
t.over('zápis z appky prejde', (await api('POST', '/firmy', { nazov: 'Vlastná' }, { Origin: `http://localhost:${PORT}` })).stav, 200)

// ── Prístup z telefónu ────────────────────────────────────────
// Skutočný Tailscale test nepoužije – podstrčí vymyslený, ktorý si pamätá nastavenie.
t.sekcia('Prístup z telefónu')
const { citajStatus, citajServe, nahradSpustac, zistiStav } = await modulServera('lib/pristup.js')
const TS = 'moj-pc.tail1234.ts.net'
t.over(
  'stav Tailscale: prihlásený s menom počítača, neprihlásený, nezmysel',
  [
    citajStatus(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'Moj-PC.tail1234.ts.net.' } })),
    citajStatus(JSON.stringify({ BackendState: 'NeedsLogin', AuthURL: 'https://login.tailscale.com/a/abc' })),
    citajStatus(JSON.stringify({ BackendState: 'NeedsLogin', AuthURL: 'https://zla.example/a' })).prihlasenie,
    citajStatus('nie je json').tailscale,
  ],
  [
    { tailscale: 'bezi', meno: TS, prihlasenie: null },
    { tailscale: 'neprihlaseny', meno: null, prihlasenie: 'https://login.tailscale.com/a/abc' },
    null,
    'neprihlaseny',
  ],
)
const webNa = (ciel, port = 443) => ({ Web: { [`${TS}:${port}`]: { Handlers: { '/': { Proxy: ciel } } } } })
t.over(
  'serve na appku, na inú službu, na iný port a cez Funnel',
  [
    citajServe(JSON.stringify(webNa(`http://127.0.0.1:${PORT}`)), TS, PORT),
    citajServe(JSON.stringify(webNa('http://127.0.0.1:8080')), TS, PORT).obsadene,
    citajServe(JSON.stringify(webNa(`http://localhost:${PORT}`, 8443)), TS, PORT).adresa,
    citajServe(JSON.stringify({ ...webNa(`http://127.0.0.1:${PORT}`), AllowFunnel: { [`${TS}:443`]: true } }), TS, PORT).verejne,
    citajServe('', TS, PORT).zapnute,
  ],
  [{ adresa: `https://${TS}`, zapnute: true, obsadene: false, verejne: false }, true, `https://${TS}:8443`, true, false],
)
t.over(
  'bez Tailscale je appka len v tomto počítači',
  [(await api('GET', '/pristup')).d.tailscale, await ziadostSHostom(PORT, '/api/nastavenia', TS)],
  ['nenainstalovany', 403],
)

let serveKonf = {}
let povolenieHttps = false
const prikazy = []
nahradSpustac(async (args) => {
  prikazy.push(args.join(' '))
  const prikaz = args.join(' ')
  if (prikaz === 'status --json') return { kod: 0, vystup: JSON.stringify({ BackendState: 'Running', Self: { DNSName: TS + '.' } }) }
  if (prikaz === 'serve status --json') return { kod: 0, vystup: JSON.stringify(serveKonf) }
  if (args[0] === 'serve' && args[1] === '--bg') {
    // Pri prvom zapnutí Tailscale chce povoliť HTTPS na webe a čaká.
    if (povolenieHttps) return { kod: 0, vystup: 'Serve is not enabled on your tailnet.\nTo enable, visit:\n\n  https://login.tailscale.com/f/serve?node=abc123\n' }
    serveKonf = { TCP: { 443: { HTTPS: true } }, ...webNa(args[2]) }
    return { kod: 0, vystup: '' }
  }
  if (args[0] === 'serve' && args[2] === 'off') {
    serveKonf = {}
    return { kod: 0, vystup: '' }
  }
  return { kod: 1, vystup: 'neznámy príkaz' }
})
const stavPristupu = (await api('GET', '/pristup')).d
t.over('Tailscale beží, prístup ešte nie je zapnutý', [stavPristupu.tailscale, stavPristupu.zapnute, stavPristupu.z_pocitaca], ['bezi', false, true])

povolenieHttps = true
const naPovolenie = (await api('POST', '/pristup/zapnut')).d
t.over('keď treba povoliť HTTPS, appka vráti odkaz na povolenie', [naPovolenie.povolit, naPovolenie.zapnute], ['https://login.tailscale.com/f/serve?node=abc123', false])
povolenieHttps = false
const zapnute = (await api('POST', '/pristup/zapnut')).d
t.over('zapnutie nasmeruje Tailscale na appku', [zapnute.ok, zapnute.adresa, prikazy.includes(`serve --bg http://127.0.0.1:${PORT}`)], [true, `https://${TS}`, true])
t.over('appka sa z telefónu otvorí', await ziadostSHostom(PORT, '/api/nastavenia', TS), 200)
const zTelefonu = await ziadost(PORT, '/api/pristup', { host: TS })
t.over('appka vie, že je otvorená v telefóne', zTelefonu.d.z_pocitaca, false)
t.over(
  'zápis z telefónu prejde',
  (await api('POST', '/firmy', { nazov: 'Z telefónu' }, { Origin: `https://${TS}` })).stav,
  200,
)
t.over(
  'vypnúť prístup z telefónu nejde (odrezal by sa)',
  (await ziadost(PORT, '/api/pristup/vypnut', { host: TS, metoda: 'POST', hlavicky: { Origin: `https://${TS}` } })).stav,
  403,
)
t.over('cudzia adresa ostáva zablokovaná', await ziadostSHostom(PORT, '/api/nastavenia', 'ine-pc.tail1234.ts.net'), 403)
const qr = await api('GET', '/pristup/qr?cesta=' + encodeURIComponent('/vydavky?novy=1&foto=1'))
t.over('QR kód s adresou pre telefón', [qr.stav, qr.typ.startsWith('image/svg+xml')], [200, true])
t.over(
  'QR nikdy nepošle telefón na cudziu stránku',
  [(await api('GET', '/pristup/qr?cesta=' + encodeURIComponent('//zla.example'))).stav, (await api('GET', '/pristup/qr?cesta=https://zla.example')).stav],
  [400, 400],
)

serveKonf.AllowFunnel = { [`${TS}:443`]: true }
await zistiStav(PORT, 0)
t.over('appka vystavená na internet (Funnel) sa z telefónu zablokuje', await ziadostSHostom(PORT, '/api/nastavenia', TS), 403)
delete serveKonf.AllowFunnel
await zistiStav(PORT, 0)

const vypnute = (await api('POST', '/pristup/vypnut')).d
t.over('vypnutie prístup zruší', [vypnute.ok, vypnute.zapnute, prikazy.includes('serve --https=443 off')], [true, false, true])
serveKonf = webNa('http://127.0.0.1:8080')
const obsadenaAdresa = await api('POST', '/pristup/zapnut')
t.over('inú službu na adrese appka neprepíše', [obsadenaAdresa.stav, serveKonf.Web[`${TS}:443`].Handlers['/'].Proxy], [400, 'http://127.0.0.1:8080'])
nahradSpustac(null)

// ── Asistent ──────────────────────────────────────────────────
t.sekcia('Asistent')
t.over(
  'asistent nemá žiadny nástroj na mazanie',
  Object.keys(NASTROJE).filter((nazov) => /zmaz|vymaz|odstran|vysyp|delete/i.test(nazov)),
  [],
)
let zablokovane = false
try {
  await volajApi('DELETE', `/faktury/${f1}`)
} catch {
  zablokovane = true
}
t.over('ani cez interné API asistent mazať nemôže', [zablokovane, (await api('GET', `/faktury/${f1}`)).stav], [true, 200])
t.over('bez API kľúča je asistent nedostupný (a nič nepadne)', (await api('GET', '/ai/stav')).d.dostupne, false)

// ── Ostatné ───────────────────────────────────────────────────
t.sekcia('Upomienky a PDF')
const naUpomienku = (await api('GET', '/mail/po-splatnosti')).d
t.over('na upomienku je len skutočný dlh (bez zálohovej)', naUpomienku.map((x) => [x.id, x.otvoreny_zostatok]), [[f2, 500]])
const pdf = await api('GET', `/faktury/${f1}/pdf`)
t.over('PDF faktúry sa vytvorí', [pdf.stav, pdf.typ.startsWith('application/pdf'), pdf.d.subarray(0, 5).toString()], [200, true, '%PDF-'])

// ── Výpis z banky ─────────────────────────────────────────────
// Vymyslený výpis tak, ako ho exportujú slovenské banky: windows-1250,
// bodkočiarka, desatinná čiarka, pár riadkov o účte pred záhlavím.
t.sekcia('Výpis z banky')
const CP1250 = { á: 0xe1, ä: 0xe4, č: 0xe8, ď: 0xef, é: 0xe9, í: 0xed, ľ: 0xbe, ň: 0xf2, ó: 0xf3, ô: 0xf4, ŕ: 0xe0, š: 0x9a, ť: 0x9d, ú: 0xfa, ý: 0xfd, ž: 0x9e, Á: 0xc1, Ä: 0xc4, Č: 0xc8, Ď: 0xcf, É: 0xc9, Í: 0xcd, Ľ: 0xbc, Ň: 0xd2, Ó: 0xd3, Ô: 0xd4, Š: 0x8a, Ť: 0x8d, Ú: 0xda, Ý: 0xdd, Ž: 0x8e }
const vCp1250 = (text) => Buffer.from([...text].map((z) => CP1250[z] ?? z.charCodeAt(0)))
const vsF2 = (await faktura(f2)).variabilny
const vypis = [
  'Výpis z účtu;SK24 1100 0000 0026 1234 5678',
  'Obdobie;01.07.2026 - 31.07.2026',
  '',
  'Dátum zaúčtovania;Suma;Mena;Variabilný symbol;Názov protiúčtu;Správa pre príjemcu',
  `05.07.2026;300,00;EUR;${vsF2};Ľubica Nováková s.r.o.;Úhrada faktúry`,
  '12.07.2026;200,00;EUR;;Ľubica Nováková s.r.o.;splátka',
  '15.07.2026;-45,90;EUR;;Čerpacia stanica;nafta',
  '20.07.2026;150,00;EUR;;Peter Testovací;Prevod od brata',
].join('\r\n')
const nahlad = async () => {
  const formular = new FormData()
  formular.append('subor', new Blob([vCp1250(vypis)]), 'vypis-jul.csv')
  return (await api('POST', '/banka/nahlad', formular)).d
}
const prvy = await nahlad()
t.over('výpis sa prečítal: 3 prichádzajúce, 1 odchádzajúca', [prvy.pohyby.length, prvy.odchadzajuce], [3, 1])
t.over(
  'návrhy: podľa VS, podľa sumy, neznáma platba',
  prvy.pohyby.map((p) => [p.navrh.akcia, p.navrh.dovod, p.navrh.faktura_id]),
  [['platba', 'vs', f2], ['platba', 'suma', f2], ['preskocit', 'nenajdene', null]],
)
t.over('diakritika z windows-1250', prvy.pohyby[0].protistrana, 'Ľubica Nováková s.r.o.')
const naZapis = prvy.pohyby.map((p, i) => ({ ...p, ...p.navrh, akcia: i === 2 ? 'prijem' : p.navrh.akcia }))
const zapisane = (await api('POST', '/banka/zapisat', { nazov_suboru: 'vypis-jul.csv', pohyby: naZapis })).d
t.over('zapísali sa 2 platby a 1 súkromný príjem', [zapisane.platby, zapisane.prijmy, zapisane.suma_platieb], [2, 1, 500])
f = await faktura(f2)
t.over('faktúra je po platbách z výpisu uhradená', [f.platby.map((p) => p.suma), f.stav_zobraz], [[100, 300, 200], 'zaplatena'])
t.over('súkromný príjem je medzi súkromnými príjmami', (await api('GET', '/vydavky?druh=prijem')).d.some((v) => v.suma === 150 && v.popis === 'Peter Testovací'), true)
const druhy = await nahlad()
t.over('ten istý výpis druhýkrát nič nezdvojí', druhy.pohyby.map((p) => p.uz_zapisane), [true, true, true])
const opakovane = (await api('POST', '/banka/zapisat', { pohyby: naZapis })).d
t.over('ani opakovaný zápis', [opakovane.platby, opakovane.prijmy, opakovane.import_id], [0, 0, null])
await api('DELETE', `/banka/importy/${zapisane.import_id}`)
f = await faktura(f2)
t.over('„Vrátiť späť" zruší platby aj príjem z importu', [f.platby.map((p) => p.suma), (await api('GET', '/vydavky?druh=prijem')).d.some((v) => v.suma === 150)], [[100], false])
t.over('po vrátení sa dá výpis nahrať znova', (await nahlad()).pohyby.map((p) => p.uz_zapisane), [false, false, false])

const inyFormat = [
  'Booking date,Amount,Currency,Counterparty,Reference',
  '2026-07-03,"1,234.50",EUR,Firma GmbH,/VS2026099/SS/KS0308',
].join('\n')
const formular2 = new FormData()
formular2.append('subor', new Blob([inyFormat]), 'export.csv')
const iny = (await api('POST', '/banka/nahlad', formular2)).d
t.over('iný formát: čiarka, anglické stĺpce, VS v správe', [iny.pohyby[0]?.datum, iny.pohyby[0]?.suma, iny.pohyby[0]?.vs], ['2026-07-03', 1234.5, '2026099'])

// Odchádzajúce platby: už zapísaný výdavok sa spáruje (podľa VS alebo sumy a dátumu),
// známemu príjemcovi sa navrhne kategória, neznáma platba sa nezapíše.
const vOrange = (await api('POST', '/vydavky', { datum: '2026-07-08', popis: 'Orange – faktúra', suma: 24.99, variabilny: '2026000555', kategoria: 'Telefón a internet' })).d.id
const vNafta = (await api('POST', '/vydavky', { datum: '2026-07-14', popis: 'Nafta Brno', suma: 61.2, kategoria: 'Doprava' })).d.id
const vUctovnicka = (await api('POST', '/vydavky', { datum: '2026-06-01', popis: 'Kancelária Hríbik', suma: 60, kategoria: 'Účtovníctvo' })).d.id
const vypisVydavkov = [
  'Dátum;Suma;Mena;Variabilný symbol;Názov protiúčtu;Správa pre príjemcu',
  '10.07.2026;-24,99;EUR;2026000555;Orange Slovensko a.s.;faktúra',
  '16.07.2026;-61,20;EUR;;SHELL 1234 BRNO;platba kartou',
  '08.07.2026;-215,00;EUR;;Sociálna poisťovňa;poistné 06/2026',
  '09.07.2026;-35,00;EUR;;Ján Novák;obed',
  '20.07.2026;-60,00;EUR;;Kancelária Hríbik;účtovníctvo 06',
].join('\n')
const nahladVydavkov = async () => {
  const formular = new FormData()
  formular.append('subor', new Blob([vypisVydavkov]), 'vypis-vydavky.csv')
  return (await api('POST', '/banka/nahlad', formular)).d
}
const vydaje = (await nahladVydavkov()).vydaje
t.over(
  'odchádzajúce platby: spárovanie podľa VS a podľa sumy, kategória podľa príjemcu aj podľa minulých výdavkov',
  vydaje.map((p) => [p.navrh.akcia, p.navrh.dovod, p.navrh.vydavok_id ?? p.navrh.kategoria]),
  [
    ['sparovane', 'vydavok_vs', vOrange],
    ['sparovane', 'vydavok_suma', vNafta],
    ['vydavok', 'kategoria', 'Odvody (SP/ZP)'],
    ['preskocit', 'nenajdene', ''],
    ['vydavok', 'kategoria', 'Účtovníctvo'],
  ],
)
const zapisVydajov = (await api('POST', '/banka/zapisat', {
  nazov_suboru: 'vypis-vydavky.csv',
  pohyby: vydaje.filter((p) => p.navrh.akcia !== 'preskocit').map((p) => ({ ...p, ...p.navrh })),
})).d
t.over('zapísali sa 2 nové výdavky a 2 platby k zapísaným', [zapisVydajov.vydavky, zapisVydajov.sparovane], [2, 2])
const zPoistovne = (await api('GET', '/vydavky?hladat=Sociálna poisťovňa')).d
t.over(
  'nový výdavok z výpisu: príjemca, kategória, suma, prevodom',
  zPoistovne.map((v) => [v.popis, v.kategoria, v.suma, v.platba, v.poznamka]),
  [['Sociálna poisťovňa', 'Odvody (SP/ZP)', 215, 'prevod', 'z výpisu z banky – poistné 06/2026']],
)
t.over('spárované výdavky sa nezdvojili', (await api('GET', '/vydavky?hladat=Orange')).d.length, 1)
t.over('druhýkrát je všetko zapísané okrem preskočenej platby', (await nahladVydavkov()).vydaje.map((p) => p.uz_zapisane), [true, true, true, false, true])
await api('DELETE', `/banka/importy/${zapisVydajov.import_id}`)
t.over(
  '„Vrátiť späť" zmaže len výdavky, ktoré import vytvoril',
  [(await api('GET', '/vydavky?hladat=Sociálna poisťovňa')).d.length, (await api('GET', `/vydavky/${vOrange}`)).stav, (await api('GET', `/vydavky/${vNafta}`)).stav],
  [0, 200, 200],
)
for (const id of [vOrange, vNafta, vUctovnicka]) await api('DELETE', `/vydavky/${id}`)

// ── Rezerva na dane a odvody ──────────────────────────────────
t.sekcia('Rezerva na dane a odvody')
const r2 = (x) => Math.round(x * 100) / 100
t.over('bez nastavenia sa rezerva nepripomína', (await api('GET', '/financie/rezerva?rok=2026')).d.percento, 0)
await api('PUT', '/nastavenia', { rezerva_percento: '25' })
const prijmyRoka = (await api('GET', '/financie/prehlad?rok=2026')).d.prijmy
await api('POST', '/vydavky', { datum: '2026-08-08', popis: 'Poistné za júl', kategoria: 'Sociálna poisťovňa', suma: 100 })
await api('POST', '/vydavky', { datum: '2026-03-31', popis: 'Daň za 2025', kategoria: 'Daň', suma: 50 })
await api('POST', '/vydavky', { datum: '2026-04-02', popis: 'Poistka auta', kategoria: 'Poistenie', suma: 300 })
const rezerva = (await api('GET', '/financie/rezerva?rok=2026')).d
t.over(
  'z prijatých 25 %, mínus zaplatené dane a odvody (poistka auta sa nepočíta)',
  [rezerva.percento, rezerva.odlozit, rezerva.zaplatene_odvody, rezerva.zaplatene_dane, rezerva.zostava],
  [25, r2(prijmyRoka * 0.25), 100, 50, r2(prijmyRoka * 0.25 - 150)],
)
const zaRezervu = (
  await api('POST', '/faktury', { company_id: firma.id, datum_vystav: '2026-09-01', polozky: [{ popis: 'Práca', mnozstvo: 1, cena: 400 }] })
).d.id
const zRezervou = (await api('POST', `/faktury/${zaRezervu}/stav`, { stav: 'zaplatena', datum_uhrady: '2026-09-10' })).d
t.over('pri platbe 400 € appka pripomenie odložiť 100 €', zRezervou.odlozit, 100)
await api('PUT', '/nastavenia', { rezerva_percento: 0 })
const bezRezervyId = (
  await api('POST', '/faktury', { company_id: firma.id, datum_vystav: '2026-09-02', polozky: [{ popis: 'Práca', mnozstvo: 1, cena: 200 }] })
).d.id
const bezRezervy = (await api('POST', `/faktury/${bezRezervyId}/stav`, { stav: 'zaplatena', datum_uhrady: '2026-09-11' })).d
t.over('bez nastavenej rezervy nič nepripomína', [typeof bezRezervy.platba_id, bezRezervy.odlozit], ['number', 0])

// ── Termíny ───────────────────────────────────────────────────
t.sekcia('Termíny')
const dnesT = dnesISO()
const oDni = (n) => {
  const d = new Date(dnesT + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const splatna = (
  await api('POST', '/faktury', {
    company_id: firma.id, datum_vystav: dnesT, datum_splat: oDni(10), polozky: [{ popis: 'Montáž', mnozstvo: 2, cena: 50 }],
  })
).d.id
await api('POST', '/zmluvy', { nazov: 'Rámcová zmluva Test', platnost_do: oDni(40), obnova: 'automaticka', vypoved_dni: 30 })
await api('POST', '/turnusy', { nazov: 'Turnus Viedeň', krajina: 'Rakúsko', datum_od: oDni(20), datum_do: oDni(40) })
const terminy60 = (await api('GET', '/terminy?dni=60')).d.terminy
const podlaDruhu = (zoznam, druh) => zoznam.filter((x) => x.druh === druh)
t.over('splatnosť neuhradenej faktúry', podlaDruhu(terminy60, 'splatnost').some((x) => x.cesta === `/faktury/${splatna}` && x.datum === oDni(10)), true)
t.over('výpoveď a koniec zmluvy s automatickou obnovou', [podlaDruhu(terminy60, 'vypoved')[0]?.datum, podlaDruhu(terminy60, 'zmluva')[0]?.datum], [oDni(10), oDni(40)])
t.over('začiatok turnusu', podlaDruhu(terminy60, 'turnus')[0]?.datum, oDni(20))
t.over(
  'odvody do 8. dňa mesiaca (pri víkende či sviatku najbližší pracovný deň)',
  podlaDruhu(terminy60, 'odvody').length >= 1 && podlaDruhu(terminy60, 'odvody').every((x) => Number(x.datum.slice(8)) >= 8 && Number(x.datum.slice(8)) <= 12),
  true,
)
t.over('termíny sú zoradené podľa dátumu', terminy60.map((x) => x.datum), [...terminy60.map((x) => x.datum)].sort())
const terminyRok = (await api('GET', '/terminy?dni=400')).d.terminy
const dan = podlaDruhu(terminyRok, 'dan')
t.over('daňové priznanie raz za rok, 31. marca alebo najbližší pracovný deň', [dan.length, dan.every((x) => x.datum.slice(5) >= '03-31' && x.datum.slice(5) <= '04-06')], [1, true])
await api('PUT', '/nastavenia', { terminy_zakonne: false })
const bezZakonnych = (await api('GET', '/terminy?dni=400')).d.terminy
t.over('zákonné termíny sa dajú vypnúť', bezZakonnych.filter((x) => ['odvody', 'dan'].includes(x.druh)).length, 0)
await api('PUT', '/nastavenia', { terminy_zakonne: true })

// Súhrnný výkaz pri § 7a: faktúra firme s nemeckým IČ DPH v mesiaci pred najbližším 25.
const [rokT, mesiacT, denT] = dnesT.split('-').map(Number)
const cielovy = denT <= 20 ? [rokT, mesiacT] : mesiacT === 12 ? [rokT + 1, 1] : [rokT, mesiacT + 1]
const predtym = cielovy[1] === 1 ? [cielovy[0] - 1, 12] : [cielovy[0], cielovy[1] - 1]
const nemecka = (await api('POST', '/firmy', { nazov: 'Bau Test GmbH', krajina: 'Nemecko', ic_dph: 'DE123456789' })).d
await api('POST', '/faktury', {
  company_id: nemecka.id,
  datum_vystav: `${predtym[0]}-${String(predtym[1]).padStart(2, '0')}-10`,
  datum_splat: `${predtym[0]}-${String(predtym[1]).padStart(2, '0')}-24`,
  polozky: [{ popis: 'Montáž', mnozstvo: 1, cena: 100 }],
})
const bez7a = (await api('GET', '/terminy?dni=60')).d.terminy
t.over('bez registrácie podľa § 7a súhrnný výkaz nepripomína', podlaDruhu(bez7a, 'suhrnny_vykaz').length, 0)
await api('PUT', '/nastavenia', { dph_rezim: '7a' })
const s7a = podlaDruhu((await api('GET', '/terminy?dni=60')).d.terminy, 'suhrnny_vykaz')
t.over(
  'pri § 7a pripomenie súhrnný výkaz do 25. dňa',
  [s7a.length, s7a[0]?.datum.slice(0, 7), Number(s7a[0]?.datum.slice(8)) >= 25],
  [1, `${cielovy[0]}-${String(cielovy[1]).padStart(2, '0')}`, true],
)
await api('PUT', '/nastavenia', { dph_rezim: 'neplatitel' })

// ── Cudzie meny ───────────────────────────────────────────────
// Kurzy ECB sa v testoch nesťahujú – odpovedá vymyslená služba v tvare Frankfurter.
t.sekcia('Výdavky v cudzej mene')
const pytaneKurzy = []
const fetchPredKurzami = globalThis.fetch
globalThis.fetch = async (url, ...zvysok) => {
  const u = String(url)
  if (!u.startsWith('https://api.frankfurter.dev/')) return fetchPredKurzami(url, ...zvysok)
  pytaneKurzy.push(u)
  const mena = new URL(u).searchParams.get('symbols')
  if (mena === 'NOK') throw new Error('bez internetu')
  if (mena === 'XYZ') return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
  // Pýtaná nedeľa – ECB vtedy kurz nevyhlasuje, platí piatkový.
  return new Response(JSON.stringify({ amount: 1, base: 'EUR', date: '2026-09-18', rates: { [mena]: 25 } }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
const kurzCzk = (await api('GET', '/vydavky/kurz?mena=CZK&datum=2026-09-21')).d
t.over(
  'kurz ECB z predchádzajúceho dňa (cez víkend posledný vyhlásený)',
  [kurzCzk, pytaneKurzy[0]?.includes('/v1/2026-09-20?')],
  [{ mena: 'CZK', kurz: 25, datum_kurzu: '2026-09-18' }, true],
)
await api('GET', '/vydavky/kurz?mena=CZK&datum=2026-09-21')
t.over('ten istý kurz sa druhýkrát nesťahuje', pytaneKurzy.length, 1)
const vCzk = (await api('POST', '/vydavky', { datum: '2026-09-21', popis: 'Nafta v Česku', mena: 'CZK', suma_mena: 1250 })).d.id
const vydavokCzk = (await api('GET', `/vydavky/${vCzk}`)).d
t.over('suma v eurách sa prepočíta kurzom', [vydavokCzk.mena, vydavokCzk.suma_mena, vydavokCzk.kurz, vydavokCzk.suma], ['CZK', 1250, 25, 50])
const vBanka = (await api('POST', '/vydavky', { datum: '2026-09-21', popis: 'Diaľničná známka', mena: 'CZK', suma_mena: 440, suma: 17.94 })).d.id
t.over('suma v eurách podľa výpisu z banky ostane, ako je zadaná', (await api('GET', `/vydavky/${vBanka}`)).d.suma, 17.94)
await api('PUT', `/vydavky/${vCzk}`, { datum: '2026-09-21', popis: 'Nafta v Česku (Brno)', suma: 49.2 })
const poUprave = (await api('GET', `/vydavky/${vCzk}`)).d
t.over(
  'úprava bez meny (napr. od asistenta) menu nezmaže',
  [poUprave.popis, poUprave.mena, poUprave.suma_mena, poUprave.suma],
  ['Nafta v Česku (Brno)', 'CZK', 1250, 49.2],
)
const zajtra = pridajPracovneDni(dnesISO(), 1)
t.over('kurz na budúci dátum ešte nie je', (await api('GET', `/vydavky/kurz?mena=CZK&datum=${zajtra}`)).stav, 400)
const bezInternetu = await api('POST', '/vydavky', { datum: '2026-09-21', popis: 'Trajekt', mena: 'NOK', suma_mena: 300 })
t.over(
  'bez internetu povie, že sumu v eurách treba zadať ručne',
  [bezInternetu.stav, bezInternetu.d.chyba],
  [400, 'Kurz ECB sa nepodarilo zistiť (bez internetu?). Zadaj kurz alebo sumu v eurách ručne.'],
)
t.over(
  '…a so zadanou sumou v eurách sa zapíše aj bez internetu',
  (await api('POST', '/vydavky', { datum: '2026-09-21', popis: 'Trajekt', mena: 'NOK', suma_mena: 300, suma: 25.6 })).stav,
  200,
)
t.over('neznámu menu ECB nepozná', (await api('GET', '/vydavky/kurz?mena=XYZ&datum=2026-09-21')).stav, 400)
globalThis.fetch = fetchPredKurzami

// ── E-faktúra od dodávateľa ───────────────────────────────────
// Vymyslená e-faktúra vo formáte UBL (Peppol BIS 3.0) s vloženým PDF, ako ju doručí digitálny poštár.
t.sekcia('E-faktúra od dodávateľa')
await api('PUT', '/nastavenia', { ico: '12345678' })
const pdfVFakture = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
const ubl = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ID>2026000123</cbc:ID>
  <cbc:IssueDate>2026-09-01</cbc:IssueDate>
  <cbc:DueDate>2026-09-15</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>2026000123</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf" filename="Faktura_2026000123.pdf">${pdfVFakture.toString('base64')}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cbc:EndpointID schemeID="0245">2020310578</cbc:EndpointID>
    <cac:PartyName><cbc:Name>Orange</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>Metodova 8</cbc:StreetName><cbc:CityName>Bratislava</cbc:CityName><cbc:PostalZone>821 08</cbc:PostalZone></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>SK2020310578</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Orange Slovensko, a.s.</cbc:RegistrationName><cbc:CompanyID>35697270</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyLegalEntity><cbc:RegistrationName>Ján Testovací</cbc:RegistrationName><cbc:CompanyID>12345678</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cbc:PaymentID>VS2026000123</cbc:PaymentID>
    <cac:PayeeFinancialAccount><cbc:ID>SK31 1200 0000 1987 4263 7541</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">4.67</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">20.32</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">24.99</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">24.99</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:LineExtensionAmount currencyID="EUR">20.32</cbc:LineExtensionAmount><cac:Item><cbc:Name>Paušál Go &amp; Surf</cbc:Name></cac:Item></cac:InvoiceLine>
</Invoice>`
const nahladEf = async (xml, nazov = 'faktura.xml') => {
  const f = new FormData()
  f.append('subor', new Blob([xml]), nazov)
  return api('POST', '/vydavky/efaktura', f)
}
const ef1 = (await nahladEf(ubl)).d
t.over(
  'z e-faktúry sa navrhne výdavok',
  [ef1.navrh.popis, ef1.navrh.datum, ef1.navrh.suma, ef1.navrh.mena, ef1.navrh.platba, ef1.navrh.variabilny, ef1.navrh.dodavatel_ico],
  ['Orange Slovensko, a.s. – faktúra 2026000123', '2026-09-01', 24.99, 'EUR', 'prevod', '2026000123', '35697270'],
)
t.over(
  '…s dodávateľom, splatnosťou a údajmi na platbu',
  [ef1.efaktura.dodavatel.dic, ef1.efaktura.dodavatel.ic_dph, ef1.efaktura.dodavatel.adresa, ef1.efaktura.dph, ef1.efaktura.pdf, ef1.efaktura.ine_ico, ef1.zapisana],
  ['2020310578', 'SK2020310578', 'Metodova 8, 821 08 Bratislava', 4.67, true, '', null],
)
t.over(
  '…a poznámkou, podľa ktorej sa dá zaplatiť',
  ef1.navrh.poznamka,
  'Splatná do 15.9.2026 · VS 2026000123 · IBAN SK3112000000198742637541 · Položky: Paušál Go & Surf',
)
const efId = (await api('POST', '/vydavky', { ...ef1.navrh, kategoria: 'Telefón a internet' })).d.id
const prilohaXml = new FormData()
prilohaXml.append('subory', new Blob([ubl], { type: 'application/xml' }), 'faktura.xml')
const prilozene = (await api('POST', `/vydavky/${efId}/subory`, prilohaXml)).d.prilohy
t.over(
  'k priloženému XML sa samo pridá PDF z e-faktúry',
  prilozene.map((p) => [p.nazov, p.mime]),
  [['faktura.xml', 'application/xml'], ['Faktura_2026000123.pdf', 'application/pdf']],
)
const pdfZoSuboru = await api('GET', `/vydavky/subory/${prilozene[1].id}`)
t.over('…a dá sa otvoriť', pdfZoSuboru.d.equals(pdfVFakture), true)
const ef2 = (await nahladEf(ubl)).d
t.over(
  'tú istú e-faktúru appka spozná ako zapísanú a pri dodávateľovi navrhne jeho kategóriu',
  [ef2.zapisana?.id, ef2.navrh.kategoria],
  [efId, 'Telefón a internet'],
)
const druhykrat = await api('POST', '/vydavky', ef2.navrh)
t.over('druhýkrát sa tá istá faktúra nezapíše', [druhykrat.stav, druhykrat.d.chyba?.startsWith('Táto faktúra už je zapísaná')], [409, true])

// Dobropis vo formáte CII, v českých korunách a vystavený na iné IČO.
const cii = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument><ram:ID>D-77</ram:ID><ram:TypeCode>381</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260910</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem><ram:SpecifiedTradeProduct><ram:Name>Vrátené rukavice</ram:Name></ram:SpecifiedTradeProduct></ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Nářadí Brno s.r.o.</ram:Name><ram:SpecifiedLegalOrganization><ram:ID>27074358</ram:ID></ram:SpecifiedLegalOrganization>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">CZ27074358</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Iná firma</ram:Name><ram:SpecifiedLegalOrganization><ram:ID>87654321</ram:ID></ram:SpecifiedLegalOrganization></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>77</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>CZK</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxTotalAmount currencyID="CZK">86.78</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>500.00</ram:GrandTotalAmount>
        <ram:DuePayableAmount>500.00</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
const ef3 = (await nahladEf(cii, 'dobropis.xml')).d
t.over(
  'dobropis vo formáte CII: záporná suma v cudzej mene a upozornenie na iné IČO',
  [ef3.navrh.popis, ef3.navrh.datum, ef3.navrh.mena, ef3.navrh.suma_mena, ef3.efaktura.dobropis, ef3.efaktura.ine_ico, ef3.navrh.variabilny],
  ['Nářadí Brno s.r.o. – dobropis D-77', '2026-09-10', 'CZK', -500, true, '87654321', '77'],
)
t.over(
  'iné XML alebo pokazený súbor povie zrozumiteľne',
  [(await nahladEf('<objednavka><cislo>1</cislo></objednavka>')).d.chyba, (await nahladEf('toto nie je xml')).d.chyba],
  ['Súbor nie je e-faktúra (UBL ani CII).', 'Súbor sa nedá prečítať ako XML.'],
)

// ── Výkaz hodín pri turnuse ───────────────────────────────────
t.sekcia('Výkaz hodín pri turnuse')
const firmaHodin = (await api('POST', '/firmy', { nazov: 'Hodinová Firma GmbH', krajina: 'Nemecko' })).d.id
const tHodin = (await api('POST', '/turnusy', { nazov: 'Turnus Linz', company_id: firmaHodin, datum_od: '2026-08-03', datum_do: '2026-08-09' })).d.id
await api('POST', '/objednavky', { tour_id: tHodin, company_id: firmaHodin, popis: 'Montáž', hodinovka: 27 })
const prazdny = (await api('GET', `/turnusy/${tHodin}/hodiny`)).d
t.over(
  'výkaz má každý deň turnusu a sadzbu z objednávky',
  [prazdny.dni.length, prazdny.dni[0].datum, prazdny.dni[6].datum, prazdny.spolu_hodin, prazdny.sadzba, prazdny.sadzba_odkial],
  [7, '2026-08-03', '2026-08-09', 0, 27, 'objednavka'],
)
const dniHodin = prazdny.dni.map((d, i) => (i < 6 ? { ...d, hodiny: 10 } : { ...d, poznamka: 'voľno' }))
const ulozenyVykaz = (await api('PUT', `/turnusy/${tHodin}/hodiny`, { dni: dniHodin, sadzba: 28 })).d
t.over('uložený výkaz: 60 h × 28 € = 1 680 €', [ulozenyVykaz.spolu_hodin, ulozenyVykaz.sadzba, ulozenyVykaz.suma, ulozenyVykaz.sadzba_odkial], [60, 28, 1680, 'turnus'])
t.over('deň bez hodín si nechá poznámku', ulozenyVykaz.dni[6], { datum: '2026-08-09', hodiny: 0, poznamka: 'voľno' })
const zlyVykaz = await api('PUT', `/turnusy/${tHodin}/hodiny`, { dni: [{ datum: '2026-08-03', hodiny: 25 }], sadzba: 28 })
t.over('25 hodín za deň appka nepustí', [zlyVykaz.stav, zlyVykaz.d.chyba], [400, 'Počet hodín 25 (2026-08-03) nie je možný – deň má 24 hodín.'])
const pdfVykazu = await api('GET', `/turnusy/${tHodin}/hodiny/pdf`)
t.over('výkaz v PDF na podpis', [pdfVykazu.stav, pdfVykazu.d.subarray(0, 5).toString()], [200, '%PDF-'])
const tHodin2 = (await api('POST', '/turnusy', { nazov: 'Turnus Linz 2', company_id: firmaHodin, datum_od: '2026-09-07', datum_do: '2026-09-11' })).d.id
const druhyVykaz = (await api('GET', `/turnusy/${tHodin2}/hodiny`)).d
t.over('ďalší turnus u tej istej firmy navrhne jej sadzbu', [druhyVykaz.sadzba, druhyVykaz.sadzba_odkial], [28, 'predosly_turnus'])
await api('PUT', `/turnusy/${tHodin}`, { nazov: 'Turnus Linz', company_id: firmaHodin, datum_od: '2026-08-03', datum_do: '2026-08-05' })
t.over('skrátený turnus o zapísané hodiny nepríde', (await api('GET', `/turnusy/${tHodin}/hodiny`)).d.spolu_hodin, 60)
await api('DELETE', `/turnusy/${tHodin2}`)
await api('DELETE', `/turnusy/${tHodin}`)
const turnusVKosi = (await api('GET', '/kos')).d.find((k) => k.tabulka === 'tours' && k.zaznam_id === tHodin)
await api('POST', `/kos/${turnusVKosi.id}/obnovit`)
t.over('turnus vrátený z koša má aj výkaz hodín', (await api('GET', `/turnusy/${tHodin}/hodiny`)).d.spolu_hodin, 60)

// ── Platiteľ DPH ──────────────────────────────────────────────
t.sekcia('Platiteľ DPH')
const staraFaktura = await faktura(f1)
await api('PUT', '/nastavenia', { dph_rezim: 'platitel', ic_dph: 'SK2020123456', dph_sadzba: 23, dph_obdobie: 'mesacne' })
const nastavenieDph = (await api('GET', '/nastavenia')).d
t.over('nastavenie platiteľa sa uloží', [nastavenieDph.dph_rezim, nastavenieDph.dph_sadzba, nastavenieDph.dph_obdobie], ['platitel', 23, 'mesacne'])
const firmaSk = (await api('POST', '/firmy', { nazov: 'Stavby Tuzemsko s.r.o.', krajina: 'Slovensko', ic_dph: 'SK2021999999' })).d.id
const fDph = (await api('POST', '/faktury', {
  company_id: firmaSk, datum_vystav: '2026-10-05', datum_dodania: '2026-09-30',
  polozky: [
    { popis: 'Montáž', mnozstvo: 10, jednotka: 'hod', cena: 30 },
    { popis: 'Materiál', mnozstvo: 1, jednotka: 'ks', cena: 100, sadzba_dph: 19 },
  ],
})).d.id
const sDph = await faktura(fDph)
t.over(
  'faktúra s DPH: základ 400 €, DPH 69 € + 19 €, spolu 488 €',
  [sDph.s_dph, sDph.zaklad, sDph.dph, sDph.suma, sDph.polozky.map((p) => p.sadzba_dph)],
  [1, 400, 88, 488, [23, 19]],
)
const pdfDph = await api('GET', `/faktury/${fDph}/pdf`)
t.over('PDF faktúry s DPH sa vytvorí', [pdfDph.stav, pdfDph.d.subarray(0, 5).toString()], [200, '%PDF-'])
await api('PUT', `/faktury/${fDph}`, { poznamka: 'Upravená poznámka' })
t.over('úprava bez položiek (napr. od asistenta) DPH nezmení', [(await faktura(fDph)).dph, (await faktura(fDph)).suma], [88, 488])
const fPrenos = (await api('POST', '/faktury', {
  company_id: firmaSk, datum_vystav: '2026-10-06', datum_dodania: '2026-09-30', prenos_dph: true,
  polozky: [{ popis: 'Stavebné práce', mnozstvo: 1, cena: 1000 }],
})).d.id
const prenos = await faktura(fPrenos)
t.over('prenesenie daňovej povinnosti: faktúra bez DPH', [prenos.prenos_dph, prenos.dph, prenos.suma, prenos.polozky[0].sadzba_dph], [1, 0, 1000, null])
t.over(
  'staré faktúry sa po zmene na platiteľa neprepočítajú',
  [(await faktura(f1)).suma, (await faktura(f1)).s_dph],
  [staraFaktura.suma, 0],
)
await api('PUT', `/faktury/${f1}`, { poznamka: staraFaktura.poznamka })
t.over('…ani po úprave', (await faktura(f1)).suma, staraFaktura.suma)

const percentoRez = (await api('GET', '/nastavenia')).d.rezerva_percento
const uhrada = (await api('POST', `/faktury/${fDph}/stav`, { stav: 'zaplatena' })).d
t.over(
  'z platby s DPH si treba odložiť celú DPH a percento zo zvyšku',
  uhrada.odlozit,
  Math.round((88 + (400 * percentoRez) / 100) * 100) / 100,
)
const rezervaDph = (await api('GET', `/financie/rezerva?rok=${dnesISO().slice(0, 4)}`)).d
t.over('rezerva vie, koľko z prijatých peňazí je DPH', rezervaDph.dph_z_platieb, 88)

await api('POST', '/vydavky', { datum: '2026-09-15', popis: 'Materiál Hornbach', suma: 123, dph: 23, kategoria: 'Materiál' })
const efDph = (await nahladEf(ubl)).d
t.over('z e-faktúry sa doplní aj DPH na odpočet', efDph.navrh.dph, 4.67)
const prehladDph = (await api('GET', '/financie/dph?rok=2026')).d
const september = prehladDph.riadky.find((r) => r.obdobie === '2026-09')
t.over(
  'prehľad DPH za september: 88 € z faktúr, odpočet 23 € + 4,67 € z e-faktúry, zvyšok na úhradu',
  [september.zaklad, september.dph_vystup, september.dph_vstup, september.rozdiel, september.prenos_zaklad],
  [400, 88, 27.67, 60.33, 1000],
)
t.over('termín priznania do 25. októbra (alebo najbližší pracovný deň)', september.termin >= '2026-10-25' && september.termin <= '2026-10-27', true)
await api('PUT', '/nastavenia', { dph_obdobie: 'stvrtrocne' })
const stvrtroky = (await api('GET', '/financie/dph?rok=2026')).d
t.over('štvrťročne: 4 obdobia, september je v 3. štvrťroku', [stvrtroky.riadky.length, stvrtroky.riadky[2].dph_vystup], [4, 88])
const terminyDph = (await api('GET', '/terminy?dni=400')).d.terminy.filter((x) => x.druh === 'dph')
t.over('termíny DPH štvrťročne: január, apríl, júl, október', terminyDph.every((x) => ['01', '04', '07', '10'].includes(x.datum.slice(5, 7))) && terminyDph.length >= 4, true)
await api('PUT', '/nastavenia', { dph_rezim: 'neplatitel', dph_obdobie: 'mesacne' })
const neplatitelFaktura = (await api('POST', '/faktury', { company_id: firmaSk, polozky: [{ popis: 'Práca', mnozstvo: 1, cena: 50, sadzba_dph: 23 }] })).d.id
t.over('neplatiteľ: sadzba z položky sa ignoruje, faktúra je bez DPH', [(await faktura(neplatitelFaktura)).dph, (await faktura(neplatitelFaktura)).suma], [0, 50])

// ── Logo a vzhľad faktúry ─────────────────────────────────────
t.sekcia('Logo a vzhľad faktúry')
const obrazokLoga = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const nahrajLogo = async (obsah, nazov) => {
  const f = new FormData()
  f.append('logo', new Blob([obsah]), nazov)
  return api('POST', '/nastavenia/logo', f)
}
const sLogom = (await nahrajLogo(obrazokLoga, 'logo.png')).d
t.over('logo sa uloží ako nový súbor', /^[\w-]+\.png$/.test(sLogom.logo), true)
const obrazLoga = await api('GET', '/nastavenia/logo')
t.over('…a dá sa zobraziť', [obrazLoga.stav, obrazLoga.typ.startsWith('image/png')], [200, true])
t.over('iný súbor ako obrázok appka odmietne', (await nahrajLogo(Buffer.from('%PDF-1.4'), 'logo.pdf')).d.chyba, 'Logo musí byť obrázok PNG alebo JPG.')
const pdfVzhlady = []
for (const pdf_vzhlad of ['klasicky', 'usporny', 'vyrazny']) {
  await api('PUT', '/nastavenia', { pdf_vzhlad })
  const pdf = await api('GET', `/faktury/${f1}/pdf`)
  pdfVzhlady.push([pdf_vzhlad, pdf.stav, pdf.d.subarray(0, 5).toString()])
}
t.over(
  'faktúra s logom vo všetkých troch vzhľadoch',
  pdfVzhlady,
  [['klasicky', 200, '%PDF-'], ['usporny', 200, '%PDF-'], ['vyrazny', 200, '%PDF-']],
)
const bezLoga = (await api('POST', '/nastavenia/logo/odobrat')).d
const vratene = (await api('POST', '/nastavenia/logo/vratit', { logo: sLogom.logo })).d
t.over('odobrané logo sa dá vrátiť späť', [bezLoga.logo, vratene.logo], ['', sLogom.logo])
t.over('cudzí názov súboru sa ako logo nepriradí', (await api('POST', '/nastavenia/logo/vratit', { logo: '../app.db' })).stav, 400)
await api('POST', '/nastavenia/logo/odobrat')
await api('PUT', '/nastavenia', { pdf_vzhlad: 'klasicky' })

// ── Viac údajov na faktúre ────────────────────────────────────
t.sekcia('Viac údajov na faktúre')
const fTexty = (await api('POST', '/faktury', {
  company_id: firmaSk,
  cislo_objednavky: 'PO-2026-17',
  uvodny_text: 'Fakturujeme vám za práce podľa objednávky.',
  polozky: [{ popis: 'Montáž', mnozstvo: 1, cena: 100 }],
})).d.id
t.over('číslo objednávky a úvodný text sa uložia', [(await faktura(fTexty)).cislo_objednavky, (await faktura(fTexty)).uvodny_text], ['PO-2026-17', 'Fakturujeme vám za práce podľa objednávky.'])
await api('PUT', `/faktury/${fTexty}`, { poznamka: 'Ďakujem za spoluprácu.' })
t.over('úprava inej veci ich nezmaže', (await faktura(fTexty)).cislo_objednavky, 'PO-2026-17')
const pdfTexty = await api('GET', `/faktury/${fTexty}/pdf`)
t.over('PDF s číslom objednávky a úvodným textom', [pdfTexty.stav, pdfTexty.d.subarray(0, 5).toString()], [200, '%PDF-'])

t.koniec()
