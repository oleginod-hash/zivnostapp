/**
 * DPH na faktúre platiteľa. Čisté výpočty bez databázy – používa ich server
 * aj formulár faktúry, aby súčet na obrazovke sedel s PDF do centa.
 *
 * Sadzby platia na Slovensku od 1. 1. 2025: základná 23 %, znížené 19 % a 5 %.
 * 0 % znamená plnenie oslobodené od dane. Pri zmene zákona sa upravia tu.
 */
export const SADZBY_DPH = [23, 19, 5, 0] as const

export function jeSadzbaDph(s: unknown): boolean {
  return s !== null && s !== undefined && s !== '' && (SADZBY_DPH as readonly number[]).includes(Number(s))
}

export type PolozkaDph = { mnozstvo: number; cena: number; sadzba_dph?: number | null }
export type RiadokRekapitulacie = { sadzba: number; zaklad: number; dph: number }
export type SuctyFaktury = { zaklad: number; dph: number; suma: number; rekapitulacia: RiadokRekapitulacie[] }

const naCenty = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Súčty faktúry. Základ každej položky sa zaokrúhli na centy, DPH sa počíta
 * zo súčtu základov za každú sadzbu (tak ako v rekapitulácii na faktúre).
 * Bez DPH (neplatiteľ, prenesenie daňovej povinnosti) je suma rovná základu.
 */
export function spocitajFakturu(polozky: PolozkaDph[], sDph: boolean): SuctyFaktury {
  const zaklad = naCenty(polozky.reduce((s, p) => s + naCenty((Number(p.mnozstvo) || 0) * (Number(p.cena) || 0)), 0))
  if (!sDph) return { zaklad, dph: 0, suma: zaklad, rekapitulacia: [] }

  const podlaSadzby = new Map<number, number>()
  for (const p of polozky) {
    const sadzba = jeSadzbaDph(p.sadzba_dph) ? Number(p.sadzba_dph) : 0
    podlaSadzby.set(sadzba, (podlaSadzby.get(sadzba) ?? 0) + naCenty((Number(p.mnozstvo) || 0) * (Number(p.cena) || 0)))
  }
  const rekapitulacia = [...podlaSadzby.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([sadzba, z]) => ({ sadzba, zaklad: naCenty(z), dph: naCenty((z * sadzba) / 100) }))
  const dph = naCenty(rekapitulacia.reduce((s, r) => s + r.dph, 0))
  return { zaklad, dph, suma: naCenty(zaklad + dph), rekapitulacia }
}
