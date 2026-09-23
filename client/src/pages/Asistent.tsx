import { useEffect, useRef, useState } from 'react'
import { api, pocet, skDatum } from '../api'
import { Ikona, type KlucIkony } from '../components/Ikony'
import type { Ton } from '../components/Farby'
import { potvrd } from '../components/Oznamenia'

type Asistent = 'pomocnik' | 'uctovnik' | 'pravnik'

type Konverzacia = { id: number; asistent: Asistent; nazov: string; updated_at: string; pocet_sprav: number }
type Akcia = { nazov: string; zapisuje: boolean }
type Sprava = { id?: number; rola: 'user' | 'assistant'; obsah: string; akcie?: Akcia[] }

/** Ľudský popis toho, čo pomocník práve robí. */
const POPIS_NASTROJA: Record<string, string> = {
  hladaj: 'Hľadám v appke',
  zoznam_faktur: 'Pozerám faktúry',
  detail_faktury: 'Otváram faktúru',
  zoznam_firiem: 'Pozerám firmy',
  zoznam_turnusov: 'Pozerám turnusy',
  detail_turnusu: 'Otváram turnus',
  zoznam_objednavok: 'Pozerám objednávky',
  zoznam_zmluv: 'Pozerám zmluvy',
  detail_zmluvy: 'Otváram zmluvu',
  zoznam_vydavkov: 'Pozerám výdavky',
  financie: 'Počítam financie',
  nastavenia: 'Pozerám nastavenia',
  vytvor_firmu: 'Zakladám firmu',
  uprav_firmu: 'Upravujem firmu',
  vytvor_turnus: 'Zakladám turnus',
  uprav_turnus: 'Upravujem turnus',
  vytvor_objednavku: 'Zakladám objednávku',
  uprav_objednavku: 'Upravujem objednávku',
  vytvor_fakturu: 'Vystavujem faktúru',
  uprav_fakturu: 'Upravujem faktúru',
  zmen_stav_faktury: 'Mením stav faktúry',
  vytvor_vydavok: 'Zapisujem výdavok',
  uprav_vydavok: 'Upravujem výdavok',
  vytvor_zmluvu: 'Zakladám zmluvu',
  uprav_zmluvu: 'Upravujem zmluvu',
  uprav_nastavenia: 'Upravujem nastavenia',
  priloz_fotku_k_vydavku: 'Prikladám doklad',
  co_som_zmenil: 'Pozerám, čo som menil',
  vrat_spat: 'Vraciam zmenu späť',
}
type StavAi = { dostupne: boolean; model: string }

type Priklad = { text: string; ikona: KlucIkony; ton: Ton }

/**
 * Príklady otázok sa riadia tým, čo má človek v Nastaveniach: kto nepracuje
 * na zahraničných turnusoch, nech nečíta o Nórsku a odvodoch v Nemecku.
 */
const PRIKLADY_ZAHRANICIE: Priklad[] = [
  { text: 'Koľko mi ešte nezaplatili a ktoré faktúry sú po splatnosti?', ikona: 'faktury', ton: 'neg' },
  { text: 'Idem na turnus do Nórska pre Bau GmbH od 5. 9. do 26. 9.', ikona: 'turnusy', ton: 'akcent' },
  { text: 'Aké odvody riešim na Slovensku, keď pracujem tri mesiace v Nemecku?', ikona: 'penazenka', ton: 'tyrkys' },
  { text: 'Firma mi nezaplatila faktúru tri mesiace po splatnosti. Ako postupovať?', ikona: 'upomienky', ton: 'warn' },
]

const PRIKLADY_DOMA: Priklad[] = [
  { text: 'Koľko mi ešte nezaplatili a ktoré faktúry sú po splatnosti?', ikona: 'faktury', ton: 'neg' },
  { text: 'Zapíš výdavok 180 € za naftu, dnes, kategória Doprava', ikona: 'vydavky', ton: 'akcent' },
  { text: 'Oplatia sa mi paušálne výdavky, alebo skutočné?', ikona: 'penazenka', ton: 'tyrkys' },
  { text: 'Firma mi nezaplatila faktúru tri mesiace po splatnosti. Ako postupovať?', ikona: 'upomienky', ton: 'warn' },
]

const NADPIS = 'Asistent'
const OTAZKA = 'S čím ti pomôžem?'
const UVOD =
  'Napíš, čo potrebuješ — vystaviť faktúru, založiť turnus, zapísať výdavok, alebo sa opýtať ' +
  'na dane, odvody a zmluvy. Vidí všetko, čo máš v appke.'
const POZNAMKA =
  'Zapisuje a upravuje záznamy, mazať nevie. Pri daniach a zmluvách radí všeobecne — ' +
  'pri vážnej veci sa obráť na účtovníčku alebo advokáta.'

/** Tučné kúsky **takto** vo vnútri riadku. */
function STucnym({ text }: { text: string }) {
  const casti = text.split(/\*\*(.+?)\*\*/g)
  return <>{casti.map((c, j) => (j % 2 === 1 ? <strong key={j}>{c}</strong> : c))}</>
}

/** Odpovede prichádzajú ako obyčajný text – nadpisy, odrážky a odstavce z neho poskladáme. */
function Odpoved({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((riadok, i) => {
        if (!riadok.trim()) return <div key={i} className="ai-medzera" />
        const nadpis = /^#{1,4}\s+(.*)$/.exec(riadok)
        if (nadpis) {
          return (
            <div key={i} className="ai-nadpis-odpovede">
              <STucnym text={nadpis[1].replace(/\*\*/g, '')} />
            </div>
          )
        }
        const odrazka = /^\s*[-*•]\s+(.*)$/.exec(riadok)
        if (odrazka) {
          return (
            <div key={i} className="ai-odrazka">
              <STucnym text={odrazka[1]} />
            </div>
          )
        }
        const cislo = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(riadok)
        if (cislo) {
          return (
            <div key={i} className="ai-odrazka cislovana">
              <span className="ai-cislo">{cislo[1]}.</span>
              <STucnym text={cislo[2]} />
            </div>
          )
        }
        return (
          <div key={i}>
            <STucnym text={riadok} />
          </div>
        )
      })}
    </>
  )
}

function Premysla() {
  return (
    <span className="ai-pise" aria-label="Premýšľam">
      <i />
      <i />
      <i />
    </span>
  )
}

export function AsistentStranka() {
  // Nové konverzácie sa ukladajú pod pôvodným kľúčom, aby staré ostali čitateľné.
  const asistent: Asistent = 'pomocnik'
  const [stav, setStav] = useState<StavAi | null>(null)
  const [konverzacie, setKonverzacie] = useState<Konverzacia[]>([])
  const [aktivna, setAktivna] = useState<number | null>(null)
  const [spravy, setSpravy] = useState<Sprava[]>([])
  const [vstup, setVstup] = useState('')
  const [generuje, setGeneruje] = useState(false)
  const [fotky, setFotky] = useState<{ id: number; nazov: string }[]>([])
  const [nahravaFotky, setNahravaFotky] = useState(false)
  const vstupFotiek = useRef<HTMLInputElement>(null)
  const pole = useRef<HTMLTextAreaElement>(null)
  const [chyba, setChyba] = useState('')
  const koniec = useRef<HTMLDivElement>(null)
  const [zahranicie, setZahranicie] = useState(false)
  const priklady = zahranicie ? PRIKLADY_ZAHRANICIE : PRIKLADY_DOMA

  useEffect(() => {
    api.get<StavAi>('/ai/stav').then(setStav).catch(() => {})
    api
      .get<{ praca_v_zahranici: number }>('/nastavenia')
      .then((n) => setZahranicie(!!n.praca_v_zahranici))
      .catch(() => {})
  }, [])

  function nacitajKonverzacie() {
    api.get<Konverzacia[]>('/ai/konverzacie').then(setKonverzacie).catch(() => {})
  }

  useEffect(() => {
    nacitajKonverzacie()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    koniec.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [spravy])

  // Pole na písanie rastie s textom (do rozumnej výšky), namiesto posuvníka v troch riadkoch.
  useEffect(() => {
    const el = pole.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }, [vstup])

  async function otvor(id: number) {
    setChyba('')
    const k = await api.get<{ spravy: Sprava[] }>('/ai/konverzacie/' + id)
    setAktivna(id)
    setSpravy(k.spravy)
  }

  async function zmazKonverzaciu(k: Konverzacia) {
    const ano = await potvrd({
      nadpis: `Zmazať konverzáciu „${k.nazov}"?`,
      text: 'Celá sa odstráni a vrátiť sa nedá.',
      potvrdit: 'Zmazať',
      nebezpecne: true,
    })
    if (!ano) return
    await api.del('/ai/konverzacie/' + k.id)
    if (aktivna === k.id) {
      setAktivna(null)
      setSpravy([])
    }
    nacitajKonverzacie()
  }

  async function posli(textNaOdoslanie?: string) {
    const text = (textNaOdoslanie ?? vstup).trim()
    if (!text || generuje) return
    setChyba('')
    setVstup('')
    setGeneruje(true)

    try {
      let id = aktivna
      if (!id) {
        const nova = await api.post<{ id: number }>('/ai/konverzacie', { asistent })
        id = nova.id
        setAktivna(id)
      }

      const popisFotiek = fotky.length ? `
Prílohy: ${fotky.map((f) => f.nazov).join(', ')}` : ''
      setSpravy((s) => [
        ...s,
        { rola: 'user', obsah: text + popisFotiek },
        { rola: 'assistant', obsah: '' },
      ])

      const odpoved = await fetch(`/api/ai/konverzacie/${id}/sprava`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprava: text, fotky: fotky.map((f) => f.id) }),
      })
      setFotky([])

      if (!odpoved.ok || !odpoved.body) {
        const chybaTela = await odpoved.json().catch(() => null)
        throw new Error(chybaTela?.chyba || 'Odpoveď sa nepodarilo načítať.')
      }

      // Server posiela Server-Sent Events – čítame ich po riadkoch.
      const citac = odpoved.body.getReader()
      const dekoder = new TextDecoder()
      let zvysok = ''

      while (true) {
        const { done, value } = await citac.read()
        if (done) break
        zvysok += dekoder.decode(value, { stream: true })
        const bloky = zvysok.split('\n\n')
        zvysok = bloky.pop() ?? ''

        for (const blok of bloky) {
          const typ = /^event: (.+)$/m.exec(blok)?.[1]
          const data = /^data: (.+)$/m.exec(blok)?.[1]
          if (!typ || !data) continue
          const obsah = JSON.parse(data)

          if (typ === 'text') {
            setSpravy((s) => {
              const kopia = [...s]
              kopia[kopia.length - 1] = {
                ...kopia[kopia.length - 1],
                obsah: kopia[kopia.length - 1].obsah + obsah.text,
              }
              return kopia
            })
          } else if (typ === 'nastroj') {
            setSpravy((s) => {
              const kopia = [...s]
              const posl = kopia[kopia.length - 1]
              kopia[kopia.length - 1] = { ...posl, akcie: [...(posl.akcie ?? []), obsah] }
              return kopia
            })
          } else if (typ === 'chyba') {
            setChyba(obsah.chyba)
          }
        }
      }
      nacitajKonverzacie()
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setGeneruje(false)
    }
  }

  async function nahrajFotky(subory: FileList | null) {
    if (!subory?.length) return
    setChyba('')
    setNahravaFotky(true)
    try {
      const data = new FormData()
      for (const s of Array.from(subory)) data.append('fotky', s)
      const r = await api.upload<{ fotky: { id: number; nazov: string }[] }>('/ai/fotky', data)
      setFotky((f) => [...f, ...r.fotky])
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setNahravaFotky(false)
      if (vstupFotiek.current) vstupFotiek.current.value = ''
    }
  }

  const bezKluca = !stav?.dostupne

  return (
    <div className="ai-stranka">
      <div className="hlavicka">
        <h1 className="ai-nadpis">
          <span className="ai-avatar">
            <Ikona nazov="pomocnik" velkost={16} hrubka={2} />
          </span>
          {NADPIS}
        </h1>
        <div className="akcie">
          <button
            className="primar"
            onClick={() => {
              setAktivna(null)
              setSpravy([])
              setChyba('')
              pole.current?.focus()
            }}
          >
            + Nová otázka
          </button>
        </div>
      </div>

      {stav && !stav.dostupne && (
        <div className="chyba">
          Chýba API kľúč. Otvor súbor <code>.env</code> v priečinku appky, doplň{' '}
          <code>ANTHROPIC_API_KEY=...</code> a appku reštartuj. Kľúč získaš na console.anthropic.com.
        </div>
      )}
      {chyba && <div className="chyba">{chyba}</div>}

      <div className="ai-rozlozenie">
        <div className="ai-chat panel">
          {spravy.length === 0 ? (
            <div className="ai-uvod">
              <div className="ai-uvod-obsah">
                <span className="ai-avatar velky">
                  <Ikona nazov="pomocnik" velkost={26} hrubka={1.8} />
                </span>
                <div className="ai-uvod-nadpis">{OTAZKA}</div>
                <p className="ai-uvod-text">{UVOD}</p>
                <div className="ai-priklady">
                  {priklady.map((p) => (
                    <button key={p.text} className="ai-priklad" onClick={() => posli(p.text)} disabled={bezKluca}>
                      <span className={`ai-priklad-ikona ton-${p.ton}`}>
                        <Ikona nazov={p.ikona} velkost={15} hrubka={2} />
                      </span>
                      <span>{p.text}</span>
                    </button>
                  ))}
                </div>
                <p className="ai-poznamka">
                  <Ikona nazov="zaplatena" velkost={14} hrubka={2.4} />
                  {POZNAMKA}
                </p>
              </div>
            </div>
          ) : (
            <div className="ai-spravy">
              <div className="ai-spravy-stlpec">
                {spravy.map((s, i) =>
                  s.rola === 'user' ? (
                    <div key={i} className="ai-sprava user">
                      <div className="ai-bublina">{s.obsah}</div>
                    </div>
                  ) : (
                    <div key={i} className="ai-sprava assistant">
                      <span className="ai-avatar">
                        <Ikona nazov="pomocnik" velkost={15} hrubka={2} />
                      </span>
                      <div className="ai-telo">
                        {!!s.akcie?.length && (
                          <div className="ai-akcie">
                            {s.akcie.map((a, j) => (
                              <span key={j} className={'ai-akcia' + (a.zapisuje ? ' zapis' : '')}>
                                <Ikona nazov={a.zapisuje ? 'upravit' : 'hladat'} velkost={13} hrubka={2} />
                                {POPIS_NASTROJA[a.nazov] ?? a.nazov}
                              </span>
                            ))}
                          </div>
                        )}
                        {s.obsah === '' ? generuje && i === spravy.length - 1 ? <Premysla /> : null : <Odpoved text={s.obsah} />}
                      </div>
                    </div>
                  ),
                )}
                <div ref={koniec} />
              </div>
            </div>
          )}

          <div className="ai-vstup">
            <div className="ai-pisanie">
              {fotky.length > 0 && (
                <div className="ai-fotky">
                  {fotky.map((f) => (
                    <span key={f.id} className="ai-fotka">
                      <Ikona nazov="priloha" velkost={13} hrubka={2} />
                      {f.nazov}
                      <button
                        className="ikonove maly holy"
                        title="Odobrať prílohu"
                        onClick={() => setFotky((x) => x.filter((y) => y.id !== f.id))}
                      >
                        <Ikona nazov="zavriet" velkost={14} hrubka={2} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                ref={pole}
                value={vstup}
                placeholder={bezKluca ? 'Asistent je vypnutý – chýba API kľúč.' : 'Napíš otázku…'}
                rows={1}
                disabled={bezKluca}
                onChange={(e) => setVstup(e.target.value)}
                onKeyDown={(e) => {
                  // Enter odošle, Shift + Enter spraví nový riadok.
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    posli()
                  }
                }}
              />
              <div className="ai-pisanie-lista">
                <input
                  ref={vstupFotiek}
                  type="file"
                  accept="image/*,.pdf,.txt,.csv,.docx"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => nahrajFotky(e.target.files)}
                />
                <button
                  className="ikonove holy"
                  title="Priložiť fotku alebo súbor"
                  aria-label="Priložiť fotku alebo súbor"
                  onClick={() => vstupFotiek.current?.click()}
                  disabled={nahravaFotky || bezKluca}
                >
                  {nahravaFotky ? <Premysla /> : <Ikona nazov="priloha" velkost={17} />}
                </button>
                <button
                  className="ai-odoslat"
                  title="Poslať"
                  aria-label="Poslať"
                  onClick={() => posli()}
                  disabled={generuje || (!vstup.trim() && !fotky.length) || bezKluca}
                >
                  {generuje ? <Premysla /> : <Ikona nazov="odoslat" velkost={16} hrubka={2} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="ai-historia panel">
          <div className="ai-historia-hlavicka">
            <span>Konverzácie</span>
            {konverzacie.length > 0 && <span className="pocet">{konverzacie.length}</span>}
          </div>
          {konverzacie.length === 0 ? (
            <p className="ai-historia-prazdne">Tu uvidíš svoje predošlé otázky.</p>
          ) : (
            konverzacie.map((k) => (
              <div key={k.id} className={'ai-polozka' + (aktivna === k.id ? ' aktivna' : '')}>
                <button className="ai-polozka-otvor" onClick={() => otvor(k.id)} title={k.nazov}>
                  <span className="ai-polozka-nazov">{k.nazov}</span>
                  <span className="ai-polozka-meta">
                    {skDatum(k.updated_at)} · {pocet(k.pocet_sprav, ['správa', 'správy', 'správ'])}
                  </span>
                </button>
                <button className="ikonove maly holy zmazat" title="Zmazať konverzáciu" onClick={() => zmazKonverzaciu(k)}>
                  <Ikona nazov="zmazat" velkost={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
