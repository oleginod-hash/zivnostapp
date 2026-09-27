import { useEffect, useState } from 'react'

/** Hranica telefónu – rovnaká ako v styles.css (@media (max-width: 820px)). */
const DOTAZ = '(max-width: 820px)'

/**
 * Úzke okno (telefón). Väčšinu rozloženia rieši CSS; tento háčik je pre miesta,
 * kde sa na telefóne ukazuje niečo iné – napr. zoznam faktúr v troch riadkoch
 * namiesto širokej tabuľky alebo položky faktúry, ktoré sa upravujú po jednej.
 */
export function useMaleOkno(): boolean {
  const [male, setMale] = useState(() => typeof window !== 'undefined' && window.matchMedia(DOTAZ).matches)
  useEffect(() => {
    const m = window.matchMedia(DOTAZ)
    const zmena = () => setMale(m.matches)
    zmena()
    m.addEventListener('change', zmena)
    return () => m.removeEventListener('change', zmena)
  }, [])
  return male
}
