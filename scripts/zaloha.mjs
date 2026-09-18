// Záloha dát Živnosťapp: databáza + prílohy do priečinka so značkou dátumu.
// Funguje aj keď appka práve beží – SQLite zálohujeme jeho vlastnou funkciou,
// nie obyčajným kopírovaním (to by pri zápise mohlo dať poškodený súbor).
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import 'dotenv/config'

const DATA_DIR = process.env.DATA_DIR?.trim() || 'C:\\ZivnostAppData'
const CIEL_ZAKLAD = process.env.ZALOHA_DIR?.trim() || path.join(DATA_DIR, 'zalohy')

const d = new Date()
const znacka = [
  d.getFullYear(),
  String(d.getMonth() + 1).padStart(2, '0'),
  String(d.getDate()).padStart(2, '0'),
  '-',
  String(d.getHours()).padStart(2, '0'),
  String(d.getMinutes()).padStart(2, '0'),
].join('')

const ciel = path.join(CIEL_ZAKLAD, znacka)
fs.mkdirSync(ciel, { recursive: true })

const zdrojDb = path.join(DATA_DIR, 'app.db')
if (!fs.existsSync(zdrojDb)) {
  console.error(`\n  Databáza sa nenašla: ${zdrojDb}`)
  console.error('  Skontroluj DATA_DIR v súbore .env.\n')
  process.exit(1)
}

const db = new Database(zdrojDb, { readonly: true })
await db.backup(path.join(ciel, 'app.db'))
db.close()

// Prílohy (zmluvy, bločky) sú obyčajné súbory – tie stačí skopírovať.
let pocetSuborov = 0
const zdrojFiles = path.join(DATA_DIR, 'files')
if (fs.existsSync(zdrojFiles)) {
  fs.cpSync(zdrojFiles, path.join(ciel, 'files'), { recursive: true })
  const spocitaj = (p) => {
    for (const polozka of fs.readdirSync(p, { withFileTypes: true })) {
      if (polozka.isDirectory()) spocitaj(path.join(p, polozka.name))
      else pocetSuborov++
    }
  }
  spocitaj(zdrojFiles)
}

const velkost = fs.statSync(path.join(ciel, 'app.db')).size

console.log(`\n  Záloha hotová.`)
console.log(`  Kam:     ${ciel}`)
console.log(`  Databáza: ${(velkost / 1024).toFixed(0)} kB`)
console.log(`  Prílohy:  ${pocetSuborov} súborov`)
console.log(`\n  Túto zálohu si občas skopíruj aj mimo počítača (USB, iný disk).\n`)
