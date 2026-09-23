/** Dátum z DB (RRRR-MM-DD) na slovenský formát dd.mm.rrrr. */
export function skDatum(iso: string | null | undefined): string {
  if (!iso) return ''
  const [r, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)}.${Number(m)}.${r}`
}

/** Suma v EUR so slovenským oddeľovačom, napr. 1 234,50 €. */
export function skSuma(n: number): string {
  return new Intl.NumberFormat('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' €'
}

export function skCislo(n: number): string {
  return new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 3 }).format(n)
}

/**
 * Časové pásmo appky. Kalendárne „dnes" (splatnosť, prebiehajúci turnus, koniec zmluvy)
 * sa ráta podľa neho – nie podľa UTC ani podľa nastavenia servera, na ktorom appka beží.
 */
const PREDVOLENE_PASMO = 'Europe/Bratislava'

function formatDna(pasmo: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', { timeZone: pasmo, year: 'numeric', month: '2-digit', day: '2-digit' })
}

/** Pásmo z `.env`. Preklep v ňom nesmie appku zhodiť – vtedy platí predvolené. */
function zvolPasmo(): string {
  const zadane = process.env.CASOVE_PASMO?.trim()
  if (!zadane) return PREDVOLENE_PASMO
  try {
    formatDna(zadane)
    return zadane
  } catch {
    console.error(`[čas] Časové pásmo „${zadane}" z .env neexistuje – používam ${PREDVOLENE_PASMO}.`)
    return PREDVOLENE_PASMO
  }
}

export const CASOVE_PASMO = zvolPasmo()

const FORMAT_DNA = formatDna(CASOVE_PASMO)

/** Dnešný dátum v tvare RRRR-MM-DD v časovom pásme appky. */
export function dnesISO(): string {
  return FORMAT_DNA.format(new Date())
}

export function pridajDni(iso: string, dni: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + dni)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Text pripravený na porovnanie pri hľadaní: malé písmená, bez diakritiky. */
export function naHladanie(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Vzor pre `bez_diakritiky(stĺpec) LIKE ?` z textu, ktorý používateľ napísal. */
export function vzorHladania(text: string): string {
  return `%${naHladanie(text.trim())}%`
}

/** Podmienka „aspoň jeden zo stĺpcov obsahuje hľadaný text" (parameter @q). */
export function hladajVStlpcoch(stlpce: string[]): string {
  return '(' + stlpce.map((s) => `bez_diakritiky(${s}) LIKE @q`).join(' OR ') + ')'
}

export function zaokruhli(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
