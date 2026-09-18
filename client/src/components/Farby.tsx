import type { ReactNode } from 'react'
import { Ikona, type KlucIkony } from './Ikony'

/**
 * Jemné farby naprieč appkou. Každý tón je svetlé pozadie + sýtejší text
 * (triedy .ton-* v styles.css), takže farba nekričí, len pomáha rozlíšiť.
 */
export type Ton = 'akcent' | 'pos' | 'warn' | 'neg' | 'fialova' | 'tyrkys' | 'neutral'

/** Tóny, z ktorých sa vyberá pre mená firiem – rovnaká firma má vždy rovnakú farbu. */
const TONY_MIEN: Ton[] = ['akcent', 'tyrkys', 'fialova', 'warn', 'pos']

export function tonPreText(text: string): Ton {
  let h = 0
  for (const znak of text) h = (h * 31 + znak.charCodeAt(0)) >>> 0
  return TONY_MIEN[h % TONY_MIEN.length]
}

/** Kategórie výdavkov majú pevné farby, aby sa dali spoznať na prvý pohľad. */
const TON_KATEGORIE: Record<string, Ton> = {
  Doprava: 'akcent',
  Ubytovanie: 'fialova',
  Materiál: 'warn',
  Náradie: 'warn',
  Stravné: 'pos',
  'Telefón a internet': 'tyrkys',
  Poistenie: 'tyrkys',
  'Odvody (SP/ZP)': 'neg',
  Ostatné: 'neutral',
  Nezaradené: 'neutral',
}

export function tonKategorie(kategoria: string): Ton {
  return TON_KATEGORIE[kategoria] ?? tonPreText(kategoria)
}

/** Slová, ktoré do iniciál nepatria – právna forma firmy. */
const PRAVNA_FORMA = new Set(['s', 'r', 'o', 'sro', 'as', 'a', 'spol', 'gmbh', 'kg', 'ag', 'ltd', 'inc', 'se', 'v', 'k'])

export function inicialy(nazov: string): string {
  const slova = nazov
    .split(/[\s,.\-–/&]+/)
    .filter((s) => /\p{L}/u.test(s) && !PRAVNA_FORMA.has(s.toLowerCase()))
  if (!slova.length) return '?'
  return slova
    .slice(0, 2)
    .map((s) => [...s][0].toLocaleUpperCase('sk'))
    .join('')
}

/** Farebný štvorček s iniciálami firmy. */
export function Avatar({ nazov, maly = false }: { nazov: string; maly?: boolean }) {
  return (
    <span className={`avatar ton-${tonPreText(nazov)}${maly ? ' maly' : ''}`} aria-hidden="true">
      {inicialy(nazov)}
    </span>
  )
}

/** Názov firmy s iniciálami – v tabuľkách všade rovnako. */
export function FirmaSAvatarom({ nazov, pod }: { nazov: string | null | undefined; pod?: ReactNode }) {
  if (!nazov) return <span className="tlmene">—</span>
  return (
    <span className="s-avatarom v-riadku">
      <Avatar nazov={nazov} maly />
      <span className="s-avatarom-text">
        {nazov}
        {pod}
      </span>
    </span>
  )
}

export function FarebnyCip({ ton, children }: { ton: Ton; children: ReactNode }) {
  return <span className={`farebny-cip ton-${ton}`}>{children}</span>
}

/** Menšia kartička s číslom: farebná ikona vľavo, popis a hodnota vedľa. */
export function Karticka({
  ikona, ton, popis, hodnota, pod, farebnaHodnota = false,
}: {
  ikona: KlucIkony
  ton: Ton
  popis: ReactNode
  hodnota: ReactNode
  pod?: ReactNode
  /** Hodnota vo farbe tónu – len keď farba niečo znamená (dlh, zaplatené). */
  farebnaHodnota?: boolean
}) {
  return (
    <div className={`karta karticka ton-${ton}${farebnaHodnota ? ' farebna-hodnota' : ''}`}>
      <span className="karta-ikona">
        <Ikona nazov={ikona} velkost={17} hrubka={2} />
      </span>
      <div className="karticka-text">
        <div className="popis">{popis}</div>
        <div className="hodnota">{hodnota}</div>
        {pod && <div className="tlmene">{pod}</div>}
      </div>
    </div>
  )
}
