// Spustí overovacie testy – každý vo vlastnom procese a nad vlastným dočasným
// priečinkom dát, ktorý po sebe aj zmaže. Skutočné dáta sa nikdy nemenia.
//
//   npm run overenie                          zostaví appku a spustí všetko
//   node scripts/overenie/index.mjs api ui    len vybrané testy (bez zostavenia)
//   (na výber: api, kopia, ui, ui-tmavy)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRESKOCENE } from './spolocne.mjs'

const TU = path.dirname(fileURLToPath(import.meta.url))
/** [kľúč, súbor, názov, premenné prostredia navyše] */
const TESTY = [
  ['api', 'api', 'Logika servera', {}],
  ['kopia', 'kopia', 'Kópia skutočných dát', {}],
  ['ui', 'ui', 'Obrazovky appky – svetlý režim', {}],
  ['ui-tmavy', 'ui', 'Obrazovky appky – tmavý režim', { OVERENIE_TEMA: 'tmavy' }],
]
const LIMIT_MS = 4 * 60 * 1000

const vybrane = process.argv.slice(2)
const nezname = vybrane.filter((v) => !TESTY.some(([kluc]) => kluc === v))
if (nezname.length) {
  console.log(`Neznámy test: ${nezname.join(', ')}. Na výber: ${TESTY.map(([k]) => k).join(', ')}.`)
  process.exit(1)
}

const vysledky = []
for (const [, subor, nazov, prostredie] of TESTY.filter(([k]) => !vybrane.length || vybrane.includes(k))) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'zivnostapp-overenie-'))
  const kod = await new Promise((hotovo) => {
    const proces = spawn(process.execPath, [path.join(TU, `${subor}.mjs`)], {
      stdio: 'inherit',
      env: { ...process.env, ...prostredie, OVERENIE_DATA: data },
    })
    const strazca = setTimeout(() => {
      console.log(`\n   ${nazov}: vypršal časový limit, test zastavujem.`)
      proces.kill()
    }, LIMIT_MS)
    proces.on('exit', (k) => {
      clearTimeout(strazca)
      hotovo(k ?? 1)
    })
  })
  try {
    fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  } catch {
    // Na Windowse niekedy ešte chvíľu drží súbor Chrome – priečinok ostane v TEMP.
  }
  vysledky.push([nazov, kod])
}

console.log('\n══ Výsledok')
for (const [nazov, kod] of vysledky) {
  const stav = kod === 0 ? 'OK        ' : kod === PRESKOCENE ? 'PRESKOČENÉ' : 'CHYBA     '
  console.log(`   ${stav} ${nazov}`)
}
const zlyhalo = vysledky.some(([, kod]) => kod !== 0 && kod !== PRESKOCENE)
console.log(zlyhalo ? '\n   Niečo nesedí – podrobnosti sú vyššie pri CHYBA.\n' : '\n   Všetko v poriadku.\n')
process.exit(zlyhalo ? 1 : 0)
