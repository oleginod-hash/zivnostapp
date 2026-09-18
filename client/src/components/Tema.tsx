import { useEffect, useState } from 'react'
import { Ikona } from './Ikony'

export type Tema = 'svetly' | 'tmavy' | 'system'

const KLUC = 'zivnostapp-tema'

function systemovaTema(): 'svetly' | 'tmavy' {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'tmavy' : 'svetly'
}

function nastavNaDokument(t: Tema) {
  const skutocna = t === 'system' ? systemovaTema() : t
  document.documentElement.setAttribute('data-tema', skutocna)
}

/** Načíta uloženú tému hneď pri štarte, aby appka neblikla nesprávnou farbou. */
export function pouziUlozenuTemu() {
  const ulozena = (localStorage.getItem(KLUC) as Tema) || 'system'
  nastavNaDokument(ulozena)
}

export function PrepinacTemy() {
  const [tema, setTema] = useState<Tema>(() => (localStorage.getItem(KLUC) as Tema) || 'system')

  useEffect(() => {
    localStorage.setItem(KLUC, tema)
    nastavNaDokument(tema)

    // Pri voľbe „podľa systému" reagujeme aj na neskoršiu zmenu vo Windows.
    if (tema !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const zmena = () => nastavNaDokument('system')
    media.addEventListener('change', zmena)
    return () => media.removeEventListener('change', zmena)
  }, [tema])

  const volby: { kluc: Tema; popis: React.ReactNode; titulok: string }[] = [
    { kluc: 'svetly', popis: <Ikona nazov="slnko" velkost={14} hrubka={2} />, titulok: 'Svetlý režim' },
    { kluc: 'tmavy', popis: <Ikona nazov="mesiac" velkost={14} hrubka={2} />, titulok: 'Tmavý režim' },
    { kluc: 'system', popis: 'Auto', titulok: 'Podľa nastavenia Windows' },
  ]

  return (
    <div className="prepinac-temy">
      {volby.map((v) => (
        <button
          key={v.kluc}
          className={tema === v.kluc ? 'aktivna' : ''}
          title={v.titulok}
          aria-label={v.titulok}
          aria-pressed={tema === v.kluc}
          onClick={() => setTema(v.kluc)}
        >
          {v.popis}
        </button>
      ))}
    </div>
  )
}
