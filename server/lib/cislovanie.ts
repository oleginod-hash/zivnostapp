import { db } from '../db.js'

/**
 * Vygeneruje ďalšie číslo faktúry podľa vzoru z nastavení.
 * Podporované značky: {RRRR} rok, {RR} rok dvojmiestne, {MM} mesiac, {NNN} poradie
 * (počet N určuje, na koľko miest sa poradie doplní nulami).
 */
export function dalsieCislo(vzor: string, datum: string): string {
  const [rok, mesiac] = datum.slice(0, 10).split('-')
  const nCislic = (vzor.match(/\{(N+)\}/)?.[1].length) ?? 3

  const prefix = vzor
    .replace(/\{RRRR\}/g, rok)
    .replace(/\{RR\}/g, rok.slice(2))
    .replace(/\{MM\}/g, mesiac)

  const [pred, po] = prefix.split(/\{N+\}/)
  const like = `${pred}%${po}`

  const existujuce = db.prepare('SELECT cislo FROM invoices WHERE cislo LIKE ?').all(like) as { cislo: string }[]
  let max = 0
  for (const { cislo } of existujuce) {
    const stred = cislo.slice(pred.length, cislo.length - po.length)
    if (/^\d+$/.test(stred)) max = Math.max(max, Number(stred))
  }
  return `${pred}${String(max + 1).padStart(nCislic, '0')}${po}`
}
