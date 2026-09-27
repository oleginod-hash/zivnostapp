import fs from 'node:fs'
import path from 'node:path'
import { FILES_DIR } from '../db.js'

/** Logo na faktúre – súbory v DATA_DIR/files/logo, v nastaveniach je len názov súboru. */
export const PRIECINOK_LOGA = path.join(FILES_DIR, 'logo')

/** Cesta k súboru loga, alebo null, keď logo nie je nahraté (či súbor chýba). */
export function cestaLoga(logo: string | null | undefined): string | null {
  if (!logo || !/^[\w-]+\.(png|jpg)$/.test(logo)) return null
  const cesta = path.join(PRIECINOK_LOGA, logo)
  return fs.existsSync(cesta) ? cesta : null
}
