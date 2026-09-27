import { db } from '../db.js'
import { dnesISO, pridajDni, zaokruhli } from './format.js'

/**
 * Kurzy cudzích mien pre výdavky. Používa referenčné kurzy ECB (tie isté
 * vyhlasuje aj NBS) cez bezplatnú službu Frankfurter – bez kľúča a registrácie.
 *
 * Berie sa kurz z dňa pred dátumom dokladu, ako to pri prepočte cudzej meny
 * vyžaduje zákon o účtovníctve (§ 24). Cez víkend a sviatky ECB kurz nevyhlasuje –
 * vtedy platí posledný vyhlásený. Stiahnutý kurz si appka pamätá, takže sa na ten
 * istý deň nepýta znova a funguje aj bez internetu.
 */
const ZDROJ = 'https://api.frankfurter.dev/v1/'

/** Meny v ponuke – najčastejšie pri práci v zahraničí. */
export const MENY = ['EUR', 'CZK', 'PLN', 'HUF', 'CHF', 'GBP', 'NOK', 'SEK', 'DKK', 'RON', 'USD'] as const

export type Kurz = { mena: string; kurz: number; datum_kurzu: string }

export function jeMena(mena: unknown): mena is string {
  return typeof mena === 'string' && /^[A-Z]{3}$/.test(mena)
}

/** Kurz ECB (koľko jednotiek meny za 1 €) platný pre doklad z dňa `datumDokladu`. */
export async function kurzPreDoklad(mena: string, datumDokladu: string): Promise<Kurz> {
  if (!jeMena(mena)) throw new Error('Neznáma mena.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datumDokladu)) throw new Error('Chýba dátum dokladu.')
  if (datumDokladu > dnesISO()) throw new Error('Kurz pre budúci dátum ešte nie je vyhlásený.')
  const den = pridajDni(datumDokladu, -1)

  const ulozeny = db.prepare('SELECT kurz, datum_kurzu FROM kurzy WHERE den = ? AND mena = ?').get(den, mena) as
    | { kurz: number; datum_kurzu: string }
    | undefined
  if (ulozeny) return { mena, ...ulozeny }

  let data: any
  try {
    const odpoved = await fetch(`${ZDROJ}${den}?base=EUR&symbols=${mena}`, { signal: AbortSignal.timeout(8000) })
    if (odpoved.status === 404) throw new Error('nenájdené')
    if (!odpoved.ok) throw new Error(`stav ${odpoved.status}`)
    data = await odpoved.json()
  } catch {
    throw new Error('Kurz ECB sa nepodarilo zistiť (bez internetu?). Zadaj kurz alebo sumu v eurách ručne.')
  }
  const kurz = Number(data?.rates?.[mena])
  if (!(kurz > 0)) throw new Error(`Pre menu ${mena} ECB kurz nevyhlasuje. Zadaj sumu v eurách ručne.`)
  const datumKurzu = String(data?.date ?? den)
  db.prepare('INSERT OR REPLACE INTO kurzy (den, mena, kurz, datum_kurzu) VALUES (?, ?, ?, ?)').run(den, mena, kurz, datumKurzu)
  return { mena, kurz, datum_kurzu: datumKurzu }
}

/** Suma v eurách zo sumy v cudzej mene a kurzu ECB. */
export const naEura = (sumaVMene: number, kurz: number) => zaokruhli(sumaVMene / kurz)
