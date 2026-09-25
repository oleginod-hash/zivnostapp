import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, dniDo, pocet } from '../api'
import { Ikona, type KlucIkony } from './Ikony'

export type DruhTerminu = 'splatnost' | 'zmluva' | 'vypoved' | 'turnus' | 'odvody' | 'dan' | 'suhrnny_vykaz'
export type Termin = { datum: string; druh: DruhTerminu; nazov: string; popis: string; cesta: string }

const IKONY: Record<DruhTerminu, KlucIkony> = {
  splatnost: 'faktury',
  zmluva: 'zmluvy',
  vypoved: 'pozor',
  turnus: 'turnusy',
  odvody: 'penazenka',
  dan: 'podklad',
  suhrnny_vykaz: 'subor',
}

const MESIACE_SKRATKY = ['jan', 'feb', 'mar', 'apr', 'máj', 'jún', 'júl', 'aug', 'sep', 'okt', 'nov', 'dec']

export function kedy(datum: string): string {
  const d = dniDo(datum)
  if (d <= 0) return 'dnes'
  if (d === 1) return 'zajtra'
  return `o ${pocet(d, ['deň', 'dni', 'dní'])}`
}

/** Jeden termín – dátum v rámčeku, názov, kedy a čo treba urobiť. Termín do troch dní je zvýraznený. */
export function PolozkaTerminu({ t }: { t: Termin }) {
  const blizko = dniDo(t.datum) <= 3
  return (
    <Link to={t.cesta} className={'termin-polozka' + (blizko ? ' blizko' : '')}>
      <span className="termin-datum" aria-hidden="true">
        <strong>{Number(t.datum.slice(8, 10))}</strong>
        <span>{MESIACE_SKRATKY[Number(t.datum.slice(5, 7)) - 1]}</span>
      </span>
      <span className="termin-telo">
        <span className="termin-nazov">{t.nazov}</span>
        <span className="termin-popis">
          <strong>{kedy(t.datum)}</strong>
          {t.popis ? ` · ${t.popis}` : ''}
        </span>
      </span>
      <Ikona nazov={IKONY[t.druh]} velkost={16} className="termin-ikona" />
    </Link>
  )
}

/** Panel na Prehľade – čo ma čaká v najbližších 30 dňoch. */
export function NajblizsieTerminy() {
  const [terminy, setTerminy] = useState<Termin[] | null>(null)
  useEffect(() => {
    api
      .get<{ terminy: Termin[] }>('/terminy?dni=30')
      .then((r) => setTerminy(r.terminy))
      .catch(() => setTerminy([]))
  }, [])

  if (!terminy) return null
  return (
    <div className="panel tesny">
      <div className="pozornost-hlavicka">
        <h2 className="nadpis-karty">Najbližšie termíny</h2>
        <Link className="odkaz-karty" to="/terminy">
          Všetky →
        </Link>
      </div>
      {terminy.length === 0 ? (
        <div className="pozornost-polozka">
          <div className="pozornost-telo">
            <div className="pozornost-meta">V najbližších 30 dňoch nie je žiadny termín.</div>
          </div>
        </div>
      ) : (
        <div className="terminy-zoznam kompaktny">
          {terminy.slice(0, 5).map((t) => (
            <PolozkaTerminu key={t.druh + t.datum + t.cesta + t.nazov} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}
