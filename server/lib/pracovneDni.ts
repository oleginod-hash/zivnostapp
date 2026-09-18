/**
 * Pracovné dni na Slovensku – na splatnosť faktúry „v pracovných dňoch".
 *
 * Používa ho server (nové faktúry, aj tie od asistenta) aj formulár faktúry,
 * preto je na jednom mieste – sviatky sa tak nedajú rozsynchronizovať.
 *
 * Pracovný deň = pondelok až piatok, ktorý nie je dňom pracovného pokoja.
 * Zoznam sviatkov zodpovedá stavu po zákone č. 261/2025 Z. z. (konsolidácia):
 *   • 1. september nie je dňom pracovného pokoja od roku 2025,
 *   • 17. november nie je dňom pracovného pokoja od roku 2026 (natrvalo),
 *   • 8. máj a 15. september nie sú dňami pracovného pokoja v roku 2026
 *     (dočasne, len na tento rok).
 * Zákon sa môže znova zmeniť – vypočítaný dátum splatnosti je preto vo
 * formulári vždy vidieť a dá sa prepísať ručne.
 */

const DEN = 86400000

function naMs(iso: string): number {
  const [r, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(r, m - 1, d)
}

function naIso(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Veľkonočná nedeľa (gregoriánsky kalendár, Meeusov algoritmus). */
function velkaNoc(rok: number): number {
  const a = rok % 19
  const b = Math.floor(rok / 100)
  const c = rok % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mesiac = Math.floor((h + l - 7 * m + 114) / 31)
  const den = ((h + l - 7 * m + 114) % 31) + 1
  return Date.UTC(rok, mesiac - 1, den)
}

const pamat = new Map<number, Set<string>>()

/** Dni pracovného pokoja v danom roku (ako RRRR-MM-DD). */
export function sviatky(rok: number): Set<string> {
  const ulozene = pamat.get(rok)
  if (ulozene) return ulozene

  const pevne = ['01-01', '01-06', '05-01', '07-05', '08-29', '11-01', '12-24', '12-25', '12-26']
  if (rok !== 2026) pevne.push('05-08', '09-15')
  if (rok < 2025) pevne.push('09-01')
  if (rok < 2026) pevne.push('11-17')

  const vysledok = new Set(pevne.map((md) => `${rok}-${md}`))
  const nedela = velkaNoc(rok)
  vysledok.add(naIso(nedela - 2 * DEN)) // Veľký piatok
  vysledok.add(naIso(nedela + DEN)) // Veľkonočný pondelok

  pamat.set(rok, vysledok)
  return vysledok
}

export function jePracovnyDen(iso: string): boolean {
  const ms = naMs(iso)
  const denTyzdna = new Date(ms).getUTCDay() // 0 = nedeľa, 6 = sobota
  if (denTyzdna === 0 || denTyzdna === 6) return false
  return !sviatky(new Date(ms).getUTCFullYear()).has(naIso(ms))
}

/**
 * Dátum o `pocet` pracovných dní neskôr. Deň vystavenia sa nepočíta –
 * rovnako ako pri kalendárnych dňoch: splatnosť 10 dní = desiaty deň po ňom.
 */
export function pridajPracovneDni(iso: string, pocet: number): string {
  let ms = naMs(iso)
  const krok = pocet < 0 ? -DEN : DEN
  let zostava = Math.abs(Math.round(pocet))
  while (zostava > 0) {
    ms += krok
    if (jePracovnyDen(naIso(ms))) zostava--
  }
  return naIso(ms)
}

/** Koľko pracovných dní je od `od` (bez neho) do `do` (vrátane). Záporné, ak je `do` skôr. */
export function pracovnychDniMedzi(od: string, doDna: string): number {
  const zaciatok = naMs(od)
  const koniec = naMs(doDna)
  if (koniec === zaciatok) return 0
  const krok = koniec > zaciatok ? DEN : -DEN
  let pocet = 0
  for (let ms = zaciatok + krok; krok > 0 ? ms <= koniec : ms >= koniec; ms += krok) {
    if (jePracovnyDen(naIso(ms))) pocet++
  }
  return krok > 0 ? pocet : -pocet
}
