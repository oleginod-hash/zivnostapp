/**
 * AI asistent nesiaha do databázy priamo – volá to isté API, ktoré používa UI.
 * Vďaka tomu platia rovnaké kontroly a dopočty (číslovanie faktúr, priradenie
 * turnusu k výdavku, dedenie firmy) a nemôže vzniknúť druhá, odlišná logika.
 */

/** Metódy, ktoré smie AI použiť. DELETE tu zámerne nie je a nikdy nebude. */
const POVOLENE_METODY = ['GET', 'POST', 'PUT', 'PATCH']

export class NastrojChyba extends Error {}

export async function volajApi(
  metoda: string,
  cesta: string,
  telo?: unknown,
): Promise<{ ok: boolean; stav: number; data: any }> {
  const m = metoda.toUpperCase()
  if (!POVOLENE_METODY.includes(m)) {
    // Poistka nezávislá od toho, aké nástroje sme AI dali k dispozícii.
    throw new NastrojChyba(`Metóda ${m} nie je pre asistenta povolená.`)
  }

  const port = Number(process.env.PORT) || 3000
  const odpoved = await fetch(`http://127.0.0.1:${port}/api${cesta}`, {
    method: m,
    headers: { 'Content-Type': 'application/json' },
    body: telo === undefined ? undefined : JSON.stringify(telo),
  })

  const text = await odpoved.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { ok: odpoved.ok, stav: odpoved.status, data }
}
