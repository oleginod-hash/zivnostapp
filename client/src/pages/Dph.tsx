import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, dnesISO, skDatum, skSuma, type Nastavenia } from '../api'
import { Karticka } from '../components/Farby'
import { PrazdnyStav } from '../components/PrazdnyStav'

type Riadok = {
  obdobie: string; nazov: string; zaklad: number; dph_vystup: number; dph_vstup: number; rozdiel: number
  prenos_zaklad: number; pocet_faktur: number; pocet_dokladov: number; termin: string
}
type Prehlad = {
  rok: string
  obdobie: 'mesacne' | 'stvrtrocne'
  riadky: Riadok[]
  spolu: { zaklad: number; dph_vystup: number; dph_vstup: number; rozdiel: number; prenos_zaklad: number }
}

/** Rozdiel DPH slovami – kladný sa platí, záporný je nadmerný odpočet (štát vracia). */
const rozdielTextom = (r: number) =>
  r > 0.005 ? `na úhradu ${skSuma(r)}` : r < -0.005 ? `nadmerný odpočet ${skSuma(-r)}` : 'nič'

/**
 * Prehľad DPH pre platiteľa: daň z vystavených faktúr, odpočet z dokladov
 * a rozdiel po zdaňovacích obdobiach. Podklad pre účtovníčku, nie priznanie.
 */
export function Dph() {
  const teraz = dnesISO().slice(0, 4)
  const [rok, setRok] = useState(teraz)
  const [p, setP] = useState<Prehlad | null>(null)
  const [platitel, setPlatitel] = useState<boolean | null>(null)
  const [chyba, setChyba] = useState('')

  useEffect(() => {
    api.get<Nastavenia>('/nastavenia').then((n) => setPlatitel(n.dph_rezim === 'platitel')).catch(() => {})
  }, [])
  useEffect(() => {
    api.get<Prehlad>('/financie/dph?rok=' + rok).then(setP).catch((e) => setChyba(e.message))
  }, [rok])

  const dnes = dnesISO()
  const roky = [0, 1, 2].map((i) => String(Number(teraz) - i))

  return (
    <>
      <div className="hlavicka">
        <h1>DPH</h1>
        <div className="akcie">
          <select aria-label="Rok" value={rok} onChange={(e) => setRok(e.target.value)} style={{ width: 'auto' }}>
            {roky.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}

      {platitel === false && (!p || p.spolu.dph_vystup === 0) ? (
        <div className="panel">
          <PrazdnyStav
            ikona="percento"
            ton="akcent"
            nadpis="DPH sa týka len platiteľa DPH"
            text="Ak si platiteľ DPH, zapni to v Nastaveniach – faktúry potom budú s DPH a tu uvidíš prehľad po mesiacoch."
            akcia={
              <Link className="tlacidlo" to="/nastavenia">
                Otvoriť Nastavenia
              </Link>
            }
          />
        </div>
      ) : !p ? (
        <div className="nacitava">Načítavam…</div>
      ) : (
        <>
          <div className="info-pruh">
            Podklad pre účtovníčku – daňové priznanie k DPH a kontrolný výkaz podáva ona. DPH na výstupe je
            z vystavených faktúr podľa dátumu dodania, odpočet z výdavkov so zapísanou DPH. Zálohové faktúry sa
            nerátajú.
          </div>

          <div className="karty kompaktne" style={{ marginBottom: 16 }}>
            <Karticka ikona="faktury" ton="akcent" popis={`DPH z faktúr ${p.rok}`} hodnota={skSuma(p.spolu.dph_vystup)} pod={`základ ${skSuma(p.spolu.zaklad)}`} />
            <Karticka ikona="vydavky" ton="pos" popis="Odpočet z výdavkov" hodnota={skSuma(p.spolu.dph_vstup)} />
            <Karticka
              ikona="percento"
              ton={p.spolu.rozdiel > 0 ? 'warn' : 'pos'}
              popis={p.spolu.rozdiel >= 0 ? 'Na úhradu spolu' : 'Nadmerný odpočet spolu'}
              hodnota={skSuma(Math.abs(p.spolu.rozdiel))}
            />
          </div>

          <div className="panel tesny">
            <table className="tabulka-dph">
              <thead>
                <tr>
                  <th>{p.obdobie === 'stvrtrocne' ? 'Štvrťrok' : 'Mesiac'}</th>
                  <th className="cislo">Základ</th>
                  <th className="cislo">DPH z faktúr</th>
                  <th className="cislo">Odpočet</th>
                  <th className="cislo">Výsledok</th>
                  <th>Termín</th>
                </tr>
              </thead>
              <tbody>
                {p.riadky.map((r) => {
                  const prazdny = !r.pocet_faktur && !r.pocet_dokladov
                  return (
                    <tr key={r.obdobie} className={prazdny ? 'tlmeny-riadok' : undefined}>
                      <td className="hlavna-bunka">
                        <strong>{r.nazov}</strong>
                        {r.prenos_zaklad > 0 && <span className="pod-textom">prenesenie: základ {skSuma(r.prenos_zaklad)}</span>}
                      </td>
                      <td className="cislo">{skSuma(r.zaklad)}</td>
                      <td className="cislo">{skSuma(r.dph_vystup)}</td>
                      <td className="cislo">{skSuma(r.dph_vstup)}</td>
                      <td className="cislo">
                        <strong>{prazdny ? '—' : rozdielTextom(r.rozdiel)}</strong>
                      </td>
                      <td className={r.termin < dnes ? 'tlmene' : undefined}>{skDatum(r.termin)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="napoveda">
            Odpočet DPH sa zapisuje pri výdavku (pole „DPH z dokladu"), pri e-faktúre sa doplní sám.
          </p>
        </>
      )}
    </>
  )
}
