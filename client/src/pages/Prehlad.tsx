import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Area, ComposedChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  api, dniDoSplatnosti, pocet, skDatum, skSuma, suSumySkryte, SKRYTA_SUMA,
  NAZVY_STAVOV_TURNUSU, STITOK_TURNUSU,
  type Faktura, type KategoriaVydavkov, type MesacneFinancie, type Nastavenia, type PoSplatnosti,
  type PrehladFinancii, type Suhrn, type SuhrnZmluv, type Turnus, type Vydavok,
} from '../api'
import { Ikona, type KlucIkony } from '../components/Ikony'
import { TlacidloSum, useSkryteSumy } from '../components/SkryteSumy'
import { StitokStavu } from '../components/StitokStavu'
import { oznam } from '../components/Oznamenia'

type Konverzacia = { id: number; asistent: string; nazov: string; updated_at: string; pocet_sprav: number }
type Obdobie = 'rok' | 'kvartal' | 'mesiac'

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Od–do pre prepínač obdobia v kartičke financií. */
function rozsah(o: Obdobie, dnes: Date): { od: string; do: string } {
  const rok = dnes.getFullYear()
  if (o === 'rok') return { od: `${rok}-01-01`, do: `${rok}-12-31` }
  if (o === 'kvartal') {
    const q = Math.floor(dnes.getMonth() / 3)
    return { od: iso(new Date(rok, q * 3, 1)), do: iso(new Date(rok, q * 3 + 3, 0)) }
  }
  return { od: iso(new Date(rok, dnes.getMonth(), 1)), do: iso(new Date(rok, dnes.getMonth() + 1, 0)) }
}

/** Ten istý deň minulý rok (29. 2. → 28. 2.) – na porovnanie rovnakého obdobia. */
function tenIstyDenMinulyRok(dnes: Date): Date {
  const rok = dnes.getFullYear() - 1
  const posledny = new Date(rok, dnes.getMonth() + 1, 0).getDate()
  return new Date(rok, dnes.getMonth(), Math.min(dnes.getDate(), posledny))
}

/**
 * Dnešný dátum, ktorý sa sám posunie – appka býva otvorená aj cez noc
 * a pozdrav, dátum či „dnešné" obdobie by inak ostali včerajšie.
 */
function useTeraz(): Date {
  const [teraz, setTeraz] = useState(() => new Date())
  useEffect(() => {
    const kluc = (d: Date) => `${iso(d)}|${pozdrav(d)}`
    const over = () => setTeraz((pred) => (kluc(pred) === kluc(new Date()) ? pred : new Date()))
    const casovac = setInterval(over, 60_000)
    window.addEventListener('focus', over)
    return () => {
      clearInterval(casovac)
      window.removeEventListener('focus', over)
    }
  }, [])
  return teraz
}

/** Suma bez centov do popiskov („stravné 247 €") – rešpektuje skryté sumy. */
function kratkaSuma(n: number): string {
  if (suSumySkryte()) return SKRYTA_SUMA
  return new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 0 }).format(n) + ' €'
}

function pozdrav(dnes: Date): string {
  const h = dnes.getHours()
  if (h >= 4 && h < 10) return 'Dobré ráno'
  if (h >= 10 && h < 18) return 'Dobrý deň'
  return 'Dobrý večer'
}

const DNI_TYZDNA = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota']

/** Maličký odpočet do splatnosti, rovnaký ako v zozname faktúr. */
function Dni({ splatnost }: { splatnost: string }) {
  const d = dniDoSplatnosti(splatnost)
  if (d === null) return null
  if (d === 0) return <span className="dni dnes">dnes</span>
  return d > 0 ? <span className="dni zostava">+{d} d</span> : <span className="dni po">−{-d} d</span>
}

/** Dlaždica pod hlavnou časťou – nadpis s odkazom a krátka ukážka. */
function Sekcia({
  nadpis, kam, odkaz = 'Zobraziť všetky', deti,
}: {
  nadpis: string
  kam: string
  odkaz?: string
  deti: React.ReactNode
}) {
  return (
    <div className="panel tesny dlazdica">
      <div className="dlazdica-hlavicka">
        <Link to={kam} className="dlazdica-nadpis">
          <h2>{nadpis}</h2>
        </Link>
        <Link to={kam}>{odkaz} →</Link>
      </div>
      {deti}
    </div>
  )
}

type Pozornost = {
  kluc: string
  druh: 'kriticke' | 'termin' | 'tip' | 'info'
  ikona: KlucIkony
  titul: string
  meta: string
  cipy?: React.ReactNode
}

export function Prehlad() {
  const navigate = useNavigate()
  const [skryte] = useSkryteSumy()
  const [obdobie, setObdobie] = useState<Obdobie>('rok')
  const DNES = useTeraz()
  const ROK = DNES.getFullYear()
  const dnesKluc = iso(DNES)

  const [suhrn, setSuhrn] = useState<Suhrn | null>(null)
  const [posledne, setPosledne] = useState<Faktura[]>([])
  const [nastavenia, setNastavenia] = useState<Nastavenia | null>(null)
  const [zmluvy, setZmluvy] = useState<SuhrnZmluv | null>(null)
  const [financie, setFinancie] = useState<PrehladFinancii | null>(null)
  const [minulyRok, setMinulyRok] = useState<PrehladFinancii | null>(null)
  const [kategorie, setKategorie] = useState<KategoriaVydavkov[]>([])
  const [kategorieRok, setKategorieRok] = useState<KategoriaVydavkov[]>([])
  const [mesacne, setMesacne] = useState<MesacneFinancie[]>([])
  const [vydavky, setVydavky] = useState<Vydavok[]>([])
  const [turnusy, setTurnusy] = useState<Turnus[]>([])
  const [poSplatnosti, setPoSplatnosti] = useState<PoSplatnosti[]>([])
  const [konverzacie, setKonverzacie] = useState<Konverzacia[]>([])
  const [zaloha, setZaloha] = useState<string | null>(null)
  const [vydavkyTurnusu, setVydavkyTurnusu] = useState<Vydavok[] | null>(null)

  function nacitajFaktury() {
    api.get<Suhrn>('/faktury/suhrn').then(setSuhrn).catch(() => {})
    api.get<Faktura[]>('/faktury').then((f) => setPosledne(f.slice(0, 8))).catch(() => {})
    api.get<PoSplatnosti[]>('/mail/po-splatnosti').then(setPoSplatnosti).catch(() => {})
  }

  useEffect(() => {
    nacitajFaktury()
    api.get<Nastavenia>('/nastavenia').then(setNastavenia).catch(() => {})
    api.get<SuhrnZmluv>('/zmluvy/suhrn').then(setZmluvy).catch(() => {})
    // Porovnávame rovnaké obdobie – 1. 1. až dnešný deň minulého roka, nie celý minulý rok.
    api
      .get<PrehladFinancii>(`/financie/prehlad?od=${ROK - 1}-01-01&do=${iso(tenIstyDenMinulyRok(DNES))}`)
      .then(setMinulyRok)
      .catch(() => {})
    api.get<MesacneFinancie[]>(`/financie/mesacne?rok=${ROK}`).then(setMesacne).catch(() => {})
    api.get<KategoriaVydavkov[]>(`/financie/kategorie?rok=${ROK}`).then((k) => setKategorieRok(k.slice(0, 5))).catch(() => {})
    api.get<Vydavok[]>('/vydavky?druh=vydavok').then((v) => setVydavky(v.slice(0, 6))).catch(() => {})
    api.get<Turnus[]>('/turnusy').then(setTurnusy).catch(() => {})
    api.get<Konverzacia[]>('/ai/konverzacie').then((k) => setKonverzacie(k.slice(0, 5))).catch(() => {})
    api.get<{ posledna: string | null }>('/zalohy/stav').then((z) => setZaloha(z.posledna)).catch(() => {})
    // Po polnoci sa načíta znova – mení sa, čo je po splatnosti aj aktívny turnus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dnesKluc])

  // Čísla vo finančnej kartičke podľa zvoleného obdobia.
  useEffect(() => {
    const r = rozsah(obdobie, DNES)
    const q = `od=${r.od}&do=${r.do}`
    api.get<PrehladFinancii>(`/financie/prehlad?${q}`).then(setFinancie).catch(() => {})
    api.get<KategoriaVydavkov[]>(`/financie/kategorie?${q}`).then(setKategorie).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obdobie, dnesKluc])

  const aktivny = turnusy.find((t) => t.stav === 'prebieha') ?? null
  const najblizsi = useMemo(
    () =>
      turnusy
        .filter((t) => t.stav === 'planovany')
        .sort((a, b) => a.datum_od.localeCompare(b.datum_od))[0] ?? null,
    [turnusy],
  )

  useEffect(() => {
    if (!aktivny) return
    api.get<Vydavok[]>(`/vydavky?turnus=${aktivny.id}&druh=vydavok`).then(setVydavkyTurnusu).catch(() => {})
  }, [aktivny?.id])

  const denTurnusu = aktivny
    ? Math.floor((new Date(iso(DNES)).getTime() - new Date(aktivny.datum_od).getTime()) / 86400000) + 1
    : 0
  const dlzkaTurnusu = aktivny
    ? Math.floor((new Date(aktivny.datum_do).getTime() - new Date(aktivny.datum_od).getTime()) / 86400000) + 1
    : 0

  const krstne = (nastavenia?.meno ?? '').trim().split(/\s+/)[0]
  const dnesZalohovane = zaloha === iso(DNES).replace(/-/g, '')

  // ── Vyžaduje pozornosť ──────────────────────────────────────
  async function oznacZaplatenu(f: PoSplatnosti) {
    const r = await api.post<{ platba_id: number | null }>(`/faktury/${f.id}/stav`, { stav: 'zaplatena' })
    nacitajFaktury()
    oznam(
      `Faktúra ${f.cislo}: zapísaná platba ${skSuma(f.otvoreny_zostatok)}.`,
      r.platba_id
        ? {
            text: 'Vrátiť späť',
            sprav: async () => {
              await api.del(`/faktury/platby/${r.platba_id}`)
              nacitajFaktury()
            },
          }
        : undefined,
    )
  }

  const pozornost: Pozornost[] = []
  if (nastavenia && (!nastavenia.meno || !nastavenia.iban)) {
    pozornost.push({
      kluc: 'udaje',
      druh: 'info',
      ikona: 'nastavenia',
      titul: 'Chýbajú tvoje fakturačné údaje',
      meta: 'Bez mena a IBAN-u budú faktúry neúplné.',
      cipy: <Link className="cip hlavny" to="/nastavenia">Doplniť údaje</Link>,
    })
  }
  for (const f of poSplatnosti.slice(0, 3)) {
    pozornost.push({
      kluc: 'f' + f.id,
      druh: 'kriticke',
      ikona: 'pozor',
      titul: `Faktúra ${f.cislo} po splatnosti`,
      meta: [f.firma_nazov, skSuma(f.otvoreny_zostatok), pocet(f.dni_po_splatnosti, ['deň', 'dni', 'dní'])]
        .filter(Boolean)
        .join(' · '),
      cipy: (
        <>
          <Link className="cip hlavny" to="/upomienky">Poslať upomienku</Link>
          <button className="cip" onClick={() => oznacZaplatenu(f)}>Zaplatená</button>
        </>
      ),
    })
  }
  if (poSplatnosti.length > 3) {
    pozornost.push({
      kluc: 'dalsie',
      druh: 'kriticke',
      ikona: 'upomienky',
      titul: `A ďalšie ${pocet(poSplatnosti.length - 3, ['faktúra', 'faktúry', 'faktúr'])} po splatnosti`,
      meta: 'Všetky nájdeš v upomienkach.',
      cipy: <Link className="cip" to="/upomienky">Zobraziť upomienky</Link>,
    })
  }
  for (const z of zmluvy?.pripomienky ?? []) {
    const vyprsala = z.expiracia === 'po_expiracii'
    pozornost.push({
      kluc: 'z' + z.id,
      druh: vyprsala ? 'kriticke' : 'termin',
      ikona: vyprsala ? 'pozor' : 'kalendar',
      titul: `Zmluva ${z.nazov} ${vyprsala ? 'vypršala' : 'končí'}`,
      meta: [
        z.firma_nazov,
        vyprsala ? skDatum(z.platnost_do) : `${z.dni_do_konca === 0 ? 'dnes' : `o ${z.dni_do_konca} dní`} · ${skDatum(z.platnost_do)}`,
      ]
        .filter(Boolean)
        .join(' · '),
      cipy: <Link className="cip" to={'/zmluvy/' + z.id}>Otvoriť zmluvu</Link>,
    })
  }
  const kritickych = pozornost.filter((p) => p.druh === 'kriticke').length

  // ── Graf ────────────────────────────────────────────────────
  const dataGrafu = mesacne.map((m) => ({ ...m, mesiac: m.mesiac.toLowerCase() }))
  const sumaTurnusu = vydavkyTurnusu?.reduce((s, v) => s + v.suma, 0) ?? 0

  const zmenaZisku =
    obdobie === 'rok' && financie && minulyRok && Math.abs(minulyRok.zisk) > 0.005
      ? ((financie.zisk - minulyRok.zisk) / Math.abs(minulyRok.zisk)) * 100
      : null

  const podielPoSplatnosti = suhrn && suhrn.nezaplatene > 0 ? Math.min(100, (suhrn.po_splatnosti / suhrn.nezaplatene) * 100) : 0
  const najvacsiaKategoria = kategorieRok[0]?.suma ?? 0

  return (
    <>
      <div className="hlavicka">
        <div>
          <div className="pozdrav">
            <h1>
              {pozdrav(DNES)}
              {krstne ? `, ${krstne}` : ''}
            </h1>
            {aktivny ? (
              <span className="pill-turnus aktivny">Turnus aktívny · {denTurnusu}. deň</span>
            ) : (
              <span className="pill-turnus">Bez aktívneho turnusu</span>
            )}
          </div>
          <div className="pozdrav-podtitul">
            {DNI_TYZDNA[DNES.getDay()]} {skDatum(iso(DNES))}
            {aktivny && ` · ${[aktivny.firma_nazov, aktivny.miesto || aktivny.krajina].filter(Boolean).join(', ')}`}
            {zaloha && ` · ${dnesZalohovane ? 'zálohované dnes' : `posledná záloha ${skDatum(`${zaloha.slice(0, 4)}-${zaloha.slice(4, 6)}-${zaloha.slice(6, 8)}`)}`}`}
          </div>
        </div>
        <div className="akcie">
          <TlacidloSum />
        </div>
      </div>

      <div className="prehlad-mriezka">
        {/* ── Ľavý stĺpec ─────────────────────────────────────── */}
        <div className="prehlad-lavy">
          <div className="panel tesny">
            <div className="hlavicka-karty">
              <h2 className="nadpis-karty">Finančný prehľad</h2>
              <div className="segment" role="tablist">
                {(
                  [
                    ['rok', `Rok ${ROK}`],
                    ['kvartal', 'Kvartál'],
                    ['mesiac', 'Mesiac'],
                  ] as [Obdobie, string][]
                ).map(([k, text]) => (
                  <button key={k} className={obdobie === k ? 'aktivny' : ''} aria-pressed={obdobie === k} onClick={() => setObdobie(k)}>
                    {text}
                  </button>
                ))}
              </div>
            </div>

            <div className="kpi">
              <Link className="kpi-bunka" to="/financie">
                <div className="kpi-popis">
                  <Ikona nazov="hore" velkost={14} hrubka={2.2} className="plus" />
                  Príjmy
                </div>
                <div className="kpi-hodnota">{skSuma(financie?.prijmy ?? 0)}</div>
                <div className="kpi-meta">
                  {financie ? pocet(financie.pocet_faktur, ['uhradená faktúra', 'uhradené faktúry', 'uhradených faktúr']) : '—'}
                </div>
              </Link>
              <Link className="kpi-bunka" to="/vydavky">
                <div className="kpi-popis">
                  <Ikona nazov="dole" velkost={14} hrubka={2.2} className="minus" />
                  Výdavky
                </div>
                <div className="kpi-hodnota">{skSuma(financie?.vydavky ?? 0)}</div>
                <div className="kpi-meta">
                  {kategorie.length
                    ? kategorie
                        .slice(0, 2)
                        .map((k) => `${k.kategoria.toLowerCase()} ${kratkaSuma(k.suma)}`)
                        .join(' · ')
                    : 'zatiaľ žiadne'}
                </div>
              </Link>
              <Link className="kpi-bunka" to="/financie">
                <div className="kpi-popis">Zostatok</div>
                <div className="kpi-hodnota">{skSuma(financie?.zisk ?? 0)}</div>
                <div
                  className="kpi-meta"
                  title={
                    zmenaZisku !== null
                      ? `Porovnanie s obdobím 1. 1. – ${skDatum(iso(tenIstyDenMinulyRok(DNES)))}`
                      : undefined
                  }
                >
                  {zmenaZisku !== null ? (
                    <>
                      <span className={zmenaZisku >= 0 ? 'plus' : 'minus'}>
                        {zmenaZisku >= 0 ? '+' : '−'}
                        {new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 1 }).format(Math.abs(zmenaZisku))} %
                      </span>{' '}
                      oproti rovnakému obdobiu {ROK - 1}
                    </>
                  ) : (
                    'príjmy mínus výdavky'
                  )}
                </div>
              </Link>
              <Link className="kpi-bunka" to="/faktury?stav=nevyplatene">
                <div className="kpi-popis">Čaká na zaplatenie</div>
                <div className="kpi-hodnota">{skSuma(suhrn?.nezaplatene ?? 0)}</div>
                <div className="kpi-meta">
                  {suhrn && suhrn.po_splatnosti > 0
                    ? `z toho po splatnosti ${skSuma(suhrn.po_splatnosti)}`
                    : 'nič nie je po splatnosti'}
                </div>
                <div className="pruh" title="Podiel sumy po splatnosti">
                  <div className="pruh-vypln" style={{ width: podielPoSplatnosti + '%' }} />
                </div>
              </Link>
            </div>

            <div className="graf-prehlad">
              <ResponsiveContainer key={skryte ? 'skryte' : 'viditelne'} width="100%" height={150}>
                <ComposedChart data={dataGrafu} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="prijmyVypln" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" className="prijmy-zaciatok" />
                      <stop offset="100%" className="prijmy-koniec" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="mesiac" axisLine={false} tickLine={false} interval={0} tickMargin={8} />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ stroke: 'var(--line)' }}
                    formatter={((v: unknown, n: unknown) => [skSuma(Number(v) || 0), n === 'prijmy' ? 'Príjmy' : 'Výdavky']) as never}
                  />
                  <Area
                    type="monotone"
                    dataKey="prijmy"
                    className="prijmy"
                    fill="url(#prijmyVypln)"
                    strokeWidth={2.5}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="vydavky"
                    className="vydavky"
                    strokeWidth={1.6}
                    strokeDasharray="5 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="graf-legenda">
                <span>
                  <i /> Príjmy {ROK}
                </span>
                <span>
                  <i className="prerusovana" /> Výdavky
                </span>
                {financie && financie.sukromne_prijmy > 0 && (
                  <span style={{ marginLeft: 'auto' }}>
                    súkromné príjmy mimo podnikania {skSuma(financie.sukromne_prijmy)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="panel tesny">
            <div className="hlavicka-karty">
              <h2 className="nadpis-karty">Posledné faktúry</h2>
              <Link className="odkaz-karty" to="/faktury">
                Zobraziť všetky →
              </Link>
            </div>
            {posledne.length === 0 ? (
              <div className="prazdne">
                Zatiaľ žiadne faktúry. <Link to="/faktury/nova">Vystav prvú</Link>.
              </div>
            ) : (
              <div className="tabulka-obal">
                <table>
                  <thead>
                    <tr>
                      <th>Číslo</th>
                      <th>Odberateľ</th>
                      <th>Splatnosť</th>
                      <th className="cislo">Suma</th>
                      <th>Stav</th>
                    </tr>
                  </thead>
                  <tbody>
                    {posledne.map((f) => {
                      const otvorena = f.otvoreny_zostatok > 0.005 && f.stav !== 'koncept'
                      const ciastocne = otvorena && f.uhradene_spolu > 0.005
                      return (
                        <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/faktury/' + f.id)}>
                          <td>
                            <span className="cislo-faktury">{f.cislo}</span>
                          </td>
                          <td className="odberatel-bunka">{f.firma_nazov || <span className="tlmene">—</span>}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {skDatum(f.datum_splat)}
                            {otvorena && <Dni splatnost={f.datum_splat} />}
                          </td>
                          <td className="cislo">{skSuma(f.suma)}</td>
                          <td>
                            <StitokStavu stav={f.stav_zobraz} />
                            {f.typ === 'zaloha' ? (
                              <span className="pod-stitkom">
                                {f.kryje_cislo ? `kryje ${f.kryje_cislo}` : 'zálohová faktúra'}
                              </span>
                            ) : ciastocne ? (
                              <span className="pod-stitkom">
                                {skSuma(f.uhradene_spolu)} z {skSuma(f.suma)}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Pravý stĺpec ────────────────────────────────────── */}
        <div className="prehlad-pravy">
          <div className="panel rychle-akcie">
            <h2 className="nadpis-karty">Rýchle akcie</h2>
            <div className="zoznam-akcii">
              <Link className="akcia hlavna" to="/faktury/nova">
                <Ikona nazov="plus" velkost={18} hrubka={2.2} />
                Nová faktúra
              </Link>
              <Link className="akcia" to="/vydavky?novy=1">
                <Ikona nazov="sken" velkost={18} />
                <span>
                  Pridať výdavok
                  <small>aj s fotkou bločku</small>
                </span>
              </Link>
              <Link className="akcia" to="/turnusy/novy">
                <Ikona nazov="hodiny" velkost={18} />
                Nový turnus
              </Link>
            </div>
          </div>

          <div className="panel tesny">
            <div className="pozornost-hlavicka">
              <h2 className="nadpis-karty">Vyžaduje pozornosť</h2>
              <span className={'pocet-pill' + (pozornost.length === 0 ? ' v-poriadku' : '')}>
                {pozornost.length === 0 ? 'OK' : kritickych || pozornost.length}
              </span>
            </div>
            {pozornost.length === 0 ? (
              <div className="pozornost-polozka">
                <span className="pozornost-ikona" style={{ background: 'var(--posBg)', color: 'var(--pos)' }}>
                  <Ikona nazov="zaplatena" velkost={15} hrubka={2.2} />
                </span>
                <div className="pozornost-telo">
                  <div className="pozornost-titul">Všetko je v poriadku</div>
                  <div className="pozornost-meta">Nič nemešká a žiadna zmluva nekončí.</div>
                </div>
              </div>
            ) : (
              pozornost.map((p) => (
                <div key={p.kluc} className="pozornost-polozka">
                  <span className={'pozornost-ikona ' + p.druh}>
                    <Ikona nazov={p.ikona} velkost={15} hrubka={2} />
                  </span>
                  <div className="pozornost-telo">
                    <div className="pozornost-titul">{p.titul}</div>
                    <div className="pozornost-meta">{p.meta}</div>
                    {p.cipy && <div className="cipy">{p.cipy}</div>}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="panel turnus-karta">
            {aktivny ? (
              <>
                <div className="turnus-karta-hlavicka">
                  <h2 className="nadpis-karty">Aktívny turnus</h2>
                  <span className="turnus-dni">
                    {Math.min(denTurnusu, dlzkaTurnusu)} / {dlzkaTurnusu} dní
                  </span>
                </div>
                <div className="pruh" style={{ height: 7 }}>
                  <div
                    className="pruh-vypln"
                    style={{ width: Math.min(100, (denTurnusu / Math.max(1, dlzkaTurnusu)) * 100) + '%' }}
                  />
                </div>
                <div className="turnus-miesto">
                  <Link to={'/turnusy/' + aktivny.id}>{aktivny.nazov}</Link>
                  {[aktivny.miesto, aktivny.krajina].filter(Boolean).length > 0 &&
                    ` · ${[aktivny.miesto, aktivny.krajina].filter(Boolean).join(', ')}`}
                </div>
                <div className="turnus-metriky">
                  <div>
                    <div className="popis">Vyfakturované</div>
                    <div className="hodnota">{kratkaSuma(aktivny.vyfakturovane)}</div>
                  </div>
                  <div>
                    <div className="popis">Výdavky</div>
                    <div className="hodnota">{kratkaSuma(sumaTurnusu)}</div>
                  </div>
                  <div>
                    <div className="popis">Doklady</div>
                    <div className="hodnota">{vydavkyTurnusu?.length ?? '—'}</div>
                  </div>
                </div>
              </>
            ) : najblizsi ? (
              <>
                <div className="turnus-karta-hlavicka">
                  <h2 className="nadpis-karty">Najbližší turnus</h2>
                  <span className="turnus-dni">
                    {(() => {
                      const o = dniDoSplatnosti(najblizsi.datum_od) ?? 0
                      return o <= 0 ? 'začína dnes' : `o ${pocet(o, ['deň', 'dni', 'dní'])}`
                    })()}
                  </span>
                </div>
                <div className="turnus-miesto" style={{ marginTop: 0 }}>
                  <Link to={'/turnusy/' + najblizsi.id}>{najblizsi.nazov}</Link>
                  {' · '}
                  {skDatum(najblizsi.datum_od)} – {skDatum(najblizsi.datum_do)}
                </div>
                <div className="turnus-metriky">
                  <div>
                    <div className="popis">Firma</div>
                    <div className="hodnota" style={{ fontSize: 14 }}>{najblizsi.firma_nazov || '—'}</div>
                  </div>
                  <div>
                    <div className="popis">Objednané</div>
                    <div className="hodnota">{kratkaSuma(najblizsi.objednane)}</div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="turnus-karta-hlavicka">
                  <h2 className="nadpis-karty">Turnus</h2>
                </div>
                <div className="turnus-miesto" style={{ marginTop: 0 }}>
                  Žiadny turnus neprebieha ani nie je naplánovaný. <Link to="/turnusy/novy">Založiť turnus</Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Ďalšie oblasti ────────────────────────────────────── */}
      {/* Dva nezávislé stĺpce – kratšia dlaždica nenechá pod sebou dieru. */}
      <div className="dva-stlpce dlazdice">
        <div className="stlpec-dlazdic">
          <Sekcia
            nadpis="Posledné výdavky"
            kam="/vydavky"
            deti={
              vydavky.length === 0 ? (
                <div className="prazdne">Zatiaľ žiadne výdavky.</div>
              ) : (
                <table>
                  <tbody>
                    {vydavky.map((v) => (
                      <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/vydavky')}>
                        <td className="tlmene" style={{ width: 92 }}>{skDatum(v.datum)}</td>
                        <td>
                          <strong>{v.popis}</strong>
                          {v.kategoria && <div className="tlmene" style={{ fontSize: 12.5 }}>{v.kategoria}</div>}
                        </td>
                        <td className="cislo">
                          {skSuma(v.suma)}
                          {v.odpocitat === 0 && <div className="tlmene" style={{ fontSize: 12.5, fontWeight: 500 }}>neuznateľný</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          />
          <Sekcia
            nadpis="Turnusy"
            kam="/turnusy"
            deti={
              turnusy.length === 0 ? (
                <div className="prazdne">
                  Zatiaľ žiadne turnusy. <Link to="/turnusy/novy">Založ prvý</Link>.
                </div>
              ) : (
                <table>
                  <tbody>
                    {turnusy.slice(0, 5).map((t) => (
                      <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/turnusy/' + t.id)}>
                        <td>
                          <strong>{t.nazov}</strong>
                          <div className="tlmene" style={{ fontSize: 12.5 }}>
                            {[t.miesto, t.krajina].filter(Boolean).join(', ') || t.firma_nazov || '—'}
                          </div>
                        </td>
                        <td className="tlmene" style={{ whiteSpace: 'nowrap' }}>
                          {skDatum(t.datum_od)} – {skDatum(t.datum_do)}
                        </td>
                        <td>
                          <span className={'stitok ' + STITOK_TURNUSU[t.stav]}>{NAZVY_STAVOV_TURNUSU[t.stav]}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          />
        </div>
        <div className="stlpec-dlazdic">
          <Sekcia
            nadpis="Asistent"
            kam="/asistent"
            odkaz="Otvoriť asistenta"
            deti={
              <>
                {konverzacie.length === 0 ? (
                  <div className="prazdne">
                    Zatiaľ žiadna otázka. <Link to="/asistent">Napíš, čo potrebuješ</Link> — asistent vie zapísať
                    výdavok z fotky dokladu, vystaviť faktúru aj odpovedať na dane a zmluvy.
                  </div>
                ) : (
                  <table>
                    <tbody>
                      {konverzacie.map((k) => (
                        <tr key={k.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/asistent')}>
                          <td>
                            <strong>{k.nazov}</strong>
                          </td>
                          <td className="tlmene" style={{ width: 100, whiteSpace: 'nowrap' }}>
                            {pocet(k.pocet_sprav, ['správa', 'správy', 'správ'])}
                          </td>
                          <td className="tlmene" style={{ width: 90 }}>{skDatum(k.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="dlazdica-pata">
                  <Link className="tlacidlo maly" to="/asistent">
                    <Ikona nazov="pomocnik" velkost={14} /> Nová otázka
                  </Link>
                  <Link className="tlacidlo maly" to="/danovy-podklad">
                    <Ikona nazov="podklad" velkost={14} /> Daňový podklad
                  </Link>
                </div>
              </>
            }
          />
          <Sekcia
            nadpis={`Na čo idú peniaze v roku ${ROK}`}
            kam="/financie"
            odkaz="Financie"
            deti={
              kategorieRok.length === 0 ? (
                <div className="prazdne">Zatiaľ žiadne výdavky.</div>
              ) : (
                <table>
                  <tbody>
                    {kategorieRok.map((k) => (
                      <tr key={k.kategoria}>
                        <td style={{ width: 150 }}>{k.kategoria}</td>
                        <td>
                          {/* Pruh je len orientačný – najväčšia kategória je plná šírka. */}
                          <div className="pruh">
                            <div
                              className="pruh-vypln"
                              style={{ width: (najvacsiaKategoria ? (k.suma / najvacsiaKategoria) * 100 : 0) + '%' }}
                            />
                          </div>
                        </td>
                        <td className="cislo" style={{ width: 110 }}>{skSuma(k.suma)}</td>
                        <td className="cislo tlmene" style={{ width: 46, fontWeight: 500 }}>{k.pocet}×</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          />
        </div>
      </div>
    </>
  )
}
