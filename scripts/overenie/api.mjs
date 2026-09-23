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
t.over('nový používateľ nemá zapnuté zákazky v zahraničí', (await api('GET', '/nastavenia')).d.praca_v_zahranici, 0)
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

t.koniec()
