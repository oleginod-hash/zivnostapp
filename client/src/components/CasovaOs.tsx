import { dnesISO, pocet, skDatum, skSuma, type Faktura } from '../api'

type Udalost = { datum: string; text: string; ton: 'akcent' | 'pos' | 'warn' | 'neg' | 'neutral'; buduca?: boolean }

/**
 * Značky, ktoré pri odoslaní e-mailom zapisuje server do poznámky faktúry
 * (routes/mail.ts), napr. „[26.9.2026 odoslané na x@y.sk]". Staršie mali
 * dátum s medzerami podľa prehliadača („26. 9. 2026").
 */
const ZNACKA = /\[(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s+(upomienka\s+)?odoslan[éá] na ([^\]]+)\]/g

function zPoznamky(poznamka: string): Udalost[] {
  return [...poznamka.matchAll(ZNACKA)].map((m) => ({
    datum: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`,
    text: m[4] ? `Upomienka odoslaná na ${m[5].trim()}` : `Odoslaná e-mailom na ${m[5].trim()}`,
    ton: m[4] ? 'warn' : 'akcent',
  }))
}

/**
 * Časová os faktúry: vystavenie, odoslanie, upomienky, platby a splatnosť
 * v jednom zozname – na prvý pohľad je vidieť, čo sa s faktúrou dialo.
 */
export function CasovaOs({ f }: { f: Faktura }) {
  const dnes = dnesISO()
  const uhradena = f.stav_zobraz === 'zaplatena'
  const udalosti: Udalost[] = [
    { datum: f.datum_vystav, text: f.stav === 'koncept' ? 'Koncept (zatiaľ nevystavená)' : 'Vystavená', ton: 'akcent' },
    ...zPoznamky(f.poznamka ?? ''),
    ...(f.platby ?? []).map((p) => ({ datum: p.datum, text: `Platba ${skSuma(p.suma)}`, ton: 'pos' as const })),
    ...(f.kryte_zalohami ?? [])
      .filter((z) => z.prijate > 0.005 && z.datum_poslednej_platby)
      .map((z) => ({ datum: z.datum_poslednej_platby!, text: `Platba ${skSuma(z.prijate)} cez zálohovú faktúru ${z.cislo}`, ton: 'pos' as const })),
  ]
  if (uhradena && f.datum_poslednej_uhrady) {
    udalosti.push({ datum: f.datum_poslednej_uhrady, text: 'Uhradená celá', ton: 'pos' })
  } else if (f.stav !== 'koncept') {
    const po = Math.round((new Date(dnes + 'T12:00:00Z').getTime() - new Date(f.datum_splat + 'T12:00:00Z').getTime()) / 86400000)
    udalosti.push({
      datum: f.datum_splat,
      text: po > 0 ? `Splatnosť – ${pocet(po, ['deň', 'dni', 'dní'])} po splatnosti` : po === 0 ? 'Splatnosť – dnes' : 'Splatnosť',
      ton: po > 0 ? 'neg' : 'neutral',
      buduca: f.datum_splat > dnes,
    })
  }
  // Rovnaký deň: v poradí, v akom sa veci dejú (vystavenie pred odoslaním, platba pred úhradou).
  const zoradene = udalosti.map((u, i) => ({ u, i })).sort((a, b) => a.u.datum.localeCompare(b.u.datum) || a.i - b.i)

  return (
    <div className="panel">
      <h2>Časová os</h2>
      <ol className="casova-os">
        {zoradene.map(({ u }, i) => (
          <li key={i} className={`ton-${u.ton}${u.buduca ? ' buduca' : ''}`}>
            <span className="casova-os-bod" aria-hidden="true" />
            <span className="casova-os-datum">{skDatum(u.datum)}</span>
            <span className="casova-os-text">{u.text}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
