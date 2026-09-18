import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  api, dlzkaTurnusu, skDatum, skSuma, NAZVY_STAVOV_TURNUSU, STITOK_TURNUSU,
  type Firma, type Turnus,
} from '../api'
import { Ikona } from '../components/Ikony'
import { FirmaSAvatarom, Karticka } from '../components/Farby'
import { PrazdnyStav } from '../components/PrazdnyStav'

type SuhrnTurnusov = {
  prebiehaju: number; planovane: number; ukoncene: number; roky: string[]
  nevyfakturovane: { id: number; nazov: string; datum_do: string; firma_nazov: string | null; objednane: number; vyfakturovane: number }[]
}

export function Turnusy() {
  const navigate = useNavigate()
  const [turnusy, setTurnusy] = useState<Turnus[] | null>(null)
  const [firmy, setFirmy] = useState<Firma[]>([])
  const [suhrn, setSuhrn] = useState<SuhrnTurnusov | null>(null)
  const [chyba, setChyba] = useState('')
  const [f, setF] = useState({ stav: '', firma: '', rok: '', hladat: '' })

  function nacitaj() {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v)
    api.get<Turnus[]>('/turnusy?' + q).then(setTurnusy).catch((e) => setChyba(e.message))
    api.get<SuhrnTurnusov>('/turnusy/suhrn').then(setSuhrn).catch(() => {})
  }

  useEffect(() => {
    api.get<Firma[]>('/firmy').then(setFirmy).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(nacitaj, f.hladat ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f])

  async function zmaz(t: Turnus) {
    if (!confirm(`Zmazať turnus „${t.nazov}"?`)) return
    try {
      await api.del('/turnusy/' + t.id)
      nacitaj()
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <>
      <div className="hlavicka">
        <h1>Turnusy</h1>
        <div className="akcie">
          <Link className="tlacidlo primar" to="/turnusy/novy">
            + Nový turnus
          </Link>
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}

      {suhrn && (
        <div className="karty kompaktne">
          <Karticka ikona="turnusy" ton="pos" popis="Práve prebieha" hodnota={suhrn.prebiehaju} />
          <Karticka ikona="kalendar" ton="akcent" popis="Naplánované" hodnota={suhrn.planovane} />
          <Karticka ikona="zaplatena" ton="neutral" popis="Ukončené" hodnota={suhrn.ukoncene} />
        </div>
      )}

      {suhrn && suhrn.nevyfakturovane.length > 0 && (
        <div className="info-pruh">
          <strong>Ukončené turnusy, ktoré ešte nie sú celé vyfakturované:</strong>{' '}
          {suhrn.nevyfakturovane.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ', '}
              <Link to={'/turnusy/' + t.id}>{t.nazov}</Link>
            </span>
          ))}
        </div>
      )}

      <div className="filtre">
        <div className="hladanie">
          <label>Hľadať</label>
          <input
            placeholder="názov, krajina, miesto, firma…"
            value={f.hladat}
            onChange={(e) => setF({ ...f, hladat: e.target.value })}
          />
        </div>
        <div>
          <label>Stav</label>
          <select value={f.stav} onChange={(e) => setF({ ...f, stav: e.target.value })}>
            <option value="">Všetky</option>
            <option value="prebieha">Prebieha</option>
            <option value="planovany">Plánovaný</option>
            <option value="ukonceny">Ukončený</option>
            <option value="zruseny">Zrušený</option>
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
        <div>
          <label>Rok</label>
          <select value={f.rok} onChange={(e) => setF({ ...f, rok: e.target.value })}>
            <option value="">Všetky</option>
            {suhrn?.roky.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel tesny">
        {!turnusy ? (
          <div className="nacitava">Načítavam…</div>
        ) : turnusy.length === 0 ? (
          <PrazdnyStav
            ikona="turnusy"
            ton="akcent"
            nadpis="Zatiaľ žiadne turnusy"
            text="Turnus je obdobie práce u jednej firmy. Naviažeš naň objednávky, faktúry aj výdavky z cesty."
            akcia={
              <Link className="tlacidlo primar" to="/turnusy/novy">
                + Založiť prvý turnus
              </Link>
            }
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Turnus</th>
                <th>Firma</th>
                <th>Obdobie</th>
                <th className="cislo">Objednané</th>
                <th className="cislo">Vyfakturované</th>
                <th>Stav</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {turnusy.map((t) => (
                <tr
                  key={t.id}
                  style={{ cursor: 'pointer', opacity: t.stav === 'zruseny' ? 0.55 : 1 }}
                  onClick={() => navigate('/turnusy/' + t.id)}
                >
                  <td>
                    <strong>{t.nazov}</strong>
                    {(t.miesto || t.krajina) && (
                      <div className="tlmene" style={{ fontSize: 12.5 }}>
                        {[t.miesto, t.krajina].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </td>
                  <td>
                    <FirmaSAvatarom nazov={t.firma_nazov} />
                  </td>
                  <td>
                    {skDatum(t.datum_od)} – {skDatum(t.datum_do)}
                    <div className="tlmene" style={{ fontSize: 12.5 }}>
                      {dlzkaTurnusu(t.datum_od, t.datum_do)} dní
                    </div>
                  </td>
                  <td className="cislo">{t.objednane ? skSuma(t.objednane) : <span className="tlmene">—</span>}</td>
                  <td className="cislo">
                    {t.vyfakturovane ? skSuma(t.vyfakturovane) : <span className="tlmene">—</span>}
                    {t.objednane > 0 && t.vyfakturovane < t.objednane && (
                      <div style={{ fontSize: 12.5, color: 'var(--oranzova)', fontWeight: 600 }}>
                        chýba {skSuma(t.objednane - t.vyfakturovane)}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={'stitok ' + STITOK_TURNUSU[t.stav]}>{NAZVY_STAVOV_TURNUSU[t.stav]}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                    <button className="ikonove maly holy zmazat" title="Zmazať" onClick={() => zmaz(t)}>
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
