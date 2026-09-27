import { useEffect, useRef, useState } from 'react'
import { Ikona, type KlucIkony } from './Ikony'

export type AkciaMenu = {
  text: string
  ikona?: KlucIkony
  /** Odkaz (napr. PDF) – otvorí sa v novej karte. */
  href?: string
  sprav?: () => void
  /** Červený text – napr. presun do koša. */
  nebezpecne?: boolean
}

/**
 * Tlačidlo ⋮ s ponukou menej častých akcií. Na telefóne tak riadok zoznamu
 * či hlavička formulára nie sú preplnené tlačidlami. Zavrie sa klikom vedľa
 * alebo klávesom Escape.
 */
export function MenuAkcii({ akcie, popis = 'Ďalšie akcie' }: { akcie: AkciaMenu[]; popis?: string }) {
  const [otvorene, setOtvorene] = useState(false)
  const obal = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!otvorene) return
    const klik = (e: PointerEvent) => {
      if (!obal.current?.contains(e.target as Node)) setOtvorene(false)
    }
    const klaves = (e: KeyboardEvent) => e.key === 'Escape' && setOtvorene(false)
    document.addEventListener('pointerdown', klik)
    window.addEventListener('keydown', klaves)
    return () => {
      document.removeEventListener('pointerdown', klik)
      window.removeEventListener('keydown', klaves)
    }
  }, [otvorene])

  return (
    // Klik do ponuky nesmie otvoriť riadok, v ktorom ponuka je.
    <div className="menu-akcii" ref={obal} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="ikonove holy"
        aria-label={popis}
        title={popis}
        aria-haspopup="menu"
        aria-expanded={otvorene}
        onClick={() => setOtvorene(!otvorene)}
      >
        <Ikona nazov="viac" velkost={18} hrubka={2} />
      </button>
      {otvorene && (
        <div className="menu-akcii-zoznam" role="menu">
          {akcie.map((a) =>
            a.href ? (
              <a key={a.text} role="menuitem" href={a.href} target="_blank" rel="noreferrer" onClick={() => setOtvorene(false)}>
                {a.ikona && <Ikona nazov={a.ikona} velkost={16} />}
                {a.text}
              </a>
            ) : (
              <button
                key={a.text}
                type="button"
                role="menuitem"
                className={a.nebezpecne ? 'nebezpecne-text' : undefined}
                onClick={() => {
                  setOtvorene(false)
                  a.sprav?.()
                }}
              >
                {a.ikona && <Ikona nazov={a.ikona} velkost={16} />}
                {a.text}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
