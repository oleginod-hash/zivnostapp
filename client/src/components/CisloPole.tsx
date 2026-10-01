import { useEffect, useState, type InputHTMLAttributes } from 'react'

type Vlastnosti = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  hodnota: number | null | undefined
  zmen: (n: number) => void
  /**
   * Čo poslať ďalej, keď človek pole celé vymaže. `null` = nič – napr. splatnosť
   * ostane, ako bola, kým nenapíše nové číslo (po odchode z poľa sa ukáže znova).
   */
  prazdne?: number | null
}

const naText = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '' : String(n))

/**
 * Číselné pole, ktoré sa dá celé vymazať.
 *
 * Pole naviazané priamo na číslo po zmazaní poslednej číslice hneď ukáže „0"
 * (alebo staré číslo) a nové číslo sa nedá napísať bez mazania navyše. Tu si
 * pole drží text, ktorý človek práve píše, a číslo posiela ďalej, len keď dáva zmysel.
 */
export function CisloPole({ hodnota, zmen, prazdne = 0, onBlur, placeholder = '0', ...ine }: Vlastnosti) {
  const [text, setText] = useState(() => (hodnota === prazdne && hodnota === 0 ? '' : naText(hodnota)))

  // Zmena zvonka (prepočet kurzu, načítanie záznamu) prepíše text – no nie vtedy,
  // keď to, čo človek práve píše, znamená to isté číslo („1.50" je stále 1,5).
  useEffect(() => {
    setText((t) => {
      if (t.trim() === '') return hodnota == null || hodnota === prazdne ? t : naText(hodnota)
      return Number(t) === hodnota ? t : naText(hodnota)
    })
  }, [hodnota, prazdne])

  return (
    <input
      type="number"
      inputMode="decimal"
      // Prázdne pole s nápovedou „0" – nula v poli by sa musela pred písaním mazať.
      placeholder={placeholder}
      {...ine}
      value={text}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        if (t.trim() === '') {
          if (prazdne !== null) zmen(prazdne)
          return
        }
        const n = Number(t)
        if (Number.isFinite(n)) zmen(n)
      }}
      onBlur={(e) => {
        // Prázdne pole bez náhradnej hodnoty sa vráti k tomu, čo naozaj platí.
        if (text.trim() === '' && prazdne === null) setText(naText(hodnota))
        onBlur?.(e)
      }}
    />
  )
}
