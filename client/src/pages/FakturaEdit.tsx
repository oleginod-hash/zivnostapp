import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  api, dnesISO, pocet, skDatum, skSuma,
  type DphRezim, type Faktura, type Firma, type Nastavenia, type Objednavka, type PlatbaFaktury, type Polozka,
  type Sablona, type Stav, type Turnus, type TypDokladu,
} from '../api'
import { OdoslatMail } from '../components/OdoslatMail'
import { pracovnychDniMedzi, pridajPracovneDni } from '../../../server/lib/pracovneDni'
import { SADZBY_DPH, spocitajFakturu } from '../../../server/lib/dph'
import { Ikona } from '../components/Ikony'
import { useNeulozeneZmeny } from '../neulozene'
import { oznam, potvrd } from '../components/Oznamenia'
import { CasovaOs } from '../components/CasovaOs'
import { MenuAkcii } from '../components/MenuAkcii'
import { OknoDodavatela, OknoOdberatela } from '../components/UdajeStran'
import { useMaleOkno } from '../maleOkno'

type Formular = {
  cislo: string
  typ: TypDokladu
  kryje_id: string
  company_id: string
  tour_id: string
  order_id: string
  datum_vystav: string
  datum_dodania: string
  datum_splat: string
  stav: Stav
  datum_uhrady: string
  variabilny: string
  poznamka: string
  polozky: Polozka[]
  platby: PlatbaFaktury[]
  /** Faktúra platiteľa DPH – určí sa pri vzniku, zmena nastavení ju neprepočíta. */
  s_dph: boolean
  /** DPH odvedie odberateľ – na faktúre bez DPH, s vetou o prenesení daňovej povinnosti. */
  prenos_dph: boolean
  cislo_objednavky: string
  uvodny_text: string
}

const PRAZDNA_POLOZKA: Polozka = { popis: '', mnozstvo: 1, jednotka: 'ks', cena: 0 }

/** Firma z inej krajiny EÚ s IČ DPH – pri službách pre ňu DPH odvádza ona. */
const zahranicnaSIcDph = (f: Firma | undefined) => !!f?.ic_dph?.trim() && !/^SK/i.test(f.ic_dph.trim())

/** Bežné lehoty splatnosti na rýchly výber. */
const DNI_SPLATNOSTI = [7, 10, 14, 21, 30, 45, 60]

/** Dátum posunutý o daný počet dní (rovnaký výpočet ako na serveri). */
function pridajDni(iso: string, dni: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + dni)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function kalendarnychDniMedzi(od: string, doDna: string): number {
  return Math.round((new Date(doDna + 'T12:00:00').getTime() - new Date(od + 'T12:00:00').getTime()) / 86400000)
}



export function FakturaEdit() {
  const { id } = useParams()
  const [hladane] = useSearchParams()
  const navigate = useNavigate()
  const novaFaktura = !id
  // Predvolený režim splatnosti je v Nastaveniach; tu sa dá prepnúť pre jednu faktúru.
  const [pracovneDni, setPracovneDni] = useState(false)

  const [form, setForm] = useState<Formular | null>(null)
  const [firmy, setFirmy] = useState<Firma[]>([])
  const [turnusy, setTurnusy] = useState<Turnus[]>([])
  const [objednavky, setObjednavky] = useState<Objednavka[]>([])
  const [chyba, setChyba] = useState('')
  const [uklada, setUklada] = useState(false)
  const [sablony, setSablony] = useState<Sablona[]>([])
  const [nevyplatene, setNevyplatene] = useState<Faktura[]>([])
  /** Zálohové faktúry, ktoré túto faktúru kryjú – ich platby ju tiež umorujú. */
  const [kryteZalohami, setKryteZalohami] = useState<Faktura[]>([])
  const [posielam, setPosielam] = useState(false)
  const [sprava, setSprava] = useState('')
  /**
   * Faktúra, ktorú táto zálohová faktúra kryje. Keď je už celá uhradená, v zozname
   * nevyplatených nie je – bez nej by výber ukazoval „nekryje žiadny dlh".
   */
  const [krytaFaktura, setKrytaFaktura] = useState<{ id: number; cislo: string } | null>(null)
  const [dph, setDph] = useState<{ rezim: DphRezim; sadzba: number }>({ rezim: 'neplatitel', sadzba: 23 })
  /** Faktúra tak, ako je uložená – z nej sa skladá časová os. */
  const [ulozena, setUlozena] = useState<Faktura | null>(null)
  const male = useMaleOkno()
  /** Na telefóne sa položka upravuje po jednej: číslo otvorenej, -1 = žiadna, null = zatiaľ nerozhodnuté. */
  const [otvorenaPolozka, setOtvorenaPolozka] = useState<number | null>(null)
  /** „Viac údajov" – null = podľa faktúry (otvorené pri zálohovej či s objednávkou). */
  const [viacUdajov, setViacUdajov] = useState<boolean | null>(null)
  /** Moje údaje (dodávateľ) z Nastavení a otvorené okno s údajmi strany. */
  const [mojaFirma, setMojaFirma] = useState<Nastavenia | null>(null)
  const [okno, setOkno] = useState<'' | 'odberatel' | 'dodavatel'>('')
  const oznacUlozene = useNeulozeneZmeny(form, id ?? 'nova')

  useEffect(() => {
    api
      .get<Nastavenia>('/nastavenia')
      .then((n) => {
        setDph({ rezim: n.dph_rezim ?? 'neplatitel', sadzba: n.dph_sadzba ?? 23 })
        setMojaFirma(n)
      })
      .catch(() => {})
    api.get<Firma[]>('/firmy').then(setFirmy).catch(() => {})
    api.get<Turnus[]>('/turnusy').then(setTurnusy).catch(() => {})
    api.get<Objednavka[]>('/objednavky').then(setObjednavky).catch(() => {})
    api.get<Sablona[]>('/sablony').then(setSablony).catch(() => {})
    api
      .get<{ nevyplatene: Faktura[] }>('/faktury/prehlad/dlhy')
      .then((d) => setNevyplatene(d.nevyplatene))
      .catch(() => {})

    if (novaFaktura) {
      const zTurnusu = hladane.get('turnus') ?? ''
      const zObjednavky = hladane.get('objednavka') ?? ''

      Promise.all([
        api.get<{
          cislo: string; datum_vystav: string; datum_dodania: string; datum_splat: string
          splatnost_pracovne: boolean; s_dph: number
        }>('/faktury/nova'),
        api.get<Nastavenia>('/nastavenia').catch(() => null),
        zObjednavky ? api.get<Objednavka>('/objednavky/' + zObjednavky) : Promise.resolve(null),
        zTurnusu ? api.get<Turnus>('/turnusy/' + zTurnusu) : Promise.resolve(null),
      ])
        .then(([n, nastavenia, o, t]) => {
          // Faktúra vystavená z objednávky si z nej vezme popis aj sadzbu.
          // Pri hodinovke fakturujeme hodiny, inak zvyšok dohodnutej sumy.
          const zvysok = o ? Math.round((o.suma - o.vyfakturovane) * 100) / 100 : 0
          const popisPrac = o?.popis || o?.cislo || 'Práce podľa objednávky'
          const polozka: Polozka | null = o
            ? o.hodinovka > 0
              ? {
                  popis: popisPrac,
                  mnozstvo: o.hodiny > 0 ? o.hodiny : 0,
                  jednotka: 'hod',
                  cena: o.hodinovka,
                }
              : { popis: popisPrac, mnozstvo: 1, jednotka: 'ks', cena: Math.max(0, zvysok) }
            : t
              ? { popis: `Práce – ${t.nazov}`, mnozstvo: 1, jednotka: 'ks', cena: 0 }
              : null

          // Server už splatnosť spočítal podľa nastavení (aj v pracovných dňoch).
          const { splatnost_pracovne, s_dph, ...navrh } = n
          setPracovneDni(splatnost_pracovne)
          const sadzba = nastavenia?.dph_sadzba ?? 23
          setForm({
            ...navrh,
            s_dph: !!s_dph,
            // Návrh prenesenia sa ukáže pri výbere odberateľa (firmy sa ešte načítavajú).
            prenos_dph: false,
            cislo_objednavky: '',
            uvodny_text: '',
            company_id: String(o?.company_id ?? t?.company_id ?? ''),
            tour_id: String(o?.tour_id ?? t?.id ?? ''),
            order_id: zObjednavky,
            typ: (hladane.get('typ') as TypDokladu) === 'zaloha' ? 'zaloha' : 'faktura',
            kryje_id: hladane.get('kryje') ?? '',
            stav: 'vystavena',
            datum_uhrady: '',
            variabilny: '',
            poznamka: '',
            polozky: [{ ...(polozka ?? PRAZDNA_POLOZKA), sadzba_dph: s_dph ? sadzba : null }],
            platby: [],
          })
        })
        .catch((e) => setChyba(e.message))
    } else {
      api
        .get<{ splatnost_pracovne: number }>('/nastavenia')
        .then((n) => setPracovneDni(!!n.splatnost_pracovne))
        .catch(() => {})
      api
        .get<Faktura>('/faktury/' + id)
        .then((f) => {
          setUlozena(f)
          setKryteZalohami(f.kryte_zalohami ?? [])
          if (f.kryje_id && f.kryje_cislo) setKrytaFaktura({ id: f.kryje_id, cislo: f.kryje_cislo })
          setForm({
            cislo: f.cislo,
            company_id: f.company_id ? String(f.company_id) : '',
            tour_id: f.tour_id ? String(f.tour_id) : '',
            order_id: f.order_id ? String(f.order_id) : '',
            typ: f.typ ?? 'faktura',
            kryje_id: f.kryje_id ? String(f.kryje_id) : '',
            datum_vystav: f.datum_vystav,
            datum_dodania: f.datum_dodania,
            datum_splat: f.datum_splat,
            // Zaplatenosť sa pri uloženej faktúre odvodzuje z platieb (výber stavu nižšie).
            stav: f.stav === 'koncept' ? 'koncept' : 'vystavena',
            datum_uhrady: f.datum_uhrady ?? '',
            variabilny: f.variabilny,
            poznamka: f.poznamka,
            polozky: f.polozky?.length ? f.polozky : [{ ...PRAZDNA_POLOZKA }],
            platby: f.platby ?? [],
            s_dph: !!f.s_dph,
            prenos_dph: !!f.prenos_dph,
            cislo_objednavky: f.cislo_objednavky ?? '',
            uvodny_text: f.uvodny_text ?? '',
          })
        })
        .catch((e) => setChyba(e.message))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, novaFaktura])

  if (chyba && !form) return <div className="chyba">{chyba}</div>
  if (!form) return <div className="nacitava">Načítavam…</div>

  const uprav = (zmeny: Partial<Formular>) => setForm({ ...form, ...zmeny })

  const upravPolozku = (i: number, zmeny: Partial<Polozka>) => {
    const p = [...form.polozky]
    p[i] = { ...p[i], ...zmeny }
    uprav({ polozky: p })
  }

  // Rovnaký výpočet ako na serveri a v PDF – súčet na obrazovke sedí do centa.
  const sDph = form.s_dph && !form.prenos_dph
  const sucty = spocitajFakturu(form.polozky, sDph)
  const celkom = sucty.suma
  const novaPolozka = (): Polozka => ({ ...PRAZDNA_POLOZKA, sadzba_dph: form.s_dph ? dph.sadzba : null })
  const ponukaPrenos = dph.rezim !== 'neplatitel' || form.prenos_dph
  const vybranaFirma = firmy.find((f) => String(f.id) === form.company_id)
  const viacUdajovOtvorene =
    viacUdajov ?? (form.typ === 'zaloha' || !!form.order_id || !!form.cislo_objednavky || !!form.uvodny_text)
  // Nová faktúra s prázdnou položkou ju má rovno otvorenú na vyplnenie.
  const upravovanaPolozka =
    otvorenaPolozka ?? (novaFaktura && form.polozky.length === 1 && !form.polozky[0].popis ? 0 : -1)
  const prijate = form.platby.reduce((s, p) => s + (Number(p.suma) || 0), 0)
  // Peniaze, ktoré na túto faktúru prišli cez zálohové faktúry kryjúce ten
  // istý dlh. V príjmoch figurujú pod ich číslami, ale tento dlh umorujú tiež.
  const zoZaloh = kryteZalohami.reduce((s, z) => s + (Number(z.prijate) || 0), 0)
  const zostatok = Math.round((celkom - prijate - zoZaloh) * 100) / 100

  /**
   * Stav vo výbere. Pri uloženej faktúre sa „zaplatená" odvodzuje z platieb –
   * inak by výber tvrdil niečo iné než tabuľka platieb pod ním.
   */
  const stavVoVybere: Stav =
    form.stav === 'koncept' || novaFaktura ? form.stav : celkom > 0 && zostatok <= 0.005 ? 'zaplatena' : 'vystavena'

  async function zmenStav(novy: Stav) {
    if (novaFaktura || novy === 'koncept') return uprav({ stav: novy })
    if (novy === 'zaplatena') {
      // Čo chýba, zapíšeme ako platbu s dnešným dátumom – dá sa hneď upraviť v tabuľke platieb.
      if (zostatok <= 0.005) return uprav({ stav: 'vystavena' })
      return uprav({
        stav: 'vystavena',
        platby: [
          ...form!.platby,
          { id: 0, invoice_id: Number(id), datum: dnesISO(), suma: zostatok, poznamka: 'doplatok' },
        ],
      })
    }
    // Späť na „vystavená": zapísané platby treba odstrániť, inak by ostala zaplatená.
    if (stavVoVybere === 'zaplatena' && form!.platby.length) {
      const ano = await potvrd({
        nadpis: 'Zrušiť úhradu?',
        text: 'Zapísané platby sa z faktúry odstránia. Natrvalo až po uložení zmien.',
        potvrdit: 'Zrušiť úhradu',
        nebezpecne: true,
      })
      if (!ano) return
      return uprav({ stav: 'vystavena', platby: [] })
    }
    uprav({ stav: 'vystavena' })
  }

  const upravPlatbu = (i: number, z: Partial<PlatbaFaktury>) =>
    uprav({ platby: form.platby.map((p, j) => (j === i ? { ...p, ...z } : p)) })

  /** Nová platba sa predvyplní na zvyšok, ktorý ešte chýba. */
  function pridajPlatbu() {
    uprav({
      platby: [
        ...form!.platby,
        {
          id: 0,
          invoice_id: Number(id),
          // Miestny dátum – toISOString by medzi polnocou a 2:00 dal včerajšok.
          datum: dnesISO(),
          suma: Math.max(0, zostatok),
          poznamka: '',
        },
      ],
    })
  }

  // Splatnosť sa dá zadať dvomi spôsobmi: počtom dní alebo konkrétnym dátumom.
  // Ak dátum zodpovedá niektorej z bežných lehôt, ukážeme ju v rozbaľovacom zozname.
  // Aj netypickú lehotu (napr. 37 dní) ukážeme ako číslo – pole je na to,
  // aby si tam človek mohol svoje číslo rovno napísať.
  const maDatumy = !!form.datum_vystav && !!form.datum_splat
  const kalendarnych = maDatumy ? kalendarnychDniMedzi(form.datum_vystav, form.datum_splat) : null
  const dniSplatnosti = !maDatumy
    ? null
    : pracovneDni
      ? pracovnychDniMedzi(form.datum_vystav, form.datum_splat)
      : kalendarnych

  /** Posun dátumu v zvolenom režime – kalendárne alebo pracovné dni. */
  const posun = (datum: string, dni: number, vPracovnych = pracovneDni) =>
    vPracovnych ? pridajPracovneDni(datum, dni) : pridajDni(datum, dni)

  function zmenSplatnost(hodnota: string) {
    const dni = Number(hodnota)
    if (!Number.isFinite(dni) || hodnota.trim() === '') return
    uprav({ datum_splat: posun(form!.datum_vystav, Math.round(dni)) })
  }

  /** Pri zmene vystavenia posunieme aj splatnosť, nech drží rovnakú lehotu. */
  function zmenDatumVystavenia(datum: string) {
    if (dniSplatnosti !== null && datum) {
      uprav({ datum_vystav: datum, datum_splat: posun(datum, dniSplatnosti) })
    } else {
      uprav({ datum_vystav: datum })
    }
  }

  /**
   * Prepnutie kalendárne ↔ pracovné dni. Číslo lehoty ostáva, posunie sa
   * dátum – „14 dní" znamená po prepnutí „14 pracovných dní".
   */
  function prepniPracovneDni() {
    const nove = !pracovneDni
    setPracovneDni(nove)
    if (dniSplatnosti !== null && dniSplatnosti >= 0) {
      uprav({ datum_splat: posun(form!.datum_vystav, dniSplatnosti, nove) })
    }
  }

  // Keď je vybraný turnus, ponúkame len jeho objednávky – inak sa dá ľahko kliknúť vedľa.
  const objednavkyNaVyber = form.tour_id
    ? objednavky.filter((o) => String(o.tour_id) === form.tour_id)
    : objednavky

  function vyberTurnus(tourId: string) {
    const t = turnusy.find((x) => String(x.id) === tourId)
    const objednavkaPatri = objednavky.some((o) => String(o.id) === form!.order_id && String(o.tour_id) === tourId)
    uprav({
      tour_id: tourId,
      order_id: objednavkaPatri ? form!.order_id : '',
      company_id: !form!.company_id && t?.company_id ? String(t.company_id) : form!.company_id,
    })
  }

  function vyberObjednavku(orderId: string) {
    const o = objednavky.find((x) => String(x.id) === orderId)
    uprav({
      order_id: orderId,
      tour_id: o?.tour_id ? String(o.tour_id) : form!.tour_id,
      company_id: o?.company_id ? String(o.company_id) : form!.company_id,
    })
  }

  /** Doplní položky (a odberateľa) zo šablóny. */
  function pouziSablonu(sablonaId: string) {
    const s = sablony.find((x) => String(x.id) === sablonaId)
    if (!s) return
    uprav({
      polozky: s.polozky.length
        ? s.polozky.map((p) => ({ ...p, sadzba_dph: form!.s_dph ? (p.sadzba_dph ?? dph.sadzba) : null }))
        : [novaPolozka()],
      company_id: s.company_id ? String(s.company_id) : form!.company_id,
      poznamka: s.poznamka || form!.poznamka,
    })
  }

  async function ulozAkoSablonu() {
    const nazov = prompt('Názov šablóny:', `${form!.cislo} – vzor`)
    if (!nazov) return
    try {
      await api.post(`/sablony/z-faktury/${id}`, { nazov })
      setSprava(`Šablóna „${nazov}" je uložená.`)
      setTimeout(() => setSprava(''), 4000)
      api.get<Sablona[]>('/sablony').then(setSablony).catch(() => {})
    api
      .get<{ nevyplatene: Faktura[] }>('/faktury/prehlad/dlhy')
      .then((d) => setNevyplatene(d.nevyplatene))
      .catch(() => {})
    } catch (e: any) {
      setChyba(e.message)
    }
  }

  async function uloz() {
    setChyba('')
    setUklada(true)
    try {
      const telo = {
        ...form,
        company_id: form!.company_id || null,
        tour_id: form!.tour_id || null,
        order_id: form!.order_id || null,
      }
      if (novaFaktura) await api.post<{ id: number }>('/faktury', telo)
      else await api.put('/faktury/' + id, telo)
      oznacUlozene()
      navigate('/faktury')
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setUklada(false)
    }
  }

  return (
    <>
      <div className="hlavicka">
        <div className="nadpis-faktury">
          <span className="nadpis-faktury-druh">
            {novaFaktura ? 'Nová ' : ''}
            {form.typ === 'zaloha' ? (novaFaktura ? 'zálohová faktúra' : 'Zálohová faktúra') : novaFaktura ? 'faktúra' : 'Faktúra'}
          </span>
          <h1>{form.cislo || 'bez čísla'}</h1>
        </div>
        <div className="akcie">
          {male ? (
            // Na telefóne sú menej časté akcie v ponuke ⋮ – hlavička ostane v jednom riadku.
            !novaFaktura && (
              <MenuAkcii
                popis="Ďalšie akcie s faktúrou"
                akcie={[
                  { text: 'Zobraziť PDF', ikona: 'pdf', href: `/api/faktury/${id}/pdf` },
                  { text: 'Poslať e-mailom', ikona: 'mail', sprav: () => setPosielam(true) },
                  { text: 'Uložiť ako šablónu', ikona: 'subor', sprav: ulozAkoSablonu },
                ]}
              />
            )
          ) : (
            <>
              {!novaFaktura && (
                <>
                  <button onClick={() => setPosielam(true)}>Poslať e-mailom</button>
                  <button onClick={ulozAkoSablonu}>Uložiť ako šablónu</button>
                  <a className="tlacidlo" href={`/api/faktury/${id}/pdf`} target="_blank" rel="noreferrer">
                    Zobraziť PDF
                  </a>
                </>
              )}
            </>
          )}
          <Link className="tlacidlo" to="/faktury">
            Späť
          </Link>
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}
      {sprava && <div className="uspech">{sprava}</div>}

      {novaFaktura && sablony.length > 0 && (
        <div className="panel">
          <label>Použiť šablónu</label>
          <select defaultValue="" onChange={(e) => pouziSablonu(e.target.value)} style={{ maxWidth: 420 }}>
            <option value="">— začať naprázdno —</option>
            {sablony.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nazov}
                {s.firma_nazov ? ` · ${s.firma_nazov}` : ''}
              </option>
            ))}
          </select>
          <div className="napoveda">Predvyplní položky aj odberateľa. Dátumy a číslo sa generujú nanovo.</div>
        </div>
      )}

      <div className="panel">
        <h2>Základné údaje</h2>
        <div className="mriezka mriezka-faktury">
          <div className="pole-siroke">
            <label htmlFor="odberatel-faktury">Odberateľ</label>
            <select
              id="odberatel-faktury"
              value={form.company_id}
              onChange={(e) => {
                const firma = firmy.find((f) => String(f.id) === e.target.value)
                // Firme z inej krajiny EÚ s IČ DPH appka rovno navrhne prenesenie daňovej povinnosti.
                uprav({
                  company_id: e.target.value,
                  prenos_dph: dph.rezim !== 'neplatitel' ? zahranicnaSIcDph(firma) : form.prenos_dph,
                })
              }}
            >
              <option value="">— vyber firmu —</option>
              {firmy.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nazov}
                </option>
              ))}
            </select>
            {vybranaFirma && (
              <div className="suhrn-firmy">
                {[
                  [vybranaFirma.adresa, vybranaFirma.psc_mesto, vybranaFirma.krajina].filter(Boolean).join(', '),
                  vybranaFirma.ico && `IČO ${vybranaFirma.ico}`,
                  vybranaFirma.ic_dph && `IČ DPH ${vybranaFirma.ic_dph}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Adresa firmy zatiaľ chýba.'}
              </div>
            )}
            <button type="button" className="odkaz-tlacidlo" onClick={() => setOkno('odberatel')}>
              {vybranaFirma ? 'Viac údajov' : '+ Nová firma'}
            </button>
          </div>
          <div className="pole-siroke">
            <div className="popis-pola">Dodávateľ</div>
            <div className="meno-strany">{mojaFirma?.meno || <span className="tlmene">zatiaľ bez mena</span>}</div>
            {mojaFirma && (
              <div className="suhrn-firmy">
                {[
                  [mojaFirma.adresa, mojaFirma.psc_mesto].filter(Boolean).join(', '),
                  mojaFirma.ico && `IČO ${mojaFirma.ico}`,
                  mojaFirma.dph_rezim === 'platitel'
                    ? `IČ DPH ${mojaFirma.ic_dph}`
                    : mojaFirma.dph_rezim === '7a'
                      ? 'registrácia podľa § 7a'
                      : 'nie je platiteľ DPH',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
            <button type="button" className="odkaz-tlacidlo" onClick={() => setOkno('dodavatel')}>
              Viac údajov
            </button>
          </div>
          <div>
            <label htmlFor="datum-vystavenia">Dátum vystavenia</label>
            <input
              id="datum-vystavenia"
              type="date"
              value={form.datum_vystav}
              onChange={(e) => zmenDatumVystavenia(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="variabilny-symbol">Variabilný symbol</label>
            <input
              id="variabilny-symbol"
              value={form.variabilny}
              placeholder="z čísla faktúry"
              onChange={(e) => uprav({ variabilny: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="datum-dodania">Dátum dodania</label>
            <input
              id="datum-dodania"
              type="date"
              value={form.datum_dodania}
              onChange={(e) => uprav({ datum_dodania: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="stav-faktury">Stav</label>
            <select id="stav-faktury" value={stavVoVybere} onChange={(e) => zmenStav(e.target.value as Stav)}>
              <option value="koncept">Koncept</option>
              <option value="vystavena">Vystavená</option>
              <option value="zaplatena">Uhradená</option>
            </select>
          </div>
          <div className="pole-splatnosti">
            <div className="popis-s-prepinacom">
              <label htmlFor="dni-splatnosti">Splatnosť</label>
              <button
                type="button"
                className={'mini-prepinac' + (pracovneDni ? ' zapnuty' : '')}
                aria-pressed={pracovneDni}
                title="Počítať splatnosť len v pracovných dňoch – bez víkendov a sviatkov"
                onClick={prepniPracovneDni}
              >
                <span className="mini-prepinac-draha" aria-hidden="true" />
                pracovné
              </button>
            </div>
            {/* Splatnosť dvomi spôsobmi naraz: počet dní a konkrétny dátum – zmena jedného posunie druhé. */}
            <div className="splatnost-riadok">
              <input
                id="dni-splatnosti"
                className="dni-splatnosti"
                type="number"
                min={0}
                max={365}
                step={1}
                list="bezne-lehoty"
                aria-label={pracovneDni ? 'Splatnosť v pracovných dňoch' : 'Splatnosť v dňoch'}
                value={dniSplatnosti ?? ''}
                onChange={(e) => zmenSplatnost(e.target.value)}
              />
              <span className="splatnost-dni-popis">{pracovneDni ? 'prac. dní' : 'dní'}</span>
              <input
                type="date"
                aria-label="Dátum splatnosti"
                value={form.datum_splat}
                onChange={(e) => uprav({ datum_splat: e.target.value })}
              />
            </div>
            <datalist id="bezne-lehoty">
              {DNI_SPLATNOSTI.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            {dniSplatnosti !== null && kalendarnych !== null && kalendarnych < 0 ? (
              <div className="napoveda chybna">
                Splatnosť je {pocet(-kalendarnych, ['deň', 'dni', 'dní'])} pred dátumom vystavenia – skontroluj ju.
              </div>
            ) : (
              pracovneDni &&
              dniSplatnosti !== null && (
                <div className="napoveda">
                  Bez víkendov a sviatkov – {pocet(kalendarnych ?? 0, ['kalendárny deň', 'kalendárne dni', 'kalendárnych dní'])}.
                </div>
              )
            )}
          </div>
          <div className="pole-siroke">
            <label htmlFor="turnus-faktury">Turnus</label>
            <select id="turnus-faktury" value={form.tour_id} onChange={(e) => vyberTurnus(e.target.value)}>
              <option value="">— bez turnusu —</option>
              {turnusy.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nazov} ({skDatum(t.datum_od)} – {skDatum(t.datum_do)})
                </option>
              ))}
            </select>
          </div>
          {novaFaktura && form.stav === 'zaplatena' && (
            <div>
              <label htmlFor="datum-uhrady">Dátum úhrady</label>
              <input
                id="datum-uhrady"
                type="date"
                value={form.datum_uhrady}
                onChange={(e) => uprav({ datum_uhrady: e.target.value })}
              />
            </div>
          )}
        </div>

        {/* Menej časté údaje – ako „Viac údajov" v bežných fakturačných appkách. */}
        <details className="viac-udajov" open={viacUdajovOtvorene} onToggle={(e) => setViacUdajov(e.currentTarget.open)}>
          <summary>
            Viac údajov
            <span className="tlmene">číslo faktúry, typ dokladu, objednávka, texty na faktúre</span>
          </summary>
          <div className="mriezka mriezka-faktury">
            <div>
              <label htmlFor="cislo-faktury">Číslo faktúry</label>
              <input id="cislo-faktury" value={form.cislo} onChange={(e) => uprav({ cislo: e.target.value })} />
            </div>
            <div>
              <label htmlFor="typ-dokladu">Typ dokladu</label>
              <select
                id="typ-dokladu"
                value={form.typ}
                onChange={(e) => uprav({ typ: e.target.value as TypDokladu, kryje_id: '' })}
              >
                <option value="faktura">Faktúra</option>
                <option value="zaloha">Zálohová faktúra</option>
              </select>
            </div>
            {form.typ === 'zaloha' && (
              <div className="pole-siroke">
                <label htmlFor="splatka">Splátka staršej faktúry</label>
                <select id="splatka" value={form.kryje_id} onChange={(e) => uprav({ kryje_id: e.target.value })}>
                  <option value="">— nie je splátkou inej faktúry —</option>
                  {krytaFaktura &&
                    !nevyplatene.some((n) => n.id === krytaFaktura.id) && (
                      <option value={krytaFaktura.id}>{krytaFaktura.cislo} · už uhradená</option>
                    )}
                  {nevyplatene
                    .filter((n) => String(n.id) !== id)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.cislo} · dlhujú {skSuma(n.otvoreny_zostatok)}
                        {n.firma_nazov ? ` · ${n.firma_nazov}` : ''}
                      </option>
                    ))}
                </select>
                <div className="napoveda">
                  Suma tejto zálohovej faktúry zníži dlh na pôvodnej faktúre. Do príjmov sa započíta len raz – keď
                  platba skutočne príde.
                </div>
              </div>
            )}
            <div className="pole-siroke">
              <label htmlFor="objednavka-faktury">Objednávka</label>
              <select id="objednavka-faktury" value={form.order_id} onChange={(e) => vyberObjednavku(e.target.value)}>
                <option value="">— bez objednávky —</option>
                {objednavkyNaVyber.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.cislo || o.popis || 'bez čísla'}
                    {o.suma > 0 ? ` · ${skSuma(o.suma)}` : ''}
                  </option>
                ))}
              </select>
              {form.tour_id && objednavkyNaVyber.length === 0 && (
                <div className="napoveda">Vybraný turnus nemá žiadnu objednávku.</div>
              )}
            </div>
            <div className="pole-siroke">
              <label htmlFor="cislo-objednavky">Číslo objednávky odberateľa</label>
              <input
                id="cislo-objednavky"
                value={form.cislo_objednavky}
                placeholder="ak ho odberateľ chce na faktúre"
                onChange={(e) => uprav({ cislo_objednavky: e.target.value })}
              />
            </div>
            <div className="pole-siroke">
              <label htmlFor="uvodny-text">Úvodný text</label>
              <textarea
                id="uvodny-text"
                rows={2}
                value={form.uvodny_text}
                placeholder="nad položkami, napr. Fakturujeme vám za práce podľa objednávky."
                onChange={(e) => uprav({ uvodny_text: e.target.value })}
              />
            </div>
            <div className="pole-siroke">
              <label htmlFor="zaverecny-text">Záverečný text (poznámka)</label>
              <textarea
                id="zaverecny-text"
                rows={2}
                value={form.poznamka}
                placeholder="pod súčtom, napr. Ďakujem za spoluprácu."
                onChange={(e) => uprav({ poznamka: e.target.value })}
              />
            </div>
          </div>
        </details>
      </div>

      <div className="panel">
        <h2>Položky</h2>
        {ponukaPrenos && (
          <div className="prenos-dph">
            <label className="zaskrtavacie" style={{ marginTop: 0 }}>
              <input type="checkbox" checked={form.prenos_dph} onChange={(e) => uprav({ prenos_dph: e.target.checked })} />
              Prenesenie daňovej povinnosti – DPH odvedie odberateľ
            </label>
            <div className="napoveda">
              Pri službách pre firmu z inej krajiny EÚ a pri stavebných prácach pre platiteľa DPH na Slovensku. Faktúra
              bude bez DPH a s vetou „Prenesenie daňovej povinnosti".
            </div>
          </div>
        )}
        {male ? (
          <div className="polozky-zoznam">
            {form.polozky.map((p, i) =>
              upravovanaPolozka === i ? (
                <div key={i} className="polozka-editor">
                  <div>
                    <label htmlFor={`popis-polozky-${i}`}>Popis</label>
                    <input
                      id={`popis-polozky-${i}`}
                      value={p.popis}
                      placeholder="napr. Montážne práce – turnus marec"
                      onChange={(e) => upravPolozku(i, { popis: e.target.value })}
                    />
                  </div>
                  <div className="polozka-editor-riadok">
                    <div>
                      <label htmlFor={`mnozstvo-polozky-${i}`}>Množstvo</label>
                      <input
                        id={`mnozstvo-polozky-${i}`}
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={p.mnozstvo}
                        onChange={(e) => upravPolozku(i, { mnozstvo: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label htmlFor={`jednotka-polozky-${i}`}>Jednotka</label>
                      <input
                        id={`jednotka-polozky-${i}`}
                        value={p.jednotka}
                        onChange={(e) => upravPolozku(i, { jednotka: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="polozka-editor-riadok">
                    <div>
                      <label htmlFor={`cena-polozky-${i}`}>{sDph ? 'Cena bez DPH (€)' : 'Cena za jednotku (€)'}</label>
                      <input
                        id={`cena-polozky-${i}`}
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        value={p.cena}
                        onChange={(e) => upravPolozku(i, { cena: Number(e.target.value) })}
                      />
                    </div>
                    {sDph && (
                      <div>
                        <label htmlFor={`dph-polozky-${i}`}>DPH</label>
                        <select
                          id={`dph-polozky-${i}`}
                          value={p.sadzba_dph ?? dph.sadzba}
                          onChange={(e) => upravPolozku(i, { sadzba_dph: Number(e.target.value) })}
                        >
                          {SADZBY_DPH.map((s) => (
                            <option key={s} value={s}>
                              {s} %
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="polozka-editor-akcie">
                    {form.polozky.length > 1 && (
                      <button
                        type="button"
                        className="holy zmazat"
                        onClick={() => {
                          uprav({ polozky: form.polozky.filter((_, j) => j !== i) })
                          setOtvorenaPolozka(-1)
                        }}
                      >
                        <Ikona nazov="zmazat" velkost={15} /> Odstrániť
                      </button>
                    )}
                    <span className="polozka-editor-spolu">
                      spolu <strong>{skSuma(Math.round(p.mnozstvo * p.cena * 100) / 100)}</strong>
                    </span>
                    <button type="button" className="primar" onClick={() => setOtvorenaPolozka(-1)}>
                      Hotovo
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={i}
                  className="polozka-riadok"
                  role="button"
                  tabIndex={0}
                  onClick={() => setOtvorenaPolozka(i)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOtvorenaPolozka(i)}
                >
                  <span className="polozka-nazov">{p.popis || <span className="tlmene">Bez popisu – ťukni a vyplň</span>}</span>
                  <span className="polozka-suma">{skSuma(Math.round(p.mnozstvo * p.cena * 100) / 100)}</span>
                  <span className="polozka-detail">
                    {new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 3 }).format(p.mnozstvo)} {p.jednotka} ×{' '}
                    {skSuma(p.cena)}
                    {sDph ? ` · DPH ${p.sadzba_dph ?? dph.sadzba} %` : ''}
                  </span>
                </div>
              ),
            )}
          </div>
        ) : (
        <table>
          <thead>
            <tr>
              <th>Popis</th>
              <th style={{ width: 100 }} className="cislo">
                Množstvo
              </th>
              <th style={{ width: 80 }}>MJ</th>
              <th style={{ width: 120 }} className="cislo">
                {sDph ? 'Cena bez DPH (€)' : 'Cena/MJ (€)'}
              </th>
              {sDph && <th style={{ width: 118 }}>DPH</th>}
              <th style={{ width: 120 }} className="cislo">
                {sDph ? 'Spolu bez DPH' : 'Spolu'}
              </th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {form.polozky.map((p, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={p.popis}
                    placeholder="napr. Montážne práce – turnus marec"
                    onChange={(e) => upravPolozku(i, { popis: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    style={{ textAlign: 'right' }}
                    value={p.mnozstvo}
                    onChange={(e) => upravPolozku(i, { mnozstvo: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input value={p.jednotka} onChange={(e) => upravPolozku(i, { jednotka: e.target.value })} />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    style={{ textAlign: 'right' }}
                    value={p.cena}
                    onChange={(e) => upravPolozku(i, { cena: Number(e.target.value) })}
                  />
                </td>
                {sDph && (
                  <td>
                    <select
                      aria-label={`Sadzba DPH položky ${i + 1}`}
                      value={p.sadzba_dph ?? dph.sadzba}
                      onChange={(e) => upravPolozku(i, { sadzba_dph: Number(e.target.value) })}
                    >
                      {SADZBY_DPH.map((s) => (
                        <option key={s} value={s}>
                          {s} %
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                <td className="cislo">{skSuma(Math.round(p.mnozstvo * p.cena * 100) / 100)}</td>
                <td>
                  {form.polozky.length > 1 && (
                    <button
                      className="ikonove maly holy"
                      title="Odstrániť položku"
                      onClick={() => uprav({ polozky: form.polozky.filter((_, j) => j !== i) })}
                    >
                      <Ikona nazov="zavriet" velkost={14} hrubka={2} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}

        <div className="polozky-pata">
          <button
            className="pridat-polozku"
            onClick={() => {
              uprav({ polozky: [...form.polozky, novaPolozka()] })
              setOtvorenaPolozka(form.polozky.length)
            }}
          >
            <Ikona nazov="plus" velkost={16} hrubka={2.2} /> Pridať položku
          </button>
          {sDph ? (
            <div className="sucty-dph">
              {sucty.rekapitulacia.map((r) => (
                <div key={r.sadzba} className="tlmene">
                  základ {r.sadzba} % {skSuma(r.zaklad)} · DPH {skSuma(r.dph)}
                </div>
              ))}
              <div>
                Bez DPH {skSuma(sucty.zaklad)} · DPH {skSuma(sucty.dph)}
              </div>
              <div style={{ fontSize: 18, fontWeight: 680 }}>Celkom s DPH: {skSuma(celkom)}</div>
            </div>
          ) : (
            <div style={{ fontSize: 18, fontWeight: 680 }}>Celkom: {skSuma(celkom)}</div>
          )}
        </div>
      </div>

      {!novaFaktura && ulozena && <CasovaOs f={ulozena} />}

      {!novaFaktura && (
        <div className="panel">
          <h2>Prijaté platby</h2>
          {form.platby.length === 0 ? (
            <p className="tlmene" style={{ marginTop: 0 }}>
              Zatiaľ neprišla žiadna platba.
            </p>
          ) : (
            <table style={{ marginBottom: 14 }}>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Dátum prijatia</th>
                  <th style={{ width: 150 }} className="cislo">Suma</th>
                  <th>Poznámka</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {form.platby.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="date"
                        value={p.datum}
                        onChange={(e) => upravPlatbu(i, { datum: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        style={{ textAlign: 'right' }}
                        value={p.suma}
                        onChange={(e) => upravPlatbu(i, { suma: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input value={p.poznamka} onChange={(e) => upravPlatbu(i, { poznamka: e.target.value })} />
                    </td>
                    <td>
                      <button
                        className="ikonove maly holy"
                        title="Odstrániť platbu"
                        onClick={() => uprav({ platby: form.platby.filter((_, j) => j !== i) })}
                      >
                        <Ikona nazov="zavriet" velkost={14} hrubka={2} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {kryteZalohami.length > 0 && (
            <div className="info-pruh" style={{ marginTop: 0, marginBottom: 14 }}>
              Túto faktúru {kryteZalohami.length === 1 ? 'spláca zálohová faktúra' : 'splácajú zálohové faktúry'}{' '}
              {kryteZalohami.map((z, i) => (
                <span key={z.id}>
                  {i > 0 && ', '}
                  <Link to={'/faktury/' + z.id}>{z.cislo}</Link> ({skSuma(z.suma)},{' '}
                  {z.prijate > 0.005 ? `prijaté ${skSuma(z.prijate)}` : 'zatiaľ neprišla'})
                </span>
              ))}
              . Spolu už takto prišlo <strong>{skSuma(zoZaloh)}</strong> – v príjmoch sú tieto sumy vedené pod
              číslami zálohových faktúr, preto sa sem druhýkrát nezapisujú.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <button onClick={pridajPlatbu}>+ Zapísať platbu</button>
            <div style={{ fontSize: 15 }}>
              Prijaté <strong>{skSuma(prijate + zoZaloh)}</strong> z {skSuma(celkom)} ·{' '}
              {zostatok > 0.005 ? (
                <span style={{ color: 'var(--cervena)', fontWeight: 650 }}>zostáva {skSuma(zostatok)}</span>
              ) : zostatok < -0.005 ? (
                <span style={{ color: 'var(--zelena)', fontWeight: 650 }}>
                  uhradené, preplatok {skSuma(-zostatok)}
                </span>
              ) : (
                <span style={{ color: 'var(--zelena)', fontWeight: 650 }}>uhradené</span>
              )}
            </div>
          </div>
          <div className="napoveda" style={{ marginTop: 8 }}>
            Do príjmov sa počíta dátum, kedy peniaze prišli na účet – nie dátum vystavenia faktúry.
          </div>
        </div>
      )}

      {okno === 'odberatel' && (
        <OknoOdberatela
          firma={vybranaFirma ?? null}
          zavriet={() => setOkno('')}
          ulozene={(f) => {
            setOkno('')
            api.get<Firma[]>('/firmy').then(setFirmy).catch(() => {})
            uprav({
              company_id: String(f.id),
              prenos_dph: dph.rezim !== 'neplatitel' ? zahranicnaSIcDph(f) : form.prenos_dph,
            })
            oznam(vybranaFirma ? `Údaje firmy ${f.nazov} sú uložené.` : `Firma ${f.nazov} je pridaná a vybraná.`)
          }}
        />
      )}
      {okno === 'dodavatel' && mojaFirma && (
        <OknoDodavatela
          nastavenia={mojaFirma}
          zavriet={() => setOkno('')}
          ulozene={(n) => {
            setOkno('')
            setMojaFirma(n)
            setDph({ rezim: n.dph_rezim ?? 'neplatitel', sadzba: n.dph_sadzba ?? 23 })
            oznam('Tvoje údaje sú uložené v Nastaveniach.')
          }}
        />
      )}

      {posielam && id && (
        <OdoslatMail invoiceId={Number(id)} typ="faktura" zavriet={() => setPosielam(false)} />
      )}

      {/* Na telefóne ostáva Uložiť stále po ruke nad spodnou lištou. */}
      <div className="riadok-akcii lepkave-akcie">
        <Link className="tlacidlo" to="/faktury">
          Zrušiť
        </Link>
        <button className="primar" onClick={uloz} disabled={uklada}>
          {uklada ? 'Ukladám…' : novaFaktura ? 'Vytvoriť faktúru' : 'Uložiť zmeny'}
        </button>
      </div>
    </>
  )
}
