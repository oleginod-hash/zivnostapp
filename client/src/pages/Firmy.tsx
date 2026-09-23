import { useEffect, useState } from 'react'
import { api, pocet, vratZKosa, type Firma } from '../api'
import { Ikona } from '../components/Ikony'
import { Avatar } from '../components/Farby'
import { oznam, oznamChybu } from '../components/Oznamenia'
import { PrazdnyStav } from '../components/PrazdnyStav'
import { useNeulozeneZmeny } from '../neulozene'

const PRAZDNA: Omit<Firma, 'id' | 'archived'> = {
  nazov: '', kontaktna_osoba: '', adresa: '', psc_mesto: '', krajina: '', ico: '', dic: '', ic_dph: '',
  email: '', telefon: '', poznamka: '',
}

export function Firmy() {
  const [firmy, setFirmy] = useState<Firma[] | null>(null)
  const [uprava, setUprava] = useState<(typeof PRAZDNA & { id?: number }) | null>(null)
  const [chyba, setChyba] = useState('')
  const [zobrazArchiv, setZobrazArchiv] = useState(false)
  const [hlada, setHlada] = useState(false)
  const [sprava, setSprava] = useState('')
  const oznacUlozene = useNeulozeneZmeny(uprava, uprava?.id ?? 'nova')

  function nacitaj(archiv = zobrazArchiv) {
    api.get<Firma[]>('/firmy' + (archiv ? '?archivovane=1' : '')).then(setFirmy).catch((e) => setChyba(e.message))
  }

  useEffect(() => { nacitaj() }, [zobrazArchiv])

  /** Doplní údaje slovenskej firmy z verejného registra podľa IČO. */
  async function dotiahniZRegistra() {
    if (!uprava) return
    setChyba('')
    setHlada(true)
    try {
      const n = await api.get<Partial<Firma> & { poznamka?: string; chyba_v_registri?: string[] }>(
        '/register/ico/' + uprava.ico.replace(/\s/g, ''),
      )
      // Vyplníme len prázdne polia, nech neprepíšeme, čo si používateľ zadal sám.
      setUprava({
        ...uprava,
        nazov: uprava.nazov || n.nazov || '',
        adresa: uprava.adresa || n.adresa || '',
        psc_mesto: uprava.psc_mesto || n.psc_mesto || '',
        krajina: uprava.krajina || n.krajina || '',
        poznamka: uprava.poznamka || n.poznamka || '',
      })
      setSprava(
        n.chyba_v_registri?.length
          ? `Doplnené z registra. ${n.chyba_v_registri.join(', ')} register neposkytuje — doplň ich ručne.`
          : 'Doplnené z registra.',
      )
      setTimeout(() => setSprava(''), 8000)
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setHlada(false)
    }
  }

  async function uloz() {
    setChyba('')
    try {
      if (uprava!.id) await api.put('/firmy/' + uprava!.id, uprava)
      else await api.post('/firmy', uprava)
      oznacUlozene(null)
      setUprava(null)
      nacitaj()
    } catch (e: any) {
      setChyba(e.message)
    }
  }

  async function zmaz(f: Firma) {
    try {
      const r = await api.del<{ archivovana: boolean; pocetFaktur: number }>('/firmy/' + f.id)
      nacitaj()
      if (r.archivovana) {
        oznam(
          `Firma ${f.nazov} má ${pocet(r.pocetFaktur, ['faktúru', 'faktúry', 'faktúr'])}, preto je len archivovaná.`,
          {
            text: 'Vrátiť späť',
            sprav: async () => {
              await api.post(`/firmy/${f.id}/obnovit`)
              nacitaj()
            },
          },
        )
      } else {
        oznam(`Firma ${f.nazov} je v koši.`, {
          text: 'Vrátiť späť',
          sprav: async () => {
            await vratZKosa('companies', f.id)
            nacitaj()
          },
        })
      }
    } catch (e: any) {
      oznamChybu(e.message)
    }
  }

  return (
    <>
      <div className="hlavicka">
        <h1>Firmy</h1>
        <div className="akcie">
          <button onClick={() => setZobrazArchiv(!zobrazArchiv)}>
            {zobrazArchiv ? 'Skryť archivované' : 'Zobraziť aj archivované'}
          </button>
          <button className="primar" onClick={() => setUprava({ ...PRAZDNA })}>
            + Nová firma
          </button>
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}
      {sprava && <div className="uspech">{sprava}</div>}

      {uprava && (
        <div className="panel">
          <h2>{uprava.id ? 'Úprava firmy' : 'Nová firma'}</h2>
          <div className="mriezka">
            <div className="pole-siroke">
              <label>Názov firmy *</label>
              <input autoFocus value={uprava.nazov} onChange={(e) => setUprava({ ...uprava, nazov: e.target.value })} />
            </div>
            <div className="pole-siroke">
              <label>Kontaktná osoba</label>
              <input
                value={uprava.kontaktna_osoba ?? ''}
                placeholder="napr. Miloslav Červeň — objaví sa na faktúre pod názvom firmy"
                onChange={(e) => setUprava({ ...uprava, kontaktna_osoba: e.target.value })}
              />
            </div>
            <div>
              <label>Ulica a číslo</label>
              <input value={uprava.adresa} onChange={(e) => setUprava({ ...uprava, adresa: e.target.value })} />
            </div>
            <div>
              <label>PSČ a mesto</label>
              <input
                value={uprava.psc_mesto}
                placeholder="napr. 702 00 Ostrava"
                onChange={(e) => setUprava({ ...uprava, psc_mesto: e.target.value })}
              />
            </div>
            <div>
              <label>Krajina</label>
              <input value={uprava.krajina} onChange={(e) => setUprava({ ...uprava, krajina: e.target.value })} />
            </div>
            <div>
              <label>IČO / registračné číslo</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={uprava.ico} onChange={(e) => setUprava({ ...uprava, ico: e.target.value })} />
                <button
                  title="Doplniť údaje z registra podľa IČO"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={dotiahniZRegistra}
                  disabled={hlada || !/^\d{6,8}$/.test(uprava.ico.replace(/\s/g, ''))}
                >
                  {hlada ? '…' : 'Načítať'}
                </button>
              </div>
              <div className="napoveda">Pri slovenských firmách doplní názov a adresu z registra.</div>
            </div>
            <div>
              <label>DIČ</label>
              <input value={uprava.dic} onChange={(e) => setUprava({ ...uprava, dic: e.target.value })} />
            </div>
            <div>
              <label>IČ DPH / VAT ID</label>
              <input value={uprava.ic_dph} onChange={(e) => setUprava({ ...uprava, ic_dph: e.target.value })} />
            </div>
            <div>
              <label>E-mail</label>
              <input value={uprava.email} onChange={(e) => setUprava({ ...uprava, email: e.target.value })} />
            </div>
            <div>
              <label>Telefón</label>
              <input value={uprava.telefon} onChange={(e) => setUprava({ ...uprava, telefon: e.target.value })} />
            </div>
            <div className="pole-siroke">
              <label>Poznámka</label>
              <textarea value={uprava.poznamka} onChange={(e) => setUprava({ ...uprava, poznamka: e.target.value })} />
            </div>
          </div>
          <div className="riadok-akcii">
            <button onClick={() => setUprava(null)}>Zrušiť</button>
            <button className="primar" onClick={uloz} disabled={!uprava.nazov.trim()}>
              Uložiť
            </button>
          </div>
        </div>
      )}

      <div className="panel tesny">
        {!firmy ? (
          <div className="nacitava">Načítavam…</div>
        ) : firmy.length === 0 ? (
          <PrazdnyStav
            ikona="firmy"
            ton="akcent"
            nadpis="Zatiaľ žiadne firmy"
            text="Odberateľ na faktúre. Stačí zadať IČO a údaje sa doplnia z verejného registra."
            akcia={
              <button className="primar" onClick={() => setUprava({ ...PRAZDNA })}>
                + Pridať prvú firmu
              </button>
            }
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Názov</th>
                <th>Sídlo</th>
                <th>IČO</th>
                <th>Kontakt</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {firmy.map((f) => (
                <tr key={f.id} style={f.archived ? { opacity: 0.55 } : undefined}>
                  <td>
                    <span className="s-avatarom">
                      <Avatar nazov={f.nazov} />
                      <span className="s-avatarom-text">
                        <strong>{f.nazov}</strong>
                        {f.archived === 1 && <span className="stitok koncept" style={{ marginLeft: 8 }}>archivovaná</span>}
                        {f.kontaktna_osoba && <span className="tlmene">{f.kontaktna_osoba}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="tlmene">{[f.adresa, f.psc_mesto, f.krajina].filter(Boolean).join(', ') || '—'}</td>
                  <td className="tabularne">{f.ico || '—'}</td>
                  <td>
                    {f.email ? (
                      <a href={'mailto:' + f.email}>{f.email}</a>
                    ) : f.telefon ? (
                      <span className="tlmene">{f.telefon}</span>
                    ) : (
                      <span className="tlmene">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {f.archived === 1 ? (
                      <button className="maly" onClick={async () => { await api.post(`/firmy/${f.id}/obnovit`); nacitaj() }}>
                        Obnoviť
                      </button>
                    ) : (
                      <>
                        <button className="maly" onClick={() => setUprava({ ...f })}>
                          Upraviť
                        </button>{' '}
                        <button className="ikonove maly holy zmazat" title="Zmazať" onClick={() => zmaz(f)}>
                          <Ikona nazov="zmazat" velkost={15} />
                        </button>
                      </>
                    )}
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
