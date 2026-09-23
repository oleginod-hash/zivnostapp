import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, skDatum, skSuma } from '../api'
import { mozemOdist } from '../neulozene'

type Typ = 'faktura' | 'zmluva' | 'firma' | 'turnus' | 'objednavka' | 'vydavok'

type Vysledok = {
  typ: Typ
  id: number
  nadpis: string
  popis: string
  cesta: string
  datum: string | null
  suma: number | null
}

const IKONY: Record<Typ, string> = {
  faktura: '🧾',
  zmluva: '📁',
  firma: '🏢',
  turnus: '✈️',
  objednavka: '📋',
  vydavok: '🧮',
}

const NAZVY: Record<Typ, string> = {
  faktura: 'Faktúra',
  zmluva: 'Zmluva',
  firma: 'Firma',
  turnus: 'Turnus',
  objednavka: 'Objednávka',
  vydavok: 'Výdavok',
}

/** Hľadá naprieč celou appkou – faktúry, zmluvy, firmy, turnusy, objednávky, výdavky. */
export function Hladanie() {
  const navigate = useNavigate()
  const [dopyt, setDopyt] = useState('')
  const [vysledky, setVysledky] = useState<Vysledok[]>([])
  const [otvorene, setOtvorene] = useState(false)
  const [zvyraznene, setZvyraznene] = useState(0)
  const obal = useRef<HTMLDivElement>(null)
  const pole = useRef<HTMLInputElement>(null)

  // Ctrl+K otvorí hľadanie odkiaľkoľvek, Esc ho zavrie.
  useEffect(() => {
    const klaves = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        pole.current?.focus()
        pole.current?.select()
      }
      if (e.key === 'Escape') setOtvorene(false)
    }
    window.addEventListener('keydown', klaves)
    return () => window.removeEventListener('keydown', klaves)
  }, [])

  // Klik mimo panelu ho zavrie.
  useEffect(() => {
    const klik = (e: MouseEvent) => {
      if (obal.current && !obal.current.contains(e.target as Node)) setOtvorene(false)
    }
    document.addEventListener('mousedown', klik)
    return () => document.removeEventListener('mousedown', klik)
  }, [])

  useEffect(() => {
    if (dopyt.trim().length < 2) {
      setVysledky([])
      return
    }
    const t = setTimeout(() => {
      api
        .get<Vysledok[]>('/hladat?q=' + encodeURIComponent(dopyt.trim()))
        .then((v) => {
          setVysledky(v)
          setZvyraznene(0)
          setOtvorene(true)
        })
        .catch(() => {})
    }, 200)
    return () => clearTimeout(t)
  }, [dopyt])

  async function otvor(v: Vysledok) {
    if (!(await mozemOdist())) return
    navigate(v.cesta)
    setOtvorene(false)
    setDopyt('')
    pole.current?.blur()
  }

  function klavesnica(e: React.KeyboardEvent) {
    if (!otvorene || !vysledky.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setZvyraznene((i) => (i + 1) % vysledky.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setZvyraznene((i) => (i - 1 + vysledky.length) % vysledky.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      otvor(vysledky[zvyraznene])
    }
  }

  return (
    <div className="hladanie-obal" ref={obal}>
      <input
        ref={pole}
        className="hladanie-pole"
        placeholder="Hľadať… (Ctrl+K)"
        value={dopyt}
        onChange={(e) => setDopyt(e.target.value)}
        onFocus={() => vysledky.length && setOtvorene(true)}
        onKeyDown={klavesnica}
      />

      {otvorene && dopyt.trim().length >= 2 && (
        <div className="hladanie-panel">
          {vysledky.length === 0 ? (
            <div className="hladanie-prazdne">Nič sa nenašlo.</div>
          ) : (
            vysledky.map((v, i) => (
              <button
                key={`${v.typ}-${v.id}`}
                className={'hladanie-polozka' + (i === zvyraznene ? ' zvyraznena' : '')}
                onMouseEnter={() => setZvyraznene(i)}
                onClick={() => otvor(v)}
              >
                <span className="hladanie-ikona">{IKONY[v.typ]}</span>
                <span className="hladanie-text">
                  <span className="hladanie-nadpis">{v.nadpis}</span>
                  <span className="hladanie-popis">
                    {NAZVY[v.typ]}
                    {v.popis && ` · ${v.popis}`}
                    {v.datum && ` · ${skDatum(v.datum)}`}
                  </span>
                </span>
                {v.suma !== null && <span className="hladanie-suma">{skSuma(v.suma)}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
