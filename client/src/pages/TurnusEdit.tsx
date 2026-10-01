import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api, dlzkaTurnusu, skDatum, skSuma, NAZVY_STAVOV_OBJEDNAVKY, STITOK_OBJEDNAVKY,
  type Firma, type StravneTurnus, type Turnus,
} from '../api'
import { StitokStavu, StitokZalohy } from '../components/StitokStavu'
import { useNeulozeneZmeny } from '../neulozene'
import { Karticka } from '../components/Farby'
import { VykazHodin } from '../components/VykazHodin'
import { FakturaVZozname } from '../components/FakturaKarta'
import { MenuAkcii } from '../components/MenuAkcii'
import { ObjednavkaKarta } from '../components/ObjednavkaKarta'
import { useMaleOkno } from '../maleOkno'
import { oznam } from '../components/Oznamenia'

type Formular = {
  nazov: string; company_id: string; krajina: string; miesto: string
  datum_od: string; datum_do: string; zruseny: boolean; poznamka: string
}

const PRAZDNY: Formular = {
  nazov: '', company_id: '', krajina: '', miesto: '',
  datum_od: '', datum_do: '', zruseny: false, poznamka: '',
}

export function TurnusEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const novyTurnus = !id

  const [form, setForm] = useState<Formular | null>(novyTurnus ? { ...PRAZDNY } : null)
  const [turnus, setTurnus] = useState<Turnus | null>(null)
  const [firmy, setFirmy] = useState<Firma[]>([])
  const [chyba, setChyba] = useState('')
  const [sprava, setSprava] = useState('')
  const [uklada, setUklada] = useState(false)
  const [stravne, setStravne] = useState<StravneTurnus | null>(null)
  const [zapisujeStravne, setZapisujeStravne] = useState(false)
  const oznacUlozene = useNeulozeneZmeny(form, id ?? 'novy')
  const male = useMaleOkno()

  function nacitajStravne() {
    if (!id) return
    api.get<StravneTurnus>('/stravne/turnus/' + id).then(setStravne).catch(() => {})
  }

  async function zapisStravne() {
    if (!stravne?.suma) return
    setZapisujeStravne(true)
    try {
      await api.post('/stravne/turnus/' + id + '/zapisat', { suma: stravne.suma })
      setSprava('Stravné je zapísané medzi výdavky.')
      setTimeout(() => setSprava(''), 4000)
      nacitajStravne()
      nacitaj()
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setZapisujeStravne(false)
    }
  }

  function nacitaj() {
    if (!id) return
    api
      .get<Turnus>('/turnusy/' + id)
      .then((t) => {
        setTurnus(t)
        const nacitany: Formular = {
          nazov: t.nazov,
          company_id: t.company_id ? String(t.company_id) : '',
          krajina: t.krajina,
          miesto: t.miesto,
          datum_od: t.datum_od,
          datum_do: t.datum_do,
          zruseny: t.zruseny === 1,
          poznamka: t.poznamka,
        }
        setForm(nacitany)
        oznacUlozene(nacitany)
      })
      .catch((e) => setChyba(e.message))
  }

  useEffect(() => {
    api.get<Firma[]>('/firmy').then(setFirmy).catch(() => {})
    nacitaj()
    nacitajStravne()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (chyba && !form) return <div className="chyba">{chyba}</div>
  if (!form) return <div className="nacitava">Načítavam…</div>

  const uprav = (z: Partial<Formular>) => setForm({ ...form, ...z })

  async function uloz() {
    setChyba('')
    setUklada(true)
    try {
      const telo = { ...form, company_id: form!.company_id || null }
      if (novyTurnus) {
        const { id: novyId } = await api.post<{ id: number }>('/turnusy', telo)
        oznacUlozene()
        navigate('/turnusy/' + novyId, { replace: true })
      } else {
        await api.put('/turnusy/' + id, telo)
        // Oznámenie dole – na telefóne je Uložiť dole a správa hore by nebola vidno.
        oznam('Zmeny sú uložené.')
        nacitaj()
      }
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setUklada(false)
    }
  }

  return (
    <>
      <div className="hlavicka">
        <h1>{novyTurnus ? 'Nový turnus' : form.nazov || 'Turnus'}</h1>
        <div className="akcie">
          {!novyTurnus && !male && (
            <>
              <Link className="tlacidlo" to={`/objednavky/nova?turnus=${id}`}>
                + Objednávka
              </Link>
              <Link className="tlacidlo" to={`/faktury/nova?turnus=${id}`}>
                + Faktúra
              </Link>
            </>
          )}
          <Link className="tlacidlo" to="/turnusy">
            Späť
          </Link>
          {!novyTurnus && male && (
            <MenuAkcii
              popis="Ďalšie akcie s turnusom"
              akcie={[
                { text: 'Vystaviť faktúru', ikona: 'faktury', sprav: () => navigate(`/faktury/nova?turnus=${id}`) },
                { text: 'Nová objednávka', ikona: 'objednavky', sprav: () => navigate(`/objednavky/nova?turnus=${id}`) },
              ]}
            />
          )}
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}
      {sprava && <div className="uspech">{sprava}</div>}

      {turnus && (
        <div className="karty kompaktne">
          <Karticka ikona="objednavky" ton="akcent" popis="Objednané" hodnota={skSuma(turnus.objednane)} />
          <Karticka ikona="faktury" ton="tyrkys" popis="Vyfakturované" hodnota={skSuma(turnus.vyfakturovane)} />
          <Karticka ikona="zaplatena" ton="pos" farebnaHodnota popis="Zaplatené" hodnota={skSuma(turnus.zaplatene)} />
          <Karticka ikona="kalendar" ton="neutral" popis="Dĺžka turnusu" hodnota={`${dlzkaTurnusu(turnus.datum_od, turnus.datum_do)} dní`} />
        </div>
      )}

      <div className="panel">
        <h2>O turnuse</h2>
        <div className="mriezka dvojice">
          <div className="pole-siroke">
            <label>Názov turnusu *</label>
            <input
              autoFocus={!male}
              placeholder="napr. Marec 2026 – München"
              value={form.nazov}
              onChange={(e) => uprav({ nazov: e.target.value })}
            />
          </div>
          <div className="pole-siroke">
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
            <label>Krajina</label>
            <input placeholder="napr. Nemecko" value={form.krajina} onChange={(e) => uprav({ krajina: e.target.value })} />
          </div>
          <div>
            <label>Miesto</label>
            <input placeholder="mesto alebo stavba" value={form.miesto} onChange={(e) => uprav({ miesto: e.target.value })} />
          </div>
          <div>
            <label>Od *</label>
            <input type="date" value={form.datum_od} onChange={(e) => uprav({ datum_od: e.target.value })} />
          </div>
          <div>
            <label>Do *</label>
            <input type="date" value={form.datum_do} onChange={(e) => uprav({ datum_do: e.target.value })} />
            {form.datum_od && form.datum_do && form.datum_do >= form.datum_od && (
              <div className="napoveda">Spolu {dlzkaTurnusu(form.datum_od, form.datum_do)} dní.</div>
            )}
          </div>
          <div className="pole-zaskrtavacie">
            <label className="zaskrtavacie">
              <input type="checkbox" checked={form.zruseny} onChange={(e) => uprav({ zruseny: e.target.checked })} />
              Turnus je zrušený
            </label>
          </div>
          <div className="pole-siroke">
            <label>Poznámka</label>
            <textarea
              value={form.poznamka}
              placeholder="ubytovanie, kontakt na stavbe, dohodnutá sadzba…"
              onChange={(e) => uprav({ poznamka: e.target.value })}
            />
          </div>
        </div>
        <div className="napoveda" style={{ marginTop: 10 }}>
          Stav turnusu (plánovaný / prebieha / ukončený) sa počíta z dátumov, nemusíš ho prepínať.
        </div>
        {/* Uložiť patrí k údajom turnusu – na telefóne ostáva po ruke, kým je tento panel na obrazovke. */}
        <div className="riadok-akcii lepkave-akcie">
          <Link className="tlacidlo" to="/turnusy">
            Zrušiť
          </Link>
          <button className="primar" onClick={uloz} disabled={uklada || !form.nazov.trim() || !form.datum_od || !form.datum_do}>
            {uklada ? 'Ukladám…' : novyTurnus ? 'Vytvoriť turnus' : 'Uložiť zmeny'}
          </button>
        </div>
      </div>

      {!novyTurnus && stravne && (
        <div className="panel">
          <h2>Stravné za tento turnus</h2>
          {!stravne.ma_sadzbu ? (
            <p className="tlmene" style={{ margin: 0 }}>
              Pre krajinu <strong>{stravne.turnus.krajina || '(neuvedená)'}</strong> nemáš zadanú sadzbu.
              Doplň ju v <Link to="/nastavenia">Nastaveniach</Link> a suma sa vypočíta sama.
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 22, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div>
                  <span className="tlmene">{stravne.dni} dní</span> ×{' '}
                  <span className="tlmene">{skSuma(stravne.sadzba!)}/deň</span> ={' '}
                  <strong style={{ fontSize: 20 }}>{skSuma(stravne.suma!)}</strong>
                </div>
                {stravne.uz_zapisane.length === 0 ? (
                  <button className="primar" onClick={zapisStravne} disabled={zapisujeStravne}>
                    {zapisujeStravne ? 'Zapisujem…' : 'Zapísať ako výdavok'}
                  </button>
                ) : (
                  <span className="stitok zaplatena">
                    už zapísané ({skSuma(stravne.uz_zapisane.reduce((a, x) => a + x.suma, 0))})
                  </span>
                )}
              </div>
              <div className="napoveda" style={{ marginTop: 10 }}>
                Sadzbu zadávaš a aktualizuješ v Nastaveniach – appka žiadne sadzby nepredpisuje.
                Či máš na stravné nárok a v akej výške, over si u účtovníčky.
              </div>
            </>
          )}
        </div>
      )}

      {!novyTurnus && turnus && <VykazHodin turnus={turnus} />}

      {novyTurnus ? (
        <div className="panel">
          <p className="tlmene" style={{ margin: 0 }}>
            Najprv turnus ulož – potom k nemu budeš môcť pridať objednávky a faktúry.
          </p>
        </div>
      ) : (
        <>
          <div className="panel tesny">
            <div className="hlavicka-karty">
              <h2 className="nadpis-karty">Objednávky</h2>
              <Link className="odkaz-karty" to={`/objednavky/nova?turnus=${id}`}>
                + Pridať objednávku
              </Link>
            </div>
            {!turnus?.objednavky?.length ? (
              <div className="prazdne">Na tento turnus zatiaľ nie je žiadna objednávka.</div>
            ) : male ? (
              <div className="zoznam-zaznamov">
                {turnus.objednavky.map((o) => (
                  <ObjednavkaKarta key={o.id} o={o} vTurnuse otvor={() => navigate('/objednavky/' + o.id)} />
                ))}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Objednávka</th>
                    <th>Dátum</th>
                    <th className="cislo">Sadzba</th>
                    <th className="cislo">Hodnota</th>
                    <th>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {turnus.objednavky.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link to={'/objednavky/' + o.id}>
                          <strong>{o.cislo || o.popis || 'bez čísla'}</strong>
                        </Link>
                        {o.cislo && o.popis && <div className="tlmene" style={{ fontSize: 13 }}>{o.popis}</div>}
                      </td>
                      <td>{skDatum(o.datum)}</td>
                      <td className="cislo">
                        {o.hodinovka ? `${skSuma(o.hodinovka)}/h` : <span className="tlmene">—</span>}
                      </td>
                      <td className="cislo">{o.suma ? skSuma(o.suma) : <span className="tlmene">—</span>}</td>
                      <td>
                        <span className={'stitok ' + STITOK_OBJEDNAVKY[o.stav_zobraz]}>
                          {NAZVY_STAVOV_OBJEDNAVKY[o.stav_zobraz]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel tesny">
            <div className="hlavicka-karty">
              <h2 className="nadpis-karty">Faktúry za tento turnus</h2>
              <Link className="odkaz-karty" to={`/faktury/nova?turnus=${id}`}>
                + Vystaviť faktúru
              </Link>
            </div>
            {!turnus?.faktury?.length ? (
              <div className="prazdne">K tomuto turnusu zatiaľ nie je žiadna faktúra.</div>
            ) : male ? (
              <div className="zoznam-zaznamov">
                {turnus.faktury.map((f) => (
                  <FakturaVZozname key={f.id} fa={f} otvor={() => navigate('/faktury/' + f.id)} />
                ))}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Číslo</th>
                    <th>Vystavená</th>
                    <th>Splatnosť</th>
                    <th className="cislo">Suma</th>
                    <th>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {turnus.faktury.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <Link to={'/faktury/' + f.id}>
                          <strong>{f.cislo}</strong>
                        </Link>
                        {f.typ === 'zaloha' && <> <StitokZalohy /></>}
                      </td>
                      <td>{skDatum(f.datum_vystav)}</td>
                      <td>{skDatum(f.datum_splat)}</td>
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
        </>
      )}
    </>
  )
}
