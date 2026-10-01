import { useEffect, type ReactNode } from 'react'

/** Okno nad stránkou – zavrie sa klávesom Escape alebo klikom vedľa. */
export function Okno({
  nadpis,
  children,
  zavriet,
  trieda = 'okno-udajov',
}: {
  nadpis: string
  children: ReactNode
  zavriet: () => void
  trieda?: string
}) {
  useEffect(() => {
    const klaves = (e: KeyboardEvent) => e.key === 'Escape' && zavriet()
    window.addEventListener('keydown', klaves)
    return () => window.removeEventListener('keydown', klaves)
  }, [zavriet])
  return (
    <div className="prekryv" onClick={(e) => e.target === e.currentTarget && zavriet()}>
      <div className={'dialog ' + trieda} role="dialog" aria-modal="true" aria-label={nadpis}>
        <h2>{nadpis}</h2>
        {children}
      </div>
    </div>
  )
}
