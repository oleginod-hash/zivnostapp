// Kontrola na KÓPII skutočných dát: prejdú migrácie, databáza je v poriadku,
// všetky zoznamy a prehľady sa načítajú a súčty z rôznych miest appky si
// navzájom sedia. Skutočné dáta sa len skopírujú – test do nich nikdy nezapisuje.
import dotenv from 'dotenv'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  KOREN, docasnyPriecinok, kontroly, modulServera, nahodnyPort, preskoc, spustiServer, vytvorApi,
} from './spolocne.mjs'

const NAZOV = 'Kópia skutočných dát'

// Kde sú skutočné dáta – rovnako ako v server/db.ts, len bez načítania .env
// do prostredia (test beží nad kópiou v inom priečinku).
const subor = path.join(KOREN, '.env')
const env = fs.existsSync(subor) ? dotenv.parse(fs.readFileSync(subor)) : {}
const ZDROJ =
  env.DATA_DIR?.trim() || (process.platform === 'win32' ? 'C:\\ZivnostAppData' : path.join(os.homedir(), 'ZivnostAppData'))
if (!fs.existsSync(path.join(ZDROJ, 'app.db'))) preskoc(NAZOV, `skutočné dáta sa nenašli (${ZDROJ})`)

// Databáza aj s ešte nezapísanými zmenami (-wal) a ich indexom (-shm).
// Prílohy na túto kontrolu netreba.
const DATA = docasnyPriecinok()
for (const s of ['app.db', 'app.db-wal', 'app.db-shm']) {
  if (fs.existsSync(path.join(ZDROJ, s))) fs.copyFileSync(path.join(ZDROJ, s), path.join(DATA, s))
}

const t = kontroly(`${NAZOV} (${ZDROJ} → dočasná kópia)`)
const api = vytvorApi(await spustiServer(DATA, nahodnyPort()))
const { db, VERZIA_SCHEMY } = await modulServera('db.js')
const { dnesISO } = await modulServera('lib/format.js')

t.sekcia('Databáza')
t.over('prešla migráciami na aktuálnu verziu', db.pragma('user_version', { simple: true }), VERZIA_SCHEMY)
t.over('nie je poškodená', db.pragma('integrity_check', { simple: true }), 'ok')
t.over('väzby medzi tabuľkami sedia', db.pragma('foreign_key_check').length, 0)
const profil = db.prepare('SELECT meno, sprievodca_hotovy FROM settings WHERE id = 1').get()
t.over('kto appku už používa, sprievodcu prvým spustením neuvidí', profil.meno ? profil.sprievodca_hotovy : 1, 1)

t.sekcia('Stránky appky')
const rok = dnesISO().slice(0, 4)
const cesty = [
  '/nastavenia', '/faktury', '/faktury/suhrn', '/faktury/pocty', '/faktury/prehlad/dlhy', '/faktury/nova',
  `/financie/prehlad?rok=${rok}`, `/financie/mesacne?rok=${rok}`, `/financie/kategorie?rok=${rok}`,
  `/financie/turnusy?rok=${rok}`, '/financie/roky', '/turnusy', '/turnusy/suhrn', '/objednavky', '/zmluvy',
  '/zmluvy/suhrn', '/vydavky', '/vydavky/suhrn', '/vydavky/kategorie', '/firmy', '/kos', '/mail/po-splatnosti',
  `/danovy-podklad?rok=${rok}`, `/danovy-podklad/xlsx?rok=${rok}`, `/stravne/dni?rok=${rok}`, '/stravne/sadzby',
  '/hladat?q=fa', '/ai/stav', '/ai/konverzacie', '/sablony', '/zalohy/stav',
]
const zlyhane = []
for (const c of cesty) {
  const r = await api('GET', c)
  if (r.stav !== 200) zlyhane.push(`${c} → ${r.stav} ${r.d?.chyba ?? ''}`.trim())
}
t.over(`všetkých ${cesty.length} zoznamov a prehľadov sa načíta bez chyby`, zlyhane, [])

t.sekcia('Súčty sedia naprieč appkou')
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100
const suhrn = (await api('GET', '/faktury/suhrn')).d
const dlhy = (await api('GET', '/faktury/prehlad/dlhy')).d
const vsetko = (await api('GET', '/financie/prehlad')).d
const cakaVZozname = dlhy.nevyplatene.reduce((s, f) => s + (f.otvoreny_zostatok > 0.005 ? f.otvoreny_zostatok : 0), 0)
t.over('čakajúca suma: Prehľad = zoznam dlhov', r2(suhrn.nezaplatene), r2(cakaVZozname))
t.over('čakajúca suma: Prehľad = Financie', r2(suhrn.nezaplatene), r2(vsetko.caka_na_zaplatenie))
t.over('prijaté spolu: Prehľad = Financie', r2(suhrn.zaplatene), r2(vsetko.prijmy))
const pocty = (await api('GET', '/faktury/pocty')).d
t.over('počet faktúr v záložke „Všetky" = zoznam', pocty.vsetky, (await api('GET', '/faktury')).d.length)

t.sekcia('PDF')
const posledna = db
  .prepare("SELECT id, cislo FROM invoices WHERE stav <> 'koncept' ORDER BY datum_vystav DESC, id DESC LIMIT 1")
  .get()
if (posledna) {
  const pdf = await api('GET', `/faktury/${posledna.id}/pdf`)
  t.over(`PDF poslednej faktúry (${posledna.cislo}) sa vytvorí`, [pdf.stav, pdf.d.subarray?.(0, 5).toString()], [200, '%PDF-'])
}

t.koniec()
