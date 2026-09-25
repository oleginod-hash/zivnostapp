// Logika servera na čistej databáze s vymyslenými údajmi: platby a ich
// vrátenie, zálohové faktúry, kôš, súkromné príjmy, hľadanie, splatnosť,
// časové pásmo, automatické zálohy, ochrana dát a obmedzenia asistenta.
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import {
  docasnyPriecinok, kontroly, modulServera, nahodnyPort, pockaj, spustiServer, vytvorApi, ziadostSHostom,
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

t.koniec()
