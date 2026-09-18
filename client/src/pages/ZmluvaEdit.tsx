import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api, skDatum, dniDo, velkostSuboru, KATEGORIE, NAZVY_OBNOV,
  type Firma, type Obnova, type Priloha, type StavZmluvy, type Zmluva,
} from '../api'
import { useNeulozeneZmeny } from '../neulozene'
import { Ikona } from '../components/Ikony'

type Formular = {
  nazov: string; company_id: string; kategoria: string; cislo_zmluvy: string
  datum_podpisu: string; platnost_od: string; platnost_do: string
  obnova: Obnova; vypoved_dni: number; pripomienka_dni: number
  stav: StavZmluvy; poznamka: string
}

const PRAZDNA: Formular = {
  nazov: '', company_id: '', kategoria: '', cislo_zmluvy: '',
  datum_podpisu: '', platnost_od: '', platnost_do: '',
  obnova: 'ziadna', vypoved_dni: 0, pripomienka_dni: 30,
  stav: 'aktivna', poznamka: '',
}

/**
 * Pri automatickej obnove je dôležitý dátum, dokedy sa dá zmluva vypovedať.
 * Ak už uplynul, zmluva sa obnoví sama a treba to povedať narovinu.
 */
function TerminVypovede({ platnostDo, vypovedDni }: { platnostDo: string; vypovedDni: number }) {
  const termin = new Date(new Date(platnostDo + 'T12:00:00').getTime() - vypovedDni * 86400000)
  const terminISO = `${termin.getFullYear()}-${String(termin.getMonth() + 1).padStart(2, '0')}-${String(termin.getDate()).padStart(2, '0')}`
  const dni = dniDo(terminISO)

  if (dni < 0) {
    return (
      <div className="chyba" style={{ marginTop: 14, marginBottom: 0 }}>
        Termín na výpoveď ({skDatum(terminISO)}) už uplynul — ak si zmluvu nevypovedal, automaticky sa obnoví.
      </div>
    )
  }
  return (
    <div className="info-pruh" style={{ marginTop: 14, marginBottom: 0 }}>
      Zmluva sa obnovuje automaticky. Ak ju nechceš predĺžiť, vypovedz ju najneskôr{' '}
      <strong>{skDatum(terminISO)}</strong> — {dni === 0 ? 'to je dnes' : `zostáva ${dni} dní`}.
    </div>
  )
}

export function ZmluvaEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const novaZmluva = !id

  const [form, setForm] = useState<Formular | null>(novaZmluva ? { ...PRAZDNA } : null)
  const [firmy, setFirmy] = useState<Firma[]>([])
  const [kategorie, setKategorie] = useState<string[]>(KATEGORIE)
  const [prilohy, setPrilohy] = useState<Priloha[]>([])
  const [chyba, setChyba] = useState('')
  const [sprava, setSprava] = useState('')
  const [uklada, setUklada] = useState(false)
  const [nahrava, setNahrava] = useState(false)
  const oznacUlozene = useNeulozeneZmeny(form, id ?? 'nova')
  const vstupSuborov = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get<Firma[]>('/firmy').then(setFirmy).catch(() => {})
    api
      .get<{ kategorie: string[] }>('/zmluvy/suhrn')
      .then((s) => setKategorie([...new Set([...KATEGORIE, ...s.kategorie])].sort((a, b) => a.localeCompare(b, 'sk'))))
      .catch(() => {})

    if (id) {
      api
        .get<Zmluva>('/zmluvy/' + id)
        .then((z) => {
          const nacitany: Formular = {
            nazov: z.nazov,
            company_id: z.company_id ? String(z.company_id) : '',
            kategoria: z.kategoria,
            cislo_zmluvy: z.cislo_zmluvy,
            datum_podpisu: z.datum_podpisu ?? '',
            platnost_od: z.platnost_od ?? '',
            platnost_do: z.platnost_do ?? '',
            obnova: z.obnova,
            vypoved_dni: z.vypoved_dni,
            pripomienka_dni: z.pripomienka_dni,
            stav: z.stav,
            poznamka: z.poznamka,
          }
          setForm(nacitany)
          oznacUlozene(nacitany)
          setPrilohy(z.prilohy ?? [])
        })
        .catch((e) => setChyba(e.message))
    }
  }, [id])

  if (chyba && !form) return <div className="chyba">{chyba}</div>
  if (!form) return <div className="nacitava">Načítavam…</div>

  const uprav = (z: Partial<Formular>) => setForm({ ...form, ...z })

  async function uloz() {
    setChyba('')
    setUklada(true)
    try {
      const telo = { ...form, company_id: form!.company_id || null }
      if (novaZmluva) {
        const { id: novyId } = await api.post<{ id: number }>('/zmluvy', telo)
        oznacUlozene()
        // Ostávame na detaile, nech sa dajú hneď nahrať prílohy.
        navigate('/zmluvy/' + novyId, { replace: true })
      } else {
        await api.put('/zmluvy/' + id, telo)
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

  async function nahrajSubory(subory: FileList | null) {
    if (!subory?.length || !id) return
    setChyba('')
    setNahrava(true)
    try {
      const data = new FormData()
      for (const s of Array.from(subory)) data.append('subory', s)
      const r = await api.upload<{ prilohy: Priloha[] }>(`/zmluvy/${id}/subory`, data)
      setPrilohy(r.prilohy)
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setNahrava(false)
      if (vstupSuborov.current) vstupSuborov.current.value = ''
    }
  }

  async function zmazPrilohu(p: Priloha) {
    if (!confirm(`Zmazať prílohu „${p.nazov}"?`)) return
    await api.del('/zmluvy/subory/' + p.id)
    setPrilohy(prilohy.filter((x) => x.id !== p.id))
  }

  return (
    <>
      <div className="hlavicka">
        <h1>{novaZmluva ? 'Nová zmluva' : form.nazov || 'Zmluva'}</h1>
        <div className="akcie">
          <Link className="tlacidlo" to="/zmluvy">
            Späť
          </Link>
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}
      {sprava && <div className="uspech">{sprava}</div>}

      <div className="panel">
        <h2>O zmluve</h2>
        <div className="mriezka">
          <div className="pole-siroke">
            <label>Názov zmluvy *</label>
            <input
              autoFocus
              placeholder="napr. Rámcová zmluva o dielo – Bau GmbH"
              value={form.nazov}
              onChange={(e) => uprav({ nazov: e.target.value })}
            />
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
            <label>Kategória</label>
            <input
              list="kategorie-zmluv"
              placeholder="vyber alebo napíš vlastnú"
              value={form.kategoria}
              onChange={(e) => uprav({ kategoria: e.target.value })}
            />
            <datalist id="kategorie-zmluv">
              {kategorie.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </div>
          <div>
            <label>Číslo zmluvy</label>
            <input value={form.cislo_zmluvy} onChange={(e) => uprav({ cislo_zmluvy: e.target.value })} />
          </div>
          <div>
            <label>Stav</label>
            <select value={form.stav} onChange={(e) => uprav({ stav: e.target.value as StavZmluvy })}>
              <option value="navrh">Návrh</option>
              <option value="aktivna">Aktívna</option>
              <option value="ukoncena">Ukončená</option>
            </select>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Platnosť a pripomienka</h2>
        <div className="mriezka">
          <div>
            <label>Dátum podpisu</label>
            <input type="date" value={form.datum_podpisu} onChange={(e) => uprav({ datum_podpisu: e.target.value })} />
          </div>
          <div>
            <label>Platnosť od</label>
            <input type="date" value={form.platnost_od} onChange={(e) => uprav({ platnost_od: e.target.value })} />
          </div>
          <div>
            <label>Platnosť do</label>
            <input type="date" value={form.platnost_do} onChange={(e) => uprav({ platnost_do: e.target.value })} />
            <div className="napoveda">Prázdne = zmluva na neurčito, appka nebude nič pripomínať.</div>
          </div>
          <div>
            <label>Obnova</label>
            <select value={form.obnova} onChange={(e) => uprav({ obnova: e.target.value as Obnova })}>
              {(Object.keys(NAZVY_OBNOV) as Obnova[]).map((o) => (
                <option key={o} value={o}>
                  {NAZVY_OBNOV[o]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Výpovedná lehota (dni)</label>
            <input
              type="number"
              min={0}
              value={form.vypoved_dni}
              onChange={(e) => uprav({ vypoved_dni: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>Upozorniť koľko dní vopred</label>
            <input
              type="number"
              min={0}
              max={365}
              value={form.pripomienka_dni}
              onChange={(e) => uprav({ pripomienka_dni: Number(e.target.value) })}
            />
            <div className="napoveda">Zmluva sa objaví medzi pripomienkami na Prehľade.</div>
          </div>
        </div>

        {form.obnova === 'automaticka' && form.platnost_do && form.vypoved_dni > 0 && (
          <TerminVypovede platnostDo={form.platnost_do} vypovedDni={form.vypoved_dni} />
        )}
      </div>

      <div className="panel">
        <h2>Prílohy</h2>
        {novaZmluva ? (
          <p className="tlmene" style={{ margin: 0 }}>
            Zmluvu najprv ulož — potom sem budeš vedieť pridať naskenované PDF a ďalšie súbory.
          </p>
        ) : (
          <>
            {prilohy.length === 0 ? (
              <p className="tlmene">Zatiaľ žiadne súbory.</p>
            ) : (
              <table style={{ marginBottom: 14 }}>
                <tbody>
                  {prilohy.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <a className="typ-s-ikonou" href={`/api/zmluvy/subory/${p.id}`} target="_blank" rel="noreferrer">
                          <Ikona nazov="subor" velkost={15} />
                          {p.nazov}
                        </a>
                      </td>
                      <td className="tlmene" style={{ width: 100 }}>
                        {velkostSuboru(p.velkost)}
                      </td>
                      <td className="tlmene" style={{ width: 120 }}>
                        {skDatum(p.created_at)}
                      </td>
                      <td style={{ width: 150, textAlign: 'right' }}>
                        <a className="tlacidlo maly" href={`/api/zmluvy/subory/${p.id}?stiahnut=1`}>
                          Stiahnuť
                        </a>{' '}
                        <button className="ikonove maly holy zmazat" title="Zmazať" onClick={() => zmazPrilohu(p)}>
                          <Ikona nazov="zmazat" velkost={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <input
              ref={vstupSuborov}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => nahrajSubory(e.target.files)}
            />
            <button onClick={() => vstupSuborov.current?.click()} disabled={nahrava}>
              {nahrava ? 'Nahrávam…' : '+ Pridať súbory'}
            </button>
            <div className="napoveda">PDF, obrázky alebo dokumenty, najviac 25 MB na súbor.</div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Poznámka</h2>
        <textarea
          value={form.poznamka}
          placeholder="dohodnuté sadzby, kontaktná osoba, na čo si dať pozor…"
          onChange={(e) => uprav({ poznamka: e.target.value })}
        />
      </div>

      <div className="riadok-akcii">
        <Link className="tlacidlo" to="/zmluvy">
          Späť na zoznam
        </Link>
        <button className="primar" onClick={uloz} disabled={uklada || !form.nazov.trim()}>
          {uklada ? 'Ukladám…' : novaZmluva ? 'Vytvoriť zmluvu' : 'Uložiť zmeny'}
        </button>
      </div>
    </>
  )
}
