import type { ReactNode } from 'react'
import { Ikona, type KlucIkony } from './Ikony'
import type { Ton } from './Farby'

/**
 * Prázdny zoznam. Namiesto sivej vety ikona, jedna veta a prvý krok –
 * najmä pri prvom spustení, keď v appke ešte nič nie je.
 */
export function PrazdnyStav({
  ikona, ton = 'neutral', nadpis, text, akcia,
}: {
  ikona: KlucIkony
  ton?: Ton
  nadpis: string
  text?: ReactNode
  akcia?: ReactNode
}) {
  return (
    <div className="prazdny-stav">
      <span className={`prazdna-ikona ton-${ton}`}>
        <Ikona nazov={ikona} velkost={22} hrubka={1.7} />
      </span>
      <div className="prazdny-nadpis">{nadpis}</div>
      {text && <p className="prazdny-text">{text}</p>}
      {akcia && <div className="prazdna-akcia">{akcia}</div>}
    </div>
  )
}
