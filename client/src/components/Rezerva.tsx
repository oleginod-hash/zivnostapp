import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, skSuma, type Nastavenia } from '../api'
import { Karticka } from './Farby'
import { oznam, oznamChybu } from './Oznamenia'

type Rezerva = {
  rok: string; percento: number; prijate: number; odlozit: number
  zaplatene_dane: number; zaplatene_odvody: number; zostava: number
}

/**
 * Rezerva na dane a odvody za rok. Appka daň nepočíta – len pripomína percento,
 * ktoré si človek nastaví, a odráta, čo už na daniach a odvodoch zaplatil.
 */
export function RezervaNaDane({ rok }: { rok: string }) {
  const [r, setR] = useState<Rezerva | null>(null)
  const [percento, setPercento] = useState('')

  const nacitaj = () =>
    api
      .get<Rezerva>('/financie/rezerva?rok=' + rok)
      .then((x) => {
        setR(x)
        setPercento(x.percento ? String(x.percento).replace('.', ',') : '')
      })
      .catch(() => {})
  useEffect(() => {
    nacitaj()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rok])

  async function uloz() {
    try {
      const n = await api.put<Nastavenia>('/nastavenia', { rezerva_percento: percento || 0 })
      oznam(n.rezerva_percento ? `Odkladáš si ${String(n.rezerva_percento).replace('.', ',')} % z každej platby.` : 'Pripomínanie rezervy je vypnuté.')
      nacitaj()
    } catch (e: any) {
      oznamChybu(e.message)
    }
  }

  if (!r) return null
  const zaplatene = r.zaplatene_dane + r.zaplatene_odvody

  return (
    <div className="panel">
      <h2>Rezerva na dane a odvody</h2>
      {r.percento > 0 ? (
        <div className="karty kompaktne rezerva-karty" style={{ marginBottom: 14 }}>
          <Karticka
            ikona="zaloha"
            ton="akcent"
            popis={`Odložiť z príjmov ${r.rok}`}
            hodnota={skSuma(r.odlozit)}
            pod={`${String(r.percento).replace('.', ',')} % z ${skSuma(r.prijate)}`}
          />
          <Karticka
            ikona="zaplatena"
            ton="pos"
            popis="Už zaplatené dane a odvody"
            hodnota={skSuma(zaplatene)}
            pod={`daň ${skSuma(r.zaplatene_dane)} · odvody ${skSuma(r.zaplatene_odvody)}`}
          />
          <Karticka
            ikona="penazenka"
            ton={r.zostava < 0 ? 'warn' : 'neutral'}
            popis="Má zostať odložené"
            hodnota={skSuma(Math.max(r.zostava, 0))}
            pod={r.zostava < 0 ? `zaplatené o ${skSuma(-r.zostava)} viac, než bolo odložené` : 'na daňové priznanie a doplatky'}
          />
        </div>
      ) : (
        <p style={{ marginTop: 0 }}>
          Z každej prijatej platby patrí časť štátu – daň a odvody sa platia neskôr. Nastav si, koľko percent si
          odkladáš, a appka ti pri každej platbe povie, koľko odložiť.
        </p>
      )}
      <div className="rezerva-nastavenie">
        <label htmlFor="rezerva-percento">Odkladám si</label>
        <input
          id="rezerva-percento"
          inputMode="decimal"
          value={percento}
          placeholder="napr. 25"
          onChange={(e) => setPercento(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && uloz()}
        />
        <span>% z každej platby</span>
        <button onClick={uloz}>Uložiť</button>
      </div>
      <div className="napoveda">
        Orientačne 20 – 30 %. Presné číslo závisí od výdavkov a odvodov, preto si ho over u účtovníčky.
        Zaplatené dane a odvody appka berie z výdavkov v kategóriách Daň a Odvody (SP/ZP) –{' '}
        <Link to={'/vydavky?novy=1&kategoria=' + encodeURIComponent('Odvody (SP/ZP)')}>zapísať zaplatené odvody</Link>.
      </div>
    </div>
  )
}
