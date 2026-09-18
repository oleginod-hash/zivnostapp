import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, FILES_DIR, db, meta, setMeta } from '../db.js'

/**
 * Automatická denná záloha. Beží pri štarte appky – ak dnes ešte nebola,
 * spraví ju. Manuálne zálohovanie (Zaloha.bat) ostáva, toto je poistka
 * pre prípad, že si naň človek nespomenie.
 */
const ZALOHY_DIR = path.join(DATA_DIR, 'zalohy')
const DNI_DRZAT = 30

function dnesnyDatum(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export async function autoZalohaAkTreba(): Promise<void> {
  const dnes = dnesnyDatum()
  if (meta('posledna_auto_zaloha') === dnes) return

  const ciel = path.join(ZALOHY_DIR, `${dnes}-auto`)
  try {
    fs.mkdirSync(ciel, { recursive: true })
    await db.backup(path.join(ciel, 'app.db'))
    if (fs.existsSync(FILES_DIR)) {
      fs.cpSync(FILES_DIR, path.join(ciel, 'files'), { recursive: true })
    }
    setMeta('posledna_auto_zaloha', dnes)
    console.log(`[zaloha] denná záloha uložená do ${ciel}`)
    upracStareZalohy()
  } catch (e) {
    // Zlyhanie zálohy nesmie zabrániť spusteniu appky – len o ňom nahlas povieme.
    console.error('[zaloha] automatická záloha zlyhala:', e)
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
