import { db } from '../db.js'
import { naHladanie, zaokruhli } from './format.js'

/**
 * Rezerva na dane a odvody. Živnostník dostane celú sumu faktúry, no časť z nej
 * patrí štátu – daň a odvody sa platia neskôr. Appka presnú daň nepočíta (závisí
 * od výdavkov, odvodov a výšky príjmu), len pripomína percento, ktoré si
 * používateľ sám nastaví, zvyčajne po dohode s účtovníčkou.
 */

export function percentoRezervy(): number {
  const n = db.prepare('SELECT rezerva_percento FROM settings WHERE id = 1').get() as { rezerva_percento: number } | undefined
  return Number(n?.rezerva_percento) || 0
}

/** Koľko si z prijatej sumy odložiť (0, keď rezerva nie je nastavená). */
export function naOdlozenie(suma: number): number {
  return zaokruhli((suma * percentoRezervy()) / 100)
}

/**
 * Druh výdavku podľa kategórie – zaplatené dane a odvody znižujú, koľko má
 * v rezerve ešte zostať. Okrem predvolených kategórií („Daň", „Odvody (SP/ZP)")
 * rozoznáme aj vlastné názvy ako „Sociálna poisťovňa" či „Daň z príjmu".
 */
export function druhPlatbyStatu(kategoria: string): 'dan' | 'odvody' | null {
  const k = naHladanie(kategoria ?? '').trim()
  if (/(^| )(odvod|socialn|zdravotn)/.test(k) || /poistovn/.test(k)) return 'odvody'
  if (/^dan( |$|e)/.test(k) || /dan z prijm/.test(k)) return 'dan'
  return null
}

export function rezervaZaRok(rok: string) {
  const percento = percentoRezervy()
  const prijate = (
    db.prepare("SELECT COALESCE(SUM(suma), 0) AS s FROM invoice_payments WHERE strftime('%Y', datum) = ?").get(rok) as { s: number }
  ).s
  const podlaKategorii = db
    .prepare(
      `SELECT kategoria, COALESCE(SUM(suma), 0) AS suma FROM expenses
       WHERE druh = 'vydavok' AND strftime('%Y', datum) = ? GROUP BY kategoria`,
    )
    .all(rok) as { kategoria: string; suma: number }[]

  let dane = 0
  let odvody = 0
  for (const k of podlaKategorii) {
    const druh = druhPlatbyStatu(k.kategoria)
    if (druh === 'dan') dane += k.suma
    if (druh === 'odvody') odvody += k.suma
  }
  const odlozit = zaokruhli((prijate * percento) / 100)
  return {
    rok,
    percento,
    prijate: zaokruhli(prijate),
    odlozit,
    zaplatene_dane: zaokruhli(dane),
    zaplatene_odvody: zaokruhli(odvody),
    zostava: zaokruhli(odlozit - dane - odvody),
  }
}
