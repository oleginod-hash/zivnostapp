import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  api, skCislo, skDatum, skSuma, NAZVY_STAVOV_OBJEDNAVKY, STITOK_OBJEDNAVKY,
  type Firma, type Objednavka, type Turnus,
} from '../api'
import { Ikona } from '../components/Ikony'
import { FirmaSAvatarom } from '../components/Farby'
import { PrazdnyStav } from '../components/PrazdnyStav'

export function Objednavky() {
  const navigate = useNavigate()
  const [objednavky, setObjednavky] = useState<Objednavka[] | null>(null)
  const [firmy, setFirmy] = useState<Firma[]>([])
  const [turnusy, setTurnusy] = useState<Turnus[]>([])
  const [chyba, setChyba] = useState('')
  const [f, setF] = useState({ stav: '', firma: '', turnus: '', hladat: '' })

  function nacitaj() {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v)
    api.get<Objednavka[]>('/objednavky?' + q).then(setObjednavky).catch((e) => setChyba(e.message))
  }

  useEffect(() => {
    api.get<Firma[]>('/firmy').then(setFirmy).catch(() => {})
    api.get<Turnus[]>('/turnusy').then(setTurnusy).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(nacitaj, f.hladat ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f])

  async function zmaz(o: Objednavka) {
    if (!confirm(`Zmazať objednávku „${o.cislo || o.popis}"?`)) return
    try {
      await api.del('/objednavky/' + o.id)
      nacitaj()
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <>
      <div className="hlavicka">
        <h1>Objednávky</h1>
        <div className="akcie">
          <Link className="tlacidlo primar" to="/objednavky/nova">
            + Nová objednávka
          </Link>
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}

      <div className="filtre">
        <div className="hladanie">
          <label>Hľadať</label>
          <input
            placeholder="číslo, popis, firma, turnus…"
            value={f.hladat}
            onChange={(e) => setF({ ...f, hladat: e.target.value })}
          />
        </div>
        <div>
          <label>Stav</label>
          <select value={f.stav} onChange={(e) => setF({ ...f, stav: e.target.value })}>
            <option value="">Všetky</option>
            <option value="nevyfakturovane">Ešte nevyfakturované</option>
            <option value="prijata">Prijatá</option>
            <option value="potvrdena">Potvrdená</option>
            <option value="zrusena">Zrušená</option>
          </select>
        </div>
        <div>
          <label>Turnus</label>
          <select value={f.turnus} onChange={(e) => setF({ ...f, turnus: e.target.value })}>
            <option value="">Všetky</option>
            {turnusy.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nazov}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Firma</label>
          <select value={f.firma} onChange={(e) => setF({ ...f, firma: e.target.value })}>
            <option value="">Všetky</option>
            {firmy.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nazov}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel tesny">
        {!objednavky ? (
          <div className="nacitava">Načítavam…</div>
        ) : objednavky.length === 0 ? (
          <PrazdnyStav
            ikona="objednavky"
            ton="akcent"
            nadpis="Zatiaľ žiadne objednávky"
            text="Objednávka drží dohodnutú sadzbu a hodiny. Z nej potom vystavíš faktúru na jeden klik."
            akcia={
              <Link className="tlacidlo primar" to="/objednavky/nova">
                + Pridať prvú objednávku
              </Link>
            }
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Objednávka</th>
                <th>Firma</th>
                <th>Turnus</th>
                <th>Dátum</th>
                <th className="cislo">Hodinovka</th>
                <th className="cislo">Hodnota</th>
                <th>Stav</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {objednavky.map((o) => (
                <tr
                  key={o.id}
                  style={{ cursor: 'pointer', opacity: o.stav === 'zrusena' ? 0.55 : 1 }}
                  onClick={() => navigate('/objednavky/' + o.id)}
                >
                  <td>
                    <strong>{o.cislo || o.popis || 'bez čísla'}</strong>
                    {o.cislo && o.popis && <div className="tlmene" style={{ fontSize: 12.5 }}>{o.popis}</div>}
                  </td>
                  <td>
                    <FirmaSAvatarom nazov={o.firma_nazov} />
                  </td>
                  <td>
                    {o.turnus_nazov ? (
                      <Link to={'/turnusy/' + o.tour_id} onClick={(e) => e.stopPropagation()}>
                        {o.turnus_nazov}
                      </Link>
                    ) : (
                      <span className="tlmene">—</span>
                    )}
                  </td>
                  <td>{skDatum(o.datum)}</td>
                  <td className="cislo">
                    {o.hodinovka ? `${skSuma(o.hodinovka)}/h` : <span className="tlmene">—</span>}
                  </td>
                  <td className="cislo">
                    {o.suma ? skSuma(o.suma) : <span className="tlmene">—</span>}
                    {o.hodiny > 0 && (
                      <div className="tlmene" style={{ fontSize: 12.5 }}>{skCislo(o.hodiny)} h</div>
                    )}
                  </td>
                  <td>
                    <span className={'stitok ' + STITOK_OBJEDNAVKY[o.stav_zobraz]}>
                      {NAZVY_STAVOV_OBJEDNAVKY[o.stav_zobraz]}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                    <button className="ikonove maly holy zmazat" title="Zmazať" onClick={() => zmaz(o)}>
                      <Ikona nazov="zmazat" velkost={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
