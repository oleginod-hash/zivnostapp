import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  api, skCislo, skDatum, skSuma,
  type Firma, type Objednavka, type StavObjednavky, type Turnus,
} from '../api'
import { StitokStavu, StitokZalohy } from '../components/StitokStavu'
import { useNeulozeneZmeny } from '../neulozene'

type Formular = {
  cislo: string; company_id: string; tour_id: string; datum: string
  popis: string; hodinovka: number; hodiny: number; suma: number
  stav: StavObjednavky; poznamka: string
}

const PRAZDNA: Formular = {
  cislo: '', company_id: '', tour_id: '', datum: '',
  popis: '', hodinovka: 0, hodiny: 0, suma: 0, stav: 'prijata', poznamka: '',
}

export function ObjednavkaEdit() {
  const { id } = useParams()
  const [hladane] = useSearchParams()
  const navigate = useNavigate()
  const novaObjednavka = !id

  const [form, setForm] = useState<Formular | null>(
    novaObjednavka ? { ...PRAZDNA, tour_id: hladane.get('turnus') ?? '' } : null,
  )
  const [objednavka, setObjednavka] = useState<Objednavka | null>(null)
  const [firmy, setFirmy] = useState<Firma[]>([])
  const [turnusy, setTurnusy] = useState<Turnus[]>([])
  const [chyba, setChyba] = useState('')
  const [sprava, setSprava] = useState('')
  const [uklada, setUklada] = useState(false)
  const oznacUlozene = useNeulozeneZmeny(form, id ?? 'nova')

  useEffect(() => {
    api.get<Firma[]>('/firmy').then(setFirmy).catch(() => {})
    api.get<Turnus[]>('/turnusy').then(setTurnusy).catch(() => {})

    if (id) {
      api
        .get<Objednavka>('/objednavky/' + id)
        .then((o) => {
          setObjednavka(o)
          const nacitany: Formular = {
            cislo: o.cislo,
            company_id: o.company_id ? String(o.company_id) : '',
            tour_id: o.tour_id ? String(o.tour_id) : '',
            datum: o.datum ?? '',
            popis: o.popis,
            hodinovka: o.hodinovka,
            hodiny: o.hodiny,
            suma: o.suma,
            stav: o.stav,
            poznamka: o.poznamka,
          }
          setForm(nacitany)
          oznacUlozene(nacitany)
        })
        .catch((e) => setChyba(e.message))
    }
  }, [id])

  if (chyba && !form) return <div className="chyba">{chyba}</div>
  if (!form) return <div className="nacitava">Načítavam…</div>

  const uprav = (z: Partial<Formular>) => setForm({ ...form, ...z })

  /** Pri výbere turnusu doplníme firmu, ak ju používateľ ešte nevybral. */
  function vyberTurnus(tourId: string) {
    const t = turnusy.find((x) => String(x.id) === tourId)
    uprav({
      tour_id: tourId,
      company_id: !form!.company_id && t?.company_id ? String(t.company_id) : form!.company_id,
    })
  }

  async function uloz() {
    setChyba('')
    setUklada(true)
    try {
      const telo = { ...form, company_id: form!.company_id || null, tour_id: form!.tour_id || null }
      if (novaObjednavka) {
        const { id: novyId } = await api.post<{ id: number }>('/objednavky', telo)
        oznacUlozene()
        navigate('/objednavky/' + novyId, { replace: true })
      } else {
        await api.put('/objednavky/' + id, telo)
        oznacUlozene()
        setSprava('Zmeny sú uložené.')
        setTimeout(() => setSprava(''), 3000)
      }
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setUklada(false)
    }
  }

  // Dohodnutá hodnota = sadzba × hodiny. Ak hodiny ešte nepoznáš, appka
  // nesleduje, koľko zostáva vyfakturovať – nemá to z čoho odrátať.
  const dohodnute =
    form.hodinovka > 0 && form.hodiny > 0
      ? Math.round(form.hodinovka * form.hodiny * 100) / 100
      : form.suma

  return (
    <>
      <div className="hlavicka">
        <h1>{novaObjednavka ? 'Nová objednávka' : `Objednávka ${form.cislo || ''}`.trim()}</h1>
        <div className="akcie">
          {!novaObjednavka && (
            <Link className="tlacidlo primar" to={`/faktury/nova?objednavka=${id}`}>
              Vystaviť faktúru
            </Link>
          )}
          <Link className="tlacidlo" to="/objednavky">
            Späť
          </Link>
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}
      {sprava && <div className="uspech">{sprava}</div>}

      <div className="panel">
        <h2>O objednávke</h2>
        <div className="mriezka">
          <div>
            <label>Číslo objednávky</label>
            <input
              autoFocus
              placeholder="číslo od firmy"
              value={form.cislo}
              onChange={(e) => uprav({ cislo: e.target.value })}
            />
          </div>
          <div>
            <label>Dátum objednávky</label>
            <input type="date" value={form.datum} onChange={(e) => uprav({ datum: e.target.value })} />
          </div>
          <div>
            <label>Turnus</label>
            <select value={form.tour_id} onChange={(e) => vyberTurnus(e.target.value)}>
              <option value="">— bez turnusu —</option>
              {turnusy.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nazov} ({skDatum(t.datum_od)} – {skDatum(t.datum_do)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Firma</label>
            <select value={form.company_id} onChange={(e) => uprav({ company_id: e.target.value })}>
              <option value="">— vyber firmu —</option>
              {firmy.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nazov}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Dohodnutá hodinová sadzba (€/h)</label>
            <input
              type="number"
              step="0.01"
              value={form.hodinovka}
              onChange={(e) => uprav({ hodinovka: Number(e.target.value) })}
            />
            <div className="napoveda">Predvyplní sa na faktúre ako cena za hodinu.</div>
          </div>
          <div>
            <label>Dohodnutý počet hodín</label>
            <input
              type="number"
              step="0.5"
              min={0}
              value={form.hodiny}
              onChange={(e) => uprav({ hodiny: Number(e.target.value) })}
            />
            <div className="napoveda">Ak rozsah ešte nepoznáš, nechaj 0.</div>
          </div>
          <div>
            <label>Alebo pevná suma (€)</label>
            <input
              type="number"
              step="0.01"
              value={form.suma}
              onChange={(e) => uprav({ suma: Number(e.target.value) })}
              disabled={form.hodinovka > 0 && form.hodiny > 0}
            />
            <div className="napoveda">
              {form.hodinovka > 0 && form.hodiny > 0
                ? 'Vypočíta sa z hodinovej sadzby.'
                : 'Pre zákazky s pevnou cenou, nie na hodiny.'}
            </div>
          </div>
          <div>
            <label>Stav</label>
            <select value={form.stav} onChange={(e) => uprav({ stav: e.target.value as StavObjednavky })}>
              <option value="prijata">Prijatá</option>
              <option value="potvrdena">Potvrdená</option>
              <option value="zrusena">Zrušená</option>
            </select>
            <div className="napoveda">„Vyfakturovaná" sa nastaví sama podľa faktúr.</div>
          </div>
          <div className="pole-siroke">
            <label>Popis práce</label>
            <input
              placeholder="napr. Montáž oceľovej konštrukcie, hala B"
              value={form.popis}
              onChange={(e) => uprav({ popis: e.target.value })}
            />
          </div>
          <div className="pole-siroke">
            <label>Poznámka</label>
            <textarea value={form.poznamka} onChange={(e) => uprav({ poznamka: e.target.value })} />
          </div>
        </div>
      </div>

      {!novaObjednavka && (
        <div className="panel tesny">
          <div style={{ padding: '14px 18px 0' }}>
            <h2 style={{ margin: 0 }}>Faktúry k objednávke</h2>
          </div>
          {!objednavka?.faktury?.length ? (
            <div className="prazdne">Zatiaľ žiadne faktúry.</div>
          ) : (
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Číslo</th>
                  <th>Vystavená</th>
                  <th className="cislo">Suma</th>
                  <th>Stav</th>
                </tr>
              </thead>
              <tbody>
                {objednavka.faktury.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Link to={'/faktury/' + f.id}>
                        <strong>{f.cislo}</strong>
                      </Link>
                      {f.typ === 'zaloha' && <> <StitokZalohy /></>}
                    </td>
                    <td>{skDatum(f.datum_vystav)}</td>
                    <td className="cislo">{skSuma(f.suma)}</td>
                    <td>
                      <StitokStavu stav={f.stav_zobraz} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="riadok-akcii">
        <Link className="tlacidlo" to="/objednavky">
          Späť na zoznam
        </Link>
        <button className="primar" onClick={uloz} disabled={uklada || (!form.cislo.trim() && !form.popis.trim())}>
          {uklada ? 'Ukladám…' : novaObjednavka ? 'Vytvoriť objednávku' : 'Uložiť zmeny'}
        </button>
      </div>
    </>
  )
}
