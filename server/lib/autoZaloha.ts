import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, FILES_DIR, db, meta, setMeta } from '../db.js'
import { dnesISO } from './format.js'

/**
 * Automatická denná záloha. Kontroluje sa pri štarte a potom každú hodinu,
 * takže prebehne aj vtedy, keď appka beží celé dni bez reštartu.
 * Manuálne zálohovanie (Zaloha.bat) ostáva – to robí úplnú kópiu aj na USB.
 */
const ZALOHY_DIR = path.join(DATA_DIR, 'zalohy')
const DNI_DRZAT = 30
const KONTROLA_KAZDU = 60 * 60 * 1000

function dnesnaZnacka(): string {
  return dnesISO().replace(/-/g, '')
}

let bezi = false

export async function autoZalohaAkTreba(): Promise<void> {
  const dnes = dnesnaZnacka()
  if (bezi || meta('posledna_auto_zaloha') === dnes) return
  bezi = true

  const ciel = path.join(ZALOHY_DIR, `${dnes}-auto`)
  try {
    fs.mkdirSync(ciel, { recursive: true })
    await db.backup(path.join(ciel, 'app.db'))
    if (fs.existsSync(FILES_DIR)) prenesPrilohy(FILES_DIR, path.join(ciel, 'files'))
    setMeta('posledna_auto_zaloha', dnes)
    console.log(`[zaloha] denná záloha uložená do ${ciel}`)
    upracStareZalohy()
  } catch (e) {
    // Zlyhanie zálohy nesmie zabrániť behu appky – len o ňom nahlas povieme.
    console.error('[zaloha] automatická záloha zlyhala:', e)
  } finally {
    bezi = false
  }
}

/** Denná záloha aj počas behu: pri štarte a potom raz za hodinu. */
export function spustiAutoZalohy(): void {
  void autoZalohaAkTreba()
  setInterval(() => void autoZalohaAkTreba(), KONTROLA_KAZDU).unref()
}

/**
 * Prílohy sa po uložení už nikdy nemenia (majú náhodné mená), preto ich do
 * zálohy nekopírujeme, ale „prepájame" pevným odkazom. Záloha tak vyzerá ako
 * úplná kópia a dá sa obnoviť jednoduchým skopírovaním priečinka, ale na
 * disku nezaberá miesto navyše. Keď sa odkaz vytvoriť nedá (iný disk,
 * iný súborový systém), súbor sa normálne skopíruje.
 */
function prenesPrilohy(zdroj: string, ciel: string): void {
  fs.mkdirSync(ciel, { recursive: true })
  for (const polozka of fs.readdirSync(zdroj, { withFileTypes: true })) {
    const odkial = path.join(zdroj, polozka.name)
    const kam = path.join(ciel, polozka.name)
    if (polozka.isDirectory()) {
      prenesPrilohy(odkial, kam)
      continue
    }
    if (fs.existsSync(kam)) continue
    try {
      fs.linkSync(odkial, kam)
    } catch {
      fs.copyFileSync(odkial, kam)
    }
  }
}

/** Automatické zálohy staršie než 30 dní zmažeme. Ručné (bez „-auto") nechávame. */
function upracStareZalohy(): void {
  if (!fs.existsSync(ZALOHY_DIR)) return
  const hranica = Date.now() - DNI_DRZAT * 86400_000

  for (const polozka of fs.readdirSync(ZALOHY_DIR, { withFileTypes: true })) {
    if (!polozka.isDirectory() || !polozka.name.endsWith('-auto')) continue
    const cesta = path.join(ZALOHY_DIR, polozka.name)
    try {
      if (fs.statSync(cesta).mtimeMs < hranica) {
        fs.rmSync(cesta, { recursive: true, force: true })
        console.log(`[zaloha] zmazaná stará záloha ${polozka.name}`)
      }
    } catch {
      /* nevadí, skúsime nabudúce */
    }
  }
}

/** Informácia pre UI – kedy naposledy a koľko záloh existuje. */
export function stavZaloh(): { posledna: string | null; pocet: number; priecinok: string } {
  let pocet = 0
  if (fs.existsSync(ZALOHY_DIR)) {
    pocet = fs.readdirSync(ZALOHY_DIR, { withFileTypes: true }).filter((p) => p.isDirectory()).length
  }
  return { posledna: meta('posledna_auto_zaloha'), pocet, priecinok: ZALOHY_DIR }
}
