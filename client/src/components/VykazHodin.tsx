import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, dnesISO, skDatum, skSuma, type Turnus } from '../api'
import { useNeulozeneZmeny } from '../neulozene'
import { Ikona } from './Ikony'
import { oznam, potvrd } from './Oznamenia'

type Den = { datum: string; hodiny: number; poznamka: string }
type Vykaz = {
  dni: Den[]
  sadzba: number
  sadzba_odkial: 'turnus' | 'objednavka' | 'predosly_turnus' | ''
  spolu_hodin: number
  suma: number
}

const DNI = ['ne', 'po', 'ut', 'st', 'št', 'pi', 'so']
const denTyzdna = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay()
const hodinTextom = (h: number) => new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 2 }).format(h) + ' h'

/** Ktoré dni hromadne vyplniť – na turnuse sa často robí aj v sobotu. */
const VYPLNIT = {
  'po-so': { text: 'pondelok – sobota', dni: [1, 2, 3, 4, 5, 6] },
  'po-pi': { text: 'pondelok – piatok', dni: [1, 2, 3, 4, 5] },
  vsetky: { text: 'každý deň', dni: [0, 1, 2, 3, 4, 5, 6] },
}

/**
 * Výkaz hodín na stránke turnusu. Hodiny po dňoch, hromadné vyplnenie
 * (potom sa opravia len výnimky), súčet so sadzbou, PDF na podpis
 * a faktúra za turnus jedným klikom.
 */
export function VykazHodin({ turnus }: { turnus: Turnus }) {
  const navigate = useNavigate()
  const [dni, setDni] = useState<Den[] | null>(null)
  const [sadzba, setSadzba] = useState(0)
  const [odkial, setOdkial] = useState<Vykaz['sadzba_odkial']>('')
  const [hromadne, setHromadne] = useState<{ hodiny: number; ktore: keyof typeof VYPLNIT }>({ hodiny: 10, ktore: 'po-so' })
  const [otvorene, setOtvorene] = useState(false)
  const [pracuje, setPracuje] = useState(false)
  const [chyba, setChyba] = useState('')
  const stav = dni ? { dni, sadzba } : null
  const oznacUlozene = useNeulozeneZmeny(stav, turnus.id)

  function prevezmi(v: Vykaz) {
    setDni(v.dni)
    setSadzba(v.sadzba)
    setOdkial(v.sadzba_odkial)
    return { dni: v.dni, sadzba: v.sadzba }
  }

  useEffect(() => {
    api
      .get<Vykaz>(`/turnusy/${turnus.id}/hodiny`)
      .then((v) => {
        oznacUlozene(prevezmi(v))
        // Otvorený, keď turnus beží alebo už má zapísané hodiny.
        setOtvorene(turnus.stav === 'prebieha' || v.spolu_hodin > 0)
      })
      .catch((e) => setChyba(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnus.id, turnus.datum_od, turnus.datum_do])

  if (!dni) return null

  const spolu = dni.reduce((s, d) => s + (Number(d.hodiny) || 0), 0)
  const suma = Math.round(spolu * sadzba * 100) / 100
  const upravDen = (i: number, z: Partial<Den>) => setDni(dni.map((d, j) => (j === i ? { ...d, ...z } : d)))

  function vyplnPrazdne() {
    const ktore = VYPLNIT[hromadne.ktore].dni
    setDni(dni!.map((d) => (!d.hodiny && ktore.includes(denTyzdna(d.datum)) ? { ...d, hodiny: hromadne.hodiny } : d)))
  }

  async function uloz(): Promise<boolean> {
    setChyba('')
    setPracuje(true)
    try {
      const v = await api.put<Vykaz>(`/turnusy/${turnus.id}/hodiny`, { dni, sadzba })
      oznacUlozene(prevezmi(v))
      return true
    } catch (e: any) {
      setChyba(e.message)
      return false
    } finally {
      setPracuje(false)
    }
  }

  async function vystavFakturu() {
    if (!spolu) return
    if (turnus.vyfakturovane > 0) {
      const ano = await potvrd({
        nadpis: 'K turnusu už je faktúra',
        text: `Vyfakturované je už ${skSuma(turnus.vyfakturovane)}. Vystaviť ďalšiu faktúru podľa výkazu?`,
        potvrdit: 'Vystaviť ďalšiu',
      })
      if (!ano) return
    }
    if (!(await uloz())) return
    setPracuje(true)
    try {
      const dnes = dnesISO()
      const { id } = await api.post<{ id: number }>('/faktury', {
        company_id: turnus.company_id,
        tour_id: turnus.id,
        stav: 'koncept',
        // Služba je dodaná posledným dňom turnusu.
        datum_dodania: turnus.datum_do < dnes ? turnus.datum_do : dnes,
        poznamka: 'Podľa výkazu odpracovaných hodín.',
        polozky: [
          {
            popis: `Práce – ${turnus.nazov} (${skDatum(turnus.datum_od)} – ${skDatum(turnus.datum_do)})`,
            mnozstvo: Math.round(spolu * 100) / 100,
            jednotka: 'hod',
            cena: sadzba,
          },
        ],
      })
      oznam('Koncept faktúry podľa výkazu je pripravený – skontroluj ho a vystav.')
      navigate('/faktury/' + id)
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setPracuje(false)
    }
  }

  return (
    <details className="panel skladaci vykaz-hodin" open={otvorene} onToggle={(e) => setOtvorene(e.currentTarget.open)}>
      <summary>
        <h2>Výkaz hodín</h2>
        <span className="skladaci-meta">
          {spolu ? `${hodinTextom(spolu)}${sadzba ? ` · ${skSuma(suma)}` : ''}` : 'zatiaľ bez hodín'}
        </span>
      </summary>
      {chyba && <div className="chyba">{chyba}</div>}

      <div className="vykaz-nastroje">
        <div>
          <label htmlFor="sadzba-turnusu">Hodinová sadzba (€/h)</label>
          <input
            id="sadzba-turnusu"
            type="number"
            min={0}
            step="0.5"
            value={sadzba || ''}
            placeholder="napr. 25"
            onChange={(e) => setSadzba(Number(e.target.value) || 0)}
          />
          {odkial === 'objednavka' && <div className="napoveda">Podľa objednávky k turnusu.</div>}
          {odkial === 'predosly_turnus' && <div className="napoveda">Ako pri predošlom turnuse u tejto firmy.</div>}
        </div>
        <div className="vykaz-hromadne">
          <label htmlFor="hromadne-hodiny">Vyplniť prázdne dni</label>
          <div className="vykaz-hromadne-riadok">
            <input
              id="hromadne-hodiny"
              type="number"
              min={0}
              max={24}
              step="0.5"
              value={hromadne.hodiny}
              onChange={(e) => setHromadne({ ...hromadne, hodiny: Number(e.target.value) || 0 })}
            />
            <span>h</span>
            <select
              aria-label="Ktoré dni"
              value={hromadne.ktore}
              onChange={(e) => setHromadne({ ...hromadne, ktore: e.target.value as keyof typeof VYPLNIT })}
            >
              {Object.entries(VYPLNIT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.text}
                </option>
              ))}
            </select>
            <button onClick={vyplnPrazdne}>Vyplniť</button>
          </div>
          <div className="napoveda">Potom oprav len dni, keď sa robilo inak.</div>
        </div>
      </div>

      <table className="tabulka-hodin">
        <thead>
          <tr>
            <th>Dátum</th>
            <th>Hodiny</th>
            <th>Poznámka</th>
          </tr>
        </thead>
        <tbody>
          {dni.map((d, i) => {
            const den = denTyzdna(d.datum)
            return (
              <tr key={d.datum} className={den === 0 || den === 6 ? 'vikend' : undefined}>
                <td className="vykaz-datum">
                  {skDatum(d.datum)} <span className="tlmene">{DNI[den]}</span>
                </td>
                <td>
                  <input
                    className="pole-hodin"
                    type="number"
                    min={0}
                    max={24}
                    step="0.5"
                    aria-label={`Hodiny ${skDatum(d.datum)}`}
                    value={d.hodiny || ''}
                    onChange={(e) => upravDen(i, { hodiny: Number(e.target.value) || 0 })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Poznámka ${skDatum(d.datum)}`}
                    value={d.poznamka}
                    placeholder={d.hodiny ? '' : 'napr. voľno, cesta'}
                    onChange={(e) => upravDen(i, { poznamka: e.target.value })}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="vykaz-sucet">
        Spolu <strong>{hodinTextom(spolu)}</strong>
        {sadzba > 0 && (
          <>
            {' '}× {skSuma(sadzba)} = <strong>{skSuma(suma)}</strong>
          </>
        )}
      </div>

      <div className="riadok-akcii">
        <a className="tlacidlo" href={`/api/turnusy/${turnus.id}/hodiny/pdf`} target="_blank" rel="noreferrer">
          <Ikona nazov="pdf" velkost={16} /> Výkaz v PDF
        </a>
        <button onClick={uloz} disabled={pracuje}>
          Uložiť výkaz
        </button>
        <button className="primar" onClick={vystavFakturu} disabled={pracuje || !spolu || !sadzba}>
          Vystaviť faktúru za turnus
        </button>
      </div>
      <div className="napoveda" style={{ textAlign: 'right' }}>
        {!sadzba && spolu > 0 ? 'Na faktúru doplň hodinovú sadzbu. ' : ''}PDF ukazuje uložený výkaz.
      </div>
    </details>
  )
}
