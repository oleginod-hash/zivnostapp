import { db } from '../db.js'
import { naHladanie, zaokruhli } from './format.js'
import { PLATBA_BEZ_DPH_SQL } from './platby.js'

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

/** Aká časť faktúry je DPH (0 pri faktúre bez DPH) – tá z každej platby patrí celá štátu. */
export function podielDph(invoiceId: number): number {
  const f = db.prepare('SELECT dph, suma FROM invoices WHERE id = ?').get(invoiceId) as { dph: number; suma: number } | undefined
  return f && f.dph && f.suma ? f.dph / f.suma : 0
}

/**
 * Koľko si z prijatej sumy odložiť: DPH celú (platiteľ ju odvedie štátu)
 * a zo zvyšku nastavené percento na daň z príjmov a odvody.
 */
export function naOdlozenie(suma: number, dphPodiel = 0): number {
  const dph = suma * dphPodiel
  return zaokruhli(dph + ((suma - dph) * percentoRezervy()) / 100)
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
  const platby = db
    .prepare(
      `SELECT COALESCE(SUM(p.suma), 0) AS prijate, COALESCE(SUM(${PLATBA_BEZ_DPH_SQL('p')}), 0) AS bez_dph
       FROM invoice_payments p WHERE strftime('%Y', p.datum) = ?`,
    )
    .get(rok) as { prijate: number; bez_dph: number }
  const prijate = platby.prijate
  const dph = zaokruhli(platby.prijate - platby.bez_dph)
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
  const odlozit = zaokruhli(dph + (platby.bez_dph * percento) / 100)
  return {
    rok,
    percento,
    prijate: zaokruhli(prijate),
    // Platiteľ: DPH z prijatých platieb patrí štátu celá, percento sa ráta zo zvyšku.
    dph_z_platieb: dph,
    prijate_bez_dph: zaokruhli(platby.bez_dph),
    odlozit,
    zaplatene_dane: zaokruhli(dane),
    zaplatene_odvody: zaokruhli(odvody),
    zostava: zaokruhli(odlozit - dane - odvody),
  }
}
