import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ibanJePlatny, pocet, type Nastavenia as TNastavenia, type Sadzba } from '../api'
import { Ikona } from '../components/Ikony'
import { oznam, oznamChybu } from '../components/Oznamenia'
import { PristupZTelefonu } from '../components/PristupZTelefonu'
import { SADZBY_DPH } from '../../../server/lib/dph'
import { useNeulozeneZmeny } from '../neulozene'
import { CisloPole } from '../components/CisloPole'
import { useMaleOkno } from '../maleOkno'
import { MenuAkcii } from '../components/MenuAkcii'

/** Pár overených odtieňov – dosť výrazných na obrazovke, dosť tlmených na tlač. */
const FARBY_FAKTURY = [
  { farba: '#2f6fd6', nazov: 'Modrá' },
  { farba: '#0f766e', nazov: 'Petrolejová' },
  { farba: '#4f46e5', nazov: 'Indigová' },
  { farba: '#b45309', nazov: 'Jantárová' },
  { farba: '#374151', nazov: 'Grafitová' },
]

/**
 * Nastavenia sú rozdelené podľa toho, kedy ich človek potrebuje: najprv všetko,
 * čo sa tlačí na faktúru, potom zákazky v zahraničí a nakoniec zložené údaje
 * pre účtovníčku, ktoré netreba vyplniť hneď. Prvé spustenie rieši sprievodca.
 */
export function Nastavenia() {
  const male = useMaleOkno()
  /** Ukážka čísel, ktoré dostane ďalšia faktúra a zálohová faktúra podľa uložených vzorov. */
  const [dalsieCisla, setDalsieCisla] = useState<{ faktura: string; zaloha: string } | null>(null)
  function nacitajDalsieCisla() {
    Promise.all([
      api.get<{ cislo: string }>('/faktury/nova'),
      api.get<{ cislo: string }>('/faktury/nova?typ=zaloha'),
    ])
      .then(([f, z]) => setDalsieCisla({ faktura: f.cislo, zaloha: z.cislo }))
      .catch(() => {})
  }
  useEffect(nacitajDalsieCisla, [])
  const navigate = useNavigate()
  const [n, setN] = useState<TNastavenia | null>(null)
  const [sprava, setSprava] = useState('')
  const [chyba, setChyba] = useState('')

  const [sadzby, setSadzby] = useState<Sadzba[]>([])
  const [sadzbyNacitane, setSadzbyNacitane] = useState(false)
  const [stavZaloh, setStavZaloh] = useState<{ posledna: string | null; pocet: number; priecinok: string } | null>(null)
  // Logo sa ukladá hneď po výbere súboru, nie tlačidlom Uložiť – preto je mimo formulára.
  const [logo, setLogo] = useState('')
  const vstupLoga = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .get<TNastavenia>('/nastavenia')
      .then((x) => {
        setN(x)
        setLogo(x.logo ?? '')
      })
      .catch((e) => setChyba(e.message))
    api
      .get<Sadzba[]>('/stravne/sadzby')
      .then((s) => {
        setSadzby(s)
        setSadzbyNacitane(true)
      })
      .catch(() => {})
    api.get<typeof stavZaloh>('/zalohy/stav').then(setStavZaloh).catch(() => {})
  }, [])

  const oznacUlozene = useNeulozeneZmeny(n)
  const oznacUlozeneSadzby = useNeulozeneZmeny(sadzbyNacitane ? sadzby : null)

  if (!n) return <div className="nacitava">Načítavam…</div>

  const uprav = (z: Partial<TNastavenia>) => setN({ ...n, ...z })

  async function uloz() {
    setChyba('')
    setSprava('')
    try {
      const ulozene = await api.put<TNastavenia>('/nastavenia', n)
      setN(ulozene)
      oznacUlozene(ulozene)
      // Oznámenie dole – na telefóne je Uložiť dole a správa hore by nebola vidno.
      oznam('Nastavenia sú uložené.')
      nacitajDalsieCisla()
    } catch (e: any) {
      setChyba(e.message)
    }
  }

  const upravSadzbu = (i: number, z: Partial<Sadzba>) =>
    setSadzby(sadzby.map((s, j) => (j === i ? { ...s, ...z } : s)))

  async function ulozSadzby() {
    setChyba('')
    try {
      const ulozene = await api.put<Sadzba[]>('/stravne/sadzby', { sadzby })
      setSadzby(ulozene)
      oznacUlozeneSadzby(ulozene)
      setSprava('Sadzby stravného sú uložené.')
      setTimeout(() => setSprava(''), 3000)
    } catch (e: any) {
      setChyba(e.message)
    }
  }

  async function nahrajLogo(subor: File | undefined) {
    if (!subor) return
    try {
      const data = new FormData()
      data.append('logo', subor)
      setLogo((await api.upload<TNastavenia>('/nastavenia/logo', data)).logo)
      oznam('Logo je na faktúre.')
    } catch (e: any) {
      oznamChybu(e.message)
    } finally {
      if (vstupLoga.current) vstupLoga.current.value = ''
    }
  }

  async function odoberLogo() {
    const predtym = logo
    setLogo((await api.post<TNastavenia>('/nastavenia/logo/odobrat')).logo)
    oznam('Faktúra bude bez loga.', {
      text: 'Vrátiť späť',
      // Súbor loga po odobratí ostáva, stačí ho znova priradiť.
      sprav: async () => setLogo((await api.post<TNastavenia>('/nastavenia/logo/vratit', { logo: predtym })).logo),
    })
  }

  /** Značka zálohy má tvar RRRRMMDD. */
  function skDatumZoZnacky(z: string): string {
    return `${Number(z.slice(6, 8))}.${Number(z.slice(4, 6))}.${z.slice(0, 4)}`
  }

  const preUctovnicku = [n.predmety, n.datum_vzniku, n.zdravotna_poistovna]
  const vyplnenePreUctovnicku = preUctovnicku.filter((v) => String(v ?? '').trim()).length

  return (
    <>
      <div className="hlavicka">
        <h1>Nastavenia</h1>
        <div className="akcie">
          {male ? (
            <MenuAkcii
              popis="Ďalšie možnosti"
              akcie={[{ text: 'Sprievodca nastavením', ikona: 'nastavenia', sprav: () => navigate('/sprievodca') }]}
            />
          ) : (
            <>
              <Link className="tlacidlo" to="/sprievodca">
                Sprievodca nastavením
              </Link>
              <button className="primar" onClick={uloz}>
                Uložiť
              </button>
            </>
          )}
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}
      {sprava && <div className="uspech">{sprava}</div>}

      <div className="panel">
        <h2>Údaje na faktúre</h2>
        <p className="tlmene" style={{ fontSize: 14, marginTop: 0 }}>
          Tlačia sa na každú faktúru ako údaje dodávateľa.
        </p>
        <div className="mriezka">
          <div className="pole-siroke">
            <label>Meno a priezvisko alebo obchodné meno</label>
            <input value={n.meno} onChange={(e) => uprav({ meno: e.target.value })} />
          </div>
          <div>
            <label>IČO</label>
            <input value={n.ico} onChange={(e) => uprav({ ico: e.target.value })} />
          </div>
          <div>
            <label>DIČ</label>
            <input value={n.dic} onChange={(e) => uprav({ dic: e.target.value })} />
          </div>
          <div>
            <label>Ulica a číslo</label>
            <input value={n.adresa} onChange={(e) => uprav({ adresa: e.target.value })} />
          </div>
          <div>
            <label>PSČ a mesto</label>
            <input value={n.psc_mesto} onChange={(e) => uprav({ psc_mesto: e.target.value })} />
          </div>
          <div>
            <label>Krajina</label>
            <input value={n.krajina} onChange={(e) => uprav({ krajina: e.target.value })} />
          </div>
          <div>
            <label>E-mail</label>
            <input value={n.email} onChange={(e) => uprav({ email: e.target.value })} />
          </div>
          <div>
            <label>Telefón</label>
            <input value={n.telefon} onChange={(e) => uprav({ telefon: e.target.value })} />
          </div>
          <div>
            <label>Web</label>
            <input value={n.web ?? ''} placeholder="nepovinné" onChange={(e) => uprav({ web: e.target.value })} />
          </div>

          <div>
            <label>Okresný úrad (živnostenský register)</label>
            <input
              value={n.urad_zr ?? ''}
              placeholder="napr. Svidník"
              onChange={(e) => uprav({ urad_zr: e.target.value })}
            />
          </div>
          <div>
            <label>Číslo živnostenského registra</label>
            <input
              value={n.cislo_zr ?? ''}
              placeholder="napr. 770-12345"
              onChange={(e) => uprav({ cislo_zr: e.target.value })}
            />
          </div>
          <div className="pole-siroke">
            {n.urad_zr || n.cislo_zr ? (
              <div className="napoveda" style={{ marginTop: 0 }}>
                Na faktúre bude: <em>
                  Zapísaný v živnostenskom registri{n.urad_zr ? ` OÚ ${n.urad_zr}` : ''}
                  {n.cislo_zr ? `, č. ${n.cislo_zr}` : ''}.
                </em>{' '}
                Zápis v registri vyžaduje na faktúre Obchodný zákonník.
              </div>
            ) : n.zapis ? (
              <div className="napoveda" style={{ marginTop: 0 }}>
                Na faktúre je zatiaľ pôvodný text: <em>{n.zapis}</em>. Po vyplnení úradu a čísla ho nahradí.
              </div>
            ) : (
              <div className="napoveda" style={{ marginTop: 0 }}>
                Zápis v registri vyžaduje na faktúre Obchodný zákonník. Číslo nájdeš na živnostenskom liste
                alebo na <em>zrsr.sk</em> podľa IČO.
              </div>
            )}
          </div>

          <div>
            <label>DPH</label>
            <select
              value={n.dph_rezim ?? 'neplatitel'}
              onChange={(e) => uprav({ dph_rezim: e.target.value as TNastavenia['dph_rezim'] })}
            >
              <option value="neplatitel">Nie som platiteľ DPH</option>
              <option value="7a">Registrácia podľa § 7a (IČ DPH, ale nie platiteľ)</option>
              <option value="platitel">Som platiteľ DPH</option>
            </select>
          </div>
          {(n.dph_rezim !== 'neplatitel' || !!n.ic_dph) && (
            <div>
              <label>IČ DPH</label>
              <input
                value={n.ic_dph ?? ''}
                placeholder="napr. SK1234567890"
                onChange={(e) => uprav({ ic_dph: e.target.value })}
              />
            </div>
          )}
          {n.dph_rezim === 'platitel' && (
            <>
              <div>
                <label>Predvolená sadzba DPH</label>
                <select value={n.dph_sadzba ?? 23} onChange={(e) => uprav({ dph_sadzba: Number(e.target.value) })}>
                  {SADZBY_DPH.map((s) => (
                    <option key={s} value={s}>
                      {s} %{s === 23 ? ' (základná)' : s === 0 ? ' (oslobodené)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Zdaňovacie obdobie</label>
                <select
                  value={n.dph_obdobie ?? 'mesacne'}
                  onChange={(e) => uprav({ dph_obdobie: e.target.value as TNastavenia['dph_obdobie'] })}
                >
                  <option value="mesacne">Mesačne</option>
                  <option value="stvrtrocne">Štvrťročne</option>
                </select>
              </div>
            </>
          )}
          <div className="pole-siroke">
            <div className="napoveda" style={{ marginTop: 0 }}>
              {n.dph_rezim === 'platitel'
                ? 'Nové faktúry budú s DPH: ceny položiek sa zadávajú bez DPH, appka pripočíta daň podľa sadzby. Už vystavené faktúry sa neprepočítajú. Termíny priznania k DPH pribudnú v Termínoch.'
                : 'Registráciu podľa § 7a potrebuje napríklad ten, kto fakturuje služby firmám v inom štáte EÚ. Platiteľom DPH sa stáva živnostník s obratom nad 50 000 € za rok.'}{' '}
              Čo presne sa ťa týka, si over s účtovníčkou.
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Platby</h2>
        <div className="mriezka">
          <div className="pole-siroke">
            <label>IBAN</label>
            <input
              value={n.iban}
              placeholder="SK00 0000 0000 0000 0000 0000"
              onChange={(e) => uprav({ iban: e.target.value })}
            />
            <div className="napoveda">
              {n.iban.trim() && !ibanJePlatny(n.iban) ? (
                <span className="chybna">IBAN nevyzerá správne – skontroluj, či v ňom nechýba alebo nepribudla číslica.</span>
              ) : (
                'Z IBAN-u a sumy sa na faktúre vytvorí QR kód PAY by square.'
              )}
            </div>
          </div>
          <div>
            <label>SWIFT / BIC</label>
            <input value={n.swift} placeholder="nepovinné" onChange={(e) => uprav({ swift: e.target.value })} />
          </div>
          <div>
            <label>Banka</label>
            <input value={n.banka} placeholder="nepovinné" onChange={(e) => uprav({ banka: e.target.value })} />
          </div>
          <div>
            <label>Spôsob úhrady</label>
            <input
              list="sposoby-uhrady"
              value={n.sposob_uhrady ?? ''}
              onChange={(e) => uprav({ sposob_uhrady: e.target.value })}
            />
            <datalist id="sposoby-uhrady">
              <option value="Bankový prevod" />
              <option value="Hotovosť" />
              <option value="Platobná karta" />
            </datalist>
          </div>
          <div>
            <label>Rezerva na dane a odvody (%)</label>
            <CisloPole
              min={0}
              max={60}
              step={0.5}
              hodnota={n.rezerva_percento ?? 0}
              zmen={(n) => uprav({ rezerva_percento: n })}
            />
            <div className="napoveda">
              Koľko percent z každej prijatej platby si odkladáš. Appka ti to pri platbe pripomenie; 0 = nepripomínať.
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Faktúry</h2>
        <div className="mriezka">
          <div>
            <label>Vzor čísla faktúry</label>
            <input value={n.cislo_vzor} onChange={(e) => uprav({ cislo_vzor: e.target.value })} />
            <div className="napoveda">
              {'{RRRR}'} = rok, {'{RR}'} = rok dvojmiestne, {'{MM}'} = mesiac, {'{NNN}'} = poradie (počet N = počet
              miest). Napr. <code>{'{RRRR}{NNN}'}</code> dá 2026001.
              {dalsieCisla && <> Ďalšia faktúra dostane číslo <strong>{dalsieCisla.faktura}</strong>.</>}
            </div>
          </div>
          <div>
            <label htmlFor="cislo-vzor-zaloha">Vzor čísla zálohovej faktúry</label>
            <input
              id="cislo-vzor-zaloha"
              placeholder="rovnaký ako pri faktúrach"
              value={n.cislo_vzor_zaloha ?? ''}
              onChange={(e) => uprav({ cislo_vzor_zaloha: e.target.value })}
            />
            <div className="napoveda">
              Vlastný číselný rad zálohových faktúr, napr. <code>{'30{RR}{NNNN}'}</code> dá 30260001. Prázdne = zálohové
              faktúry pokračujú v rade faktúr.
              {dalsieCisla && n.cislo_vzor_zaloha?.trim() && (
                <> Ďalšia zálohová faktúra dostane číslo <strong>{dalsieCisla.zaloha}</strong>.</>
              )}
            </div>
          </div>
          <div>
            <div className="popis-s-prepinacom">
              <label>Predvolená splatnosť</label>
              <button
                type="button"
                className={'mini-prepinac' + (n.splatnost_pracovne ? ' zapnuty' : '')}
                aria-pressed={!!n.splatnost_pracovne}
                title="Počítať predvolenú splatnosť len v pracovných dňoch"
                onClick={() => uprav({ splatnost_pracovne: n.splatnost_pracovne ? 0 : 1 })}
              >
                <span className="mini-prepinac-draha" aria-hidden="true" />
                pracovné
              </button>
            </div>
            <CisloPole
              min={0}
              max={365}
              hodnota={n.splatnost_dni}
              zmen={(n) => uprav({ splatnost_dni: n })}
            />
            <div className="napoveda">
              {n.splatnost_pracovne
                ? 'Počet pracovných dní od vystavenia – bez víkendov a sviatkov.'
                : 'Počet kalendárnych dní od vystavenia.'}{' '}
              Pri konkrétnej faktúre sa to dá prepnúť.
            </div>
          </div>
          <div>
            <label>Farba faktúry</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="color"
                value={n.farba_faktury || '#2f6fd6'}
                style={{ width: 52, height: 36, padding: 3 }}
                onChange={(e) => uprav({ farba_faktury: e.target.value })}
              />
              {FARBY_FAKTURY.map((f) => (
                <button
                  key={f.farba}
                  title={f.nazov}
                  aria-label={f.nazov}
                  className="vzorka-farby"
                  style={{ background: f.farba, outline: n.farba_faktury === f.farba ? '2px solid var(--text)' : 'none' }}
                  onClick={() => uprav({ farba_faktury: f.farba })}
                />
              ))}
            </div>
            <div className="napoveda">Jemný akcent na nadpisoch, rámčeku platby a súčte.</div>
          </div>
          <div>
            <label>Logo na faktúre</label>
            <div className="logo-nastavenie">
              {logo ? (
                <img src={`/api/nastavenia/logo?v=${logo}`} alt="Logo na faktúre" />
              ) : (
                <span className="tlmene">bez loga</span>
              )}
              <input
                ref={vstupLoga}
                type="file"
                accept="image/png,image/jpeg"
                style={{ display: 'none' }}
                onChange={(e) => nahrajLogo(e.target.files?.[0])}
              />
              <button onClick={() => vstupLoga.current?.click()}>{logo ? 'Zmeniť' : 'Nahrať logo'}</button>
              {logo && (
                <button className="holy" onClick={odoberLogo}>
                  Odobrať
                </button>
              )}
            </div>
            <div className="napoveda">PNG alebo JPG do 2 MB, na faktúre bude vľavo hore.</div>
          </div>
          <div>
            <label>Vzhľad faktúry</label>
            <select
              value={n.pdf_vzhlad ?? 'klasicky'}
              onChange={(e) => uprav({ pdf_vzhlad: e.target.value as TNastavenia['pdf_vzhlad'] })}
            >
              <option value="klasicky">Klasický</option>
              <option value="usporny">Úsporný – na čiernobielu tlač</option>
              <option value="vyrazny">Výrazný – farebná hlavička</option>
            </select>
            <div className="napoveda">Ako faktúra vyzerá, uvidíš v ukážke nižšie (po uložení).</div>
          </div>
          <div className="pole-siroke">
            <label>Poznámka na každej faktúre</label>
            <input
              value={n.poznamka_pati}
              placeholder="nepovinné, napr. Ďakujem za spoluprácu."
              onChange={(e) => uprav({ poznamka_pati: e.target.value })}
            />
            <div className="napoveda">
              Údaj o DPH sa na faktúru doplní automaticky podľa nastavenia vyššie – sem ho písať netreba.
            </div>
          </div>
          <div className="pole-siroke">
            <a className="tlacidlo" href="/api/faktury/ukazka/pdf" target="_blank" rel="noreferrer">
              Ukážka faktúry s týmito údajmi
            </a>
            <div className="napoveda">Najprv ulož nastavenia, ukážka použije uložené údaje a tvoju poslednú faktúru.</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Zákazky v zahraničí</h2>
        <label className="zaskrtavacie" style={{ marginTop: 0 }}>
          <input
            type="checkbox"
            checked={!!n.praca_v_zahranici}
            onChange={(e) => uprav({ praca_v_zahranici: e.target.checked ? 1 : 0 })}
          />
          Pracujem na zákazkách v zahraničí (turnusy)
        </label>
        <div className="napoveda">
          Asistent potom počíta s turnusmi, stravným, dvojitým zdanením či formulárom A1. Inak odpovedá ako
          bežnému živnostníkovi na Slovensku.
        </div>

        {!!n.praca_v_zahranici && (
          <>
            <h3 className="podnadpis">Sadzby stravného</h3>
            <p className="tlmene" style={{ fontSize: 14, marginTop: 0 }}>
              Zadaj dennú sadzbu pre krajiny, kam chodievaš. Appka z nej pri turnuse vypočíta stravné a jedným
              kliknutím ho zapíše medzi výdavky. <strong>Sadzby treba udržiavať aktuálne</strong> – menia sa
              a appka ich nepredpisuje.
            </p>
            {sadzby.length === 0 ? (
              <p className="tlmene" style={{ fontSize: 14, margin: '0 0 4px' }}>
                Zatiaľ nie je zadaná žiadna krajina.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Krajina</th>
                    <th style={{ width: 150 }} className="cislo">Sadzba na deň (€)</th>
                    <th>Poznámka</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sadzby.map((sa, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          value={sa.krajina}
                          placeholder="napr. Nemecko"
                          onChange={(e) => upravSadzbu(i, { krajina: e.target.value })}
                        />
                      </td>
                      <td>
                        <CisloPole
                          step="0.01"
                          style={{ textAlign: 'right' }}
                          hodnota={sa.sadzba}
                          zmen={(n) => upravSadzbu(i, { sadzba: n })}
                        />
                      </td>
                      <td>
                        <input
                          value={sa.poznamka}
                          placeholder="nepovinné"
                          onChange={(e) => upravSadzbu(i, { poznamka: e.target.value })}
                        />
                      </td>
                      <td>
                        <button
                          className="ikonove maly holy"
                          title="Odstrániť krajinu"
                          aria-label="Odstrániť krajinu"
                          onClick={() => setSadzby(sadzby.filter((_, j) => j !== i))}
                        >
                          <Ikona nazov="zavriet" velkost={14} hrubka={2} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => setSadzby([...sadzby, { krajina: '', sadzba: 0, mena: 'EUR', poznamka: '' }])}>
                + Pridať krajinu
              </button>
              <button className="primar" onClick={ulozSadzby}>
                Uložiť sadzby
              </button>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Pripomienky termínov</h2>
        <label className="zaskrtavacie" style={{ marginTop: 0 }}>
          <input
            type="checkbox"
            checked={n.terminy_zakonne !== 0}
            onChange={(e) => uprav({ terminy_zakonne: e.target.checked ? 1 : 0 })}
          />
          Pripomínať odvody do poisťovní a daňové priznanie
        </label>
        <div className="napoveda">
          V Termínoch a na Prehľade sa zobrazia aj všeobecné termíny živnostníka. Splatnosti faktúr, koniec zmlúv
          a začiatok turnusov sa pripomínajú vždy.
        </div>
      </div>

      <PristupZTelefonu />

      <details className="panel skladaci">
        <summary>
          <h2>Pre účtovníčku</h2>
          <span className="skladaci-meta">
            môžeš doplniť neskôr · vyplnené {vyplnenePreUctovnicku} z {preUctovnicku.length}
          </span>
        </summary>
        <p className="tlmene" style={{ fontSize: 14, marginTop: 0 }}>
          Na faktúru sa netlačia. Hodia sa pri daňovom priznaní a asistent z nich vie, ako podnikáš.
        </p>
        <div className="mriezka">
          <div className="pole-siroke">
            <label>Predmety podnikania</label>
            <textarea
              rows={4}
              value={n.predmety ?? ''}
              placeholder={'jeden na riadok, presne ako na živnostenskom liste, napr.\nDokončovacie stavebné práce pri realizácii exteriérov a interiérov\nMontáž, oprava a údržba vyhradených technických zariadení elektrických'}
              onChange={(e) => uprav({ predmety: e.target.value })}
            />
            {!!n.predmety?.trim() && (
              <div className="napoveda">
                {pocet(n.predmety.split('\n').filter((r) => r.trim()).length, [
                  'predmet podnikania',
                  'predmety podnikania',
                  'predmetov podnikania',
                ])}
              </div>
            )}
          </div>
          <div>
            <label>Dátum vzniku živnosti</label>
            <input
              type="date"
              value={n.datum_vzniku ?? ''}
              onChange={(e) => uprav({ datum_vzniku: e.target.value })}
            />
          </div>
          <div>
            <label>Výdavky uplatňujem</label>
            <select
              value={n.vydavky_typ ?? 'pausalne'}
              onChange={(e) => uprav({ vydavky_typ: e.target.value as TNastavenia['vydavky_typ'] })}
            >
              <option value="pausalne">Paušálne</option>
              <option value="skutocne">Skutočné (podľa dokladov)</option>
            </select>
          </div>
          <div>
            <label>Zdravotná poisťovňa</label>
            <input
              list="poistovne"
              value={n.zdravotna_poistovna ?? ''}
              onChange={(e) => uprav({ zdravotna_poistovna: e.target.value })}
            />
            <datalist id="poistovne">
              <option value="Všeobecná zdravotná poisťovňa" />
              <option value="Dôvera" />
              <option value="Union" />
            </datalist>
          </div>
        </div>
      </details>

      <div className="panel">
        <h2>Zálohovanie</h2>
        {stavZaloh && (
          <p style={{ margin: 0 }}>
            Appka sa zálohuje sama raz denne, aj keď beží niekoľko dní bez reštartu.{' '}
            {stavZaloh.posledna ? (
              <>
                Naposledy <strong>{skDatumZoZnacky(stavZaloh.posledna)}</strong>, spolu{' '}
                {pocet(stavZaloh.pocet, ['záloha', 'zálohy', 'záloh'])}.
              </>
            ) : (
              'Zatiaľ žiadna automatická záloha.'
            )}
            <br />
            <span className="tlmene" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
              Zálohy sú v {stavZaloh.priecinok}. Automatické staršie než 30 dní sa mažú samy, ručné
              (Zaloha.bat) ostávajú. Občas si ich skopíruj mimo počítača.
            </span>
          </p>
        )}
      </div>

      {/* Na telefóne ostáva Uložiť stále po ruke – nastavenia sú dlhé. */}
      <div className="riadok-akcii lepkave-akcie">
        <button className="primar" onClick={uloz}>
          Uložiť nastavenia
        </button>
      </div>
    </>
  )
}
