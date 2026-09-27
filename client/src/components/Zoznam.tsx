import { type ReactNode } from 'react'
import { Ikona } from './Ikony'
import { MenuAkcii, type AkciaMenu } from './MenuAkcii'

/**
 * Záznam v zozname na telefóne – karta v troch riadkoch (DESIGN.md):
 * 1) identifikátor drobne a ponuka ⋮, 2) hlavný text tučne, 3) stav vľavo a suma vpravo.
 * Ťuknutím sa záznam otvorí, menej časté akcie sú v ⋮.
 */
export function ZaznamRiadok({
  hore,
  hlavny,
  dole,
  suma,
  akcie,
  popisAkcii,
  otvor,
  className = '',
  tlmeny = false,
}: {
  hore: ReactNode
  hlavny: ReactNode
  dole?: ReactNode
  suma?: ReactNode
  akcie?: AkciaMenu[]
  popisAkcii?: string
  otvor: () => void
  className?: string
  /** Napr. zrušený turnus – ostáva v zozname, ale ustúpi. */
  tlmeny?: boolean
}) {
  return (
    <div
      className={`zaznam ${className}${tlmeny ? ' tlmeny' : ''}`}
      role="link"
      tabIndex={0}
      onClick={otvor}
      onKeyDown={(e) => e.key === 'Enter' && otvor()}
    >
      <div className="zaznam-hore">
        {hore}
        {!!akcie?.length && <MenuAkcii akcie={akcie} popis={popisAkcii} />}
      </div>
      <div className="zaznam-hlavny">{hlavny}</div>
      {(dole || suma) && (
        <div className="zaznam-dole">
          <span className="zaznam-stav">{dole}</span>
          {suma && <span className="zaznam-suma">{suma}</span>}
        </div>
      )}
    </div>
  )
}

/** Hľadanie a na telefóne vedľa neho tlačidlo Filter, pod ktorým sú ďalšie výbery. */
export function HladanieSFiltrom({
  id,
  hodnota,
  zmen,
  placeholder,
  male,
  aktivnych,
  otvorene,
  prepni,
}: {
  id: string
  hodnota: string
  zmen: (h: string) => void
  placeholder: string
  male: boolean
  aktivnych: number
  otvorene: boolean
  prepni: () => void
}) {
  return (
    <div className="hladanie">
      <label htmlFor={id}>Hľadať</label>
      <div className="hladanie-s-filtrom">
        <input id={id} placeholder={placeholder} value={hodnota} onChange={(e) => zmen(e.target.value)} />
        {male && (
          <button
            type="button"
            className={'tlacidlo-filtra' + (aktivnych ? ' aktivny' : '')}
            aria-expanded={otvorene}
            onClick={prepni}
          >
            <Ikona nazov="filter" velkost={16} />
            Filter{aktivnych ? ` (${aktivnych})` : ''}
          </button>
        )}
      </div>
    </div>
  )
}
