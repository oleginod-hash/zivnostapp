import { useEffect, useState } from 'react'
import { api, pocet, type Nastavenia as TNastavenia, type Sadzba } from '../api'
import { Ikona } from '../components/Ikony'
import { useNeulozeneZmeny } from '../neulozene'

/** Pár overených odtieňov – dosť výrazných na obrazovke, dosť tlmených na tlač. */
const FARBY_FAKTURY = [
  { farba: '#2f6fd6', nazov: 'Modrá' },
  { farba: '#0f766e', nazov: 'Petrolejová' },
  { farba: '#4f46e5', nazov: 'Indigová' },
  { farba: '#b45309', nazov: 'Jantárová' },
  { farba: '#374151', nazov: 'Grafitová' },
]

export function Nastavenia() {
  const [n, setN] = useState<TNastavenia | null>(null)
  const [sprava, setSprava] = useState('')
  const [chyba, setChyba] = useState('')

  const [sadzby, setSadzby] = useState<Sadzba[]>([])
  const [sadzbyNacitane, setSadzbyNacitane] = useState(false)
  const [stavZaloh, setStavZaloh] = useState<{ posledna: string | null; pocet: number; priecinok: string } | null>(null)

  useEffect(() => {
    api.get<TNastavenia>('/nastavenia').then(setN).catch((e) => setChyba(e.message))
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
      setSprava('Nastavenia sú uložené.')
      setTimeout(() => setSprava(''), 3000)
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

  /** Značka zálohy má tvar RRRRMMDD. */
  function skDatumZoZnacky(z: string): string {
    return `${Number(z.slice(6, 8))}.${Number(z.slice(4, 6))}.${z.slice(0, 4)}`
  }

  return (
    <>
      <div className="hlavicka">
        <h1>Nastavenia</h1>
        <div className="akcie">
          <button className="primar" onClick={uloz}>
            Uložiť
          </button>
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}
      {sprava && <div className="uspech">{sprava}</div>}

      <div className="panel">
        <h2>Moje údaje (dodávateľ na faktúre)</h2>
        <div className="mriezka">
          <div className="pole-siroke">
            <label>Meno a priezvisko / obchodné meno</label>
            <input value={n.meno} onChange={(e) => uprav({ meno: e.target.value })} />
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
            <label>IČO</label>
            <input value={n.ico} onChange={(e) => uprav({ ico: e.target.value })} />
          </div>
          <div>
            <label>DIČ</label>
            <input value={n.dic} onChange={(e) => uprav({ dic: e.target.value })} />
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
        </div>
      </div>

      <div className="panel">
        <h2>O mojej živnosti</h2>
        <p className="tlmene" style={{ fontSize: 13.5, marginTop: 0 }}>
          Údaje zo živnostenského listu. Zápis v registri sa tlačí na faktúru — na obchodných listinách ho
          vyžaduje Obchodný zákonník. Ostatné sú pre teba, účtovníčku a AI asistentov.
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
          <div>
            <label>Dátum vzniku živnosti</label>
            <input
              type="date"
              value={n.datum_vzniku ?? ''}
              onChange={(e) => uprav({ datum_vzniku: e.target.value })}
            />
          </div>
          <div className="pole-siroke">
            {n.urad_zr || n.cislo_zr ? (
              <div className="napoveda" style={{ marginTop: 0 }}>
                Na faktúre bude: <em>
                  Zapísaný v živnostenskom registri{n.urad_zr ? ` OÚ ${n.urad_zr}` : ''}
                  {n.cislo_zr ? `, č. ${n.cislo_zr}` : ''}.
                </em>
              </div>
            ) : n.zapis ? (
              <div className="napoveda" style={{ marginTop: 0 }}>
                Na faktúre je zatiaľ pôvodný text: <em>{n.zapis}</em>. Po vyplnení úradu a čísla ho nahradí.
              </div>
            ) : (
              <div className="napoveda" style={{ marginTop: 0 }}>
                Číslo registra nájdeš na živnostenskom liste alebo na <em>zrsr.sk</em> podľa IČO.
              </div>
            )}
          </div>
          <div>
            <label>DPH</label>
            <select value={n.dph_rezim ?? 'neplatitel'} onChange={(e) => uprav({ dph_rezim: e.target.value as TNastavenia['dph_rezim'] })}>
              <option value="neplatitel">Nie som platiteľ DPH</option>
              <option value="7a">Registrovaný podľa § 7a (mám IČ DPH, nie som platiteľ)</option>
            </select>
          </div>
          <div>
            <label>IČ DPH</label>
            <input
              value={n.ic_dph ?? ''}
              placeholder={n.dph_rezim === '7a' ? 'SK1130717049' : 'len ak ho máš pridelené'}
              onChange={(e) => uprav({ ic_dph: e.target.value })}
            />
          </div>
          <div className="pole-siroke">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text)' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={!!n.praca_v_zahranici}
                onChange={(e) => uprav({ praca_v_zahranici: e.target.checked ? 1 : 0 })}
              />
              Pracujem na zákazkách v zahraničí (turnusy)
            </label>
            <div className="napoveda">
              AI asistenti potom rátajú s turnusmi, stravným, dvojitým zdanením či formulárom A1. Bez toho
              odpovedajú ako bežnému živnostníkovi na Slovensku.
            </div>
          </div>
          <div className="pole-siroke">
            <div className="napoveda" style={{ marginTop: 0 }}>
              Registráciu podľa § 7a potrebuje napríklad ten, kto fakturuje služby firmám v inom štáte EÚ.
              Či sa ťa to týka a čo presne má byť potom na faktúre, si over s účtovníčkou.
            </div>
          </div>
          <div>
            <label>Výdavky uplatňujem</label>
            <select value={n.vydavky_typ ?? 'pausalne'} onChange={(e) => uprav({ vydavky_typ: e.target.value as TNastavenia['vydavky_typ'] })}>
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
      </div>

      <div className="panel">
        <h2>Bankové spojenie</h2>
        <div className="mriezka">
          <div className="pole-siroke">
            <label>IBAN</label>
            <input
              value={n.iban}
              placeholder="SK00 0000 0000 0000 0000 0000"
              onChange={(e) => uprav({ iban: e.target.value })}
            />
            <div className="napoveda">Z IBAN-u a sumy sa na faktúre generuje QR kód PAY by square.</div>
          </div>
          <div>
            <label>SWIFT / BIC</label>
            <input value={n.swift} onChange={(e) => uprav({ swift: e.target.value })} />
          </div>
          <div>
            <label>Banka</label>
            <input value={n.banka} onChange={(e) => uprav({ banka: e.target.value })} />
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
            </div>
          </div>
          <div>
            <div className="popis-s-prepinacom">
              <label>Predvolená splatnosť</label>
              <button
                type="button"
                className={'mini-prepinac' + (n.splatnost_pracovne ? ' zapnuty' : '')}
                aria-pressed={!!n.splatnost_pracovne}
                title="Rátať predvolenú splatnosť len v pracovných dňoch"
                onClick={() => uprav({ splatnost_pracovne: n.splatnost_pracovne ? 0 : 1 })}
              >
                <span className="mini-prepinac-draha" aria-hidden="true" />
                pracovné
              </button>
            </div>
            <input
              type="number"
              min={0}
              max={365}
              value={n.splatnost_dni}
              onChange={(e) => uprav({ splatnost_dni: Number(e.target.value) })}
            />
            <div className="napoveda">
              {n.splatnost_pracovne
                ? 'Počet pracovných dní od vystavenia — bez víkendov a sviatkov.'
                : 'Počet kalendárnych dní od vystavenia.'}{' '}
              Pri konkrétnej faktúre sa to dá prepnúť.
            </div>
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
          <div className="pole-siroke">
            <label>Poznámka na každej faktúre</label>
            <input
              value={n.poznamka_pati}
              placeholder="nepovinné, napr. Ďakujem za spoluprácu."
              onChange={(e) => uprav({ poznamka_pati: e.target.value })}
            />
            <div className="napoveda">
              Status DPH sa na faktúru dopĺňa sám podľa údajov vyššie — sem ho už písať netreba.
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
        <h2>Sadzby stravného pri zahraničných turnusoch</h2>
        <p className="tlmene" style={{ fontSize: 13.5, marginTop: 0 }}>
          Zadaj sadzbu na deň pre krajiny, kam chodievaš. Appka z nej pri turnuse vypočíta stravné a na
          jedno kliknutie ho zapíše medzi výdavky. <strong>Sadzby si udržiavaš sám</strong> — menia sa
          a appka ti ich nepredpisuje.
        </p>
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
                  <input
                    type="number"
                    step="0.01"
                    style={{ textAlign: 'right' }}
                    value={sa.sadzba}
                    onChange={(e) => upravSadzbu(i, { sadzba: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    value={sa.poznamka}
                    placeholder="voliteľné"
                    onChange={(e) => upravSadzbu(i, { poznamka: e.target.value })}
                  />
                </td>
                <td>
                  <button className="ikonove maly holy" onClick={() => setSadzby(sadzby.filter((_, j) => j !== i))}>
                    <Ikona nazov="zavriet" velkost={14} hrubka={2} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => setSadzby([...sadzby, { krajina: '', sadzba: 0, mena: 'EUR', poznamka: '' }])}>
            + Pridať krajinu
          </button>
          <button className="primar" onClick={ulozSadzby}>
            Uložiť sadzby
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Zálohovanie</h2>
        {stavZaloh && (
          <p style={{ margin: 0 }}>
            Appka si robí zálohu sama raz denne pri spustení.{' '}
            {stavZaloh.posledna ? (
              <>
                Naposledy <strong>{skDatumZoZnacky(stavZaloh.posledna)}</strong>, celkom{' '}
                {stavZaloh.pocet} záloh.
              </>
            ) : (
              'Zatiaľ žiadna automatická záloha.'
            )}
            <br />
            <span className="tlmene" style={{ fontSize: 13 }}>
              Zálohy sú v {stavZaloh.priecinok}. Automatické staršie než 30 dní sa mažú samy, ručné
              (Zaloha.bat) ostávajú. Občas si ich skopíruj mimo počítača.
            </span>
          </p>
        )}
      </div>

      <div className="riadok-akcii">
        <button className="primar" onClick={uloz}>
          Uložiť nastavenia
        </button>
      </div>
    </>
  )
}
