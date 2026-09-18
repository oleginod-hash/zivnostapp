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

export function dnesISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
