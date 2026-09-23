import { useEffect, useRef, useState } from 'react'
import { potvrd } from './components/Oznamenia'

/**
 * Upozornenie na neuložené zmeny. Formulár ohlási, že sa v ňom niečo zmenilo,
 * a App pred odchodom z neho (klik na odkaz, zatvorenie okna) sa spýta.
 */
const neulozene = new Set<symbol>()

export const OTAZKA_ODCHODU = 'Máš neuložené zmeny. Naozaj odísť?'

export function suNeulozeneZmeny(): boolean {
  return neulozene.size > 0
}

/** Spýta sa, ak treba. Po potvrdení zabudne na zmeny – formulár sa aj tak opúšťa. */
export async function mozemOdist(): Promise<boolean> {
  if (!neulozene.size) return true
  const ano = await potvrd({
    nadpis: OTAZKA_ODCHODU,
    text: 'Čo si vo formulári napísal a neuložil, sa stratí.',
    potvrdit: 'Odísť bez uloženia',
    zrusit: 'Ostať tu',
    nebezpecne: true,
  })
  if (ano) neulozene.clear()
  return ano
}

/**
 * Sleduje, či sa formulár líši od stavu, v akom sa načítal alebo naposledy uložil.
 * `kluc` odlišuje záznamy – pri otvorení iného záznamu sa začína odznova.
 * Vráti funkciu, ktorou formulár po uložení povie „toto je nový uložený stav".
 */
export function useNeulozeneZmeny(stav: unknown, kluc: unknown = ''): (ulozeny?: unknown) => void {
  const znacka = useRef(Symbol('formular'))
  const povodny = useRef<{ kluc: unknown; json: string } | null>(null)
  const [, prekresli] = useState(0)

  const json = stav == null ? null : JSON.stringify(stav)
  if (json === null) povodny.current = null
  else if (!povodny.current || povodny.current.kluc !== kluc) povodny.current = { kluc, json }
  const zmenene = json !== null && povodny.current !== null && json !== povodny.current.json

  useEffect(() => {
    const z = znacka.current
    if (zmenene) neulozene.add(z)
    else neulozene.delete(z)
  }, [zmenene])

  useEffect(() => {
    const z = znacka.current
    return () => {
      neulozene.delete(z)
    }
  }, [])

  return (ulozeny = stav) => {
    povodny.current = ulozeny == null ? null : { kluc, json: JSON.stringify(ulozeny) }
    neulozene.delete(znacka.current)
    prekresli((n) => n + 1)
  }
}
