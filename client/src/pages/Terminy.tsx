import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { PolozkaTerminu, type Termin } from '../components/Terminy'
import { PrazdnyStav } from '../components/PrazdnyStav'

const MESIACE = ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August', 'September', 'Október', 'November', 'December']
const OBDOBIA = [
  { dni: 31, nazov: 'Mesiac' },
  { dni: 92, nazov: '3 mesiace' },
  { dni: 183, nazov: 'Pol roka' },
  { dni: 366, nazov: 'Rok' },
]

/** Kalendár termínov: splatnosti faktúr, zmluvy, turnusy a všeobecné termíny živnostníka. */
export function Terminy() {
  const [dni, setDni] = useState(92)
  const [terminy, setTerminy] = useState<Termin[] | null>(null)
  const [chyba, setChyba] = useState('')

  useEffect(() => {
    api
      .get<{ terminy: Termin[] }>('/terminy?dni=' + dni)
      .then((r) => setTerminy(r.terminy))
      .catch((e) => setChyba(e.message))
  }, [dni])

  // Zoskupenie po mesiacoch – kalendár sa tak číta ako diár.
  const poMesiacoch: { kluc: string; nazov: string; terminy: Termin[] }[] = []
  for (const t of terminy ?? []) {
    const kluc = t.datum.slice(0, 7)
    let skupina = poMesiacoch.find((s) => s.kluc === kluc)
    if (!skupina) {
      skupina = { kluc, nazov: `${MESIACE[Number(kluc.slice(5, 7)) - 1]} ${kluc.slice(0, 4)}`, terminy: [] }
      poMesiacoch.push(skupina)
    }
    skupina.terminy.push(t)
  }

  return (
    <>
      <div className="hlavicka">
        <h1>Termíny</h1>
        <div className="akcie">
          <div className="segment" role="group" aria-label="Obdobie">
            {OBDOBIA.map((o) => (
              <button key={o.dni} className={dni === o.dni ? 'aktivny' : ''} onClick={() => setDni(o.dni)}>
                {o.nazov}
              </button>
            ))}
          </div>
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}

      <div className="info-pruh">
        Splatnosti faktúr, koniec zmlúv a začiatok turnusov berie appka z tvojich záznamov. Odvody a daňové
        priznanie sú všeobecné termíny – závisia od tvojej situácie, preto si ich over u účtovníčky. Vypnúť sa dajú
        v <Link to="/nastavenia">Nastaveniach</Link>.
      </div>

      {!terminy ? (
        <div className="nacitava">Načítavam…</div>
      ) : terminy.length === 0 ? (
        <PrazdnyStav ikona="kalendar" ton="pos" nadpis="Žiadne termíny" text="V tomto období appka nepozná žiadny termín." />
      ) : (
        poMesiacoch.map((s) => (
          <div key={s.kluc} className="panel tesny">
            <div className="pozornost-hlavicka">
              <h2 className="nadpis-karty">{s.nazov}</h2>
            </div>
            <div className="terminy-zoznam">
              {s.terminy.map((t) => (
                <PolozkaTerminu key={t.druh + t.datum + t.cesta + t.nazov} t={t} />
              ))}
            </div>
          </div>
        ))
      )}
    </>
  )
}
