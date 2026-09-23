import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  api, dnesISO, pocet, skDatum, skSuma,
  type Faktura, type Firma, type Objednavka, type PlatbaFaktury, type Polozka, type Sablona,
  type Stav, type Turnus, type TypDokladu,
} from '../api'
import { OdoslatMail } from '../components/OdoslatMail'
import { pracovnychDniMedzi, pridajPracovneDni } from '../../../server/lib/pracovneDni'
import { Ikona } from '../components/Ikony'
import { useNeulozeneZmeny } from '../neulozene'
import { potvrd } from '../components/Oznamenia'

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
}

const PRAZDNA_POLOZKA: Polozka = { popis: '', mnozstvo: 1, jednotka: 'ks', cena: 0 }

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
  const oznacUlozene = useNeulozeneZmeny(form, id ?? 'nova')

  useEffect(() => {
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
          splatnost_pracovne: boolean
        }>('/faktury/nova'),
        zObjednavky ? api.get<Objednavka>('/objednavky/' + zObjednavky) : Promise.resolve(null),
        zTurnusu ? api.get<Turnus>('/turnusy/' + zTurnusu) : Promise.resolve(null),
      ])
        .then(([n, o, t]) => {
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
          const { splatnost_pracovne, ...navrh } = n
          setPracovneDni(splatnost_pracovne)
          setForm({
            ...navrh,
            company_id: String(o?.company_id ?? t?.company_id ?? ''),
            tour_id: String(o?.tour_id ?? t?.id ?? ''),
            order_id: zObjednavky,
            typ: (hladane.get('typ') as TypDokladu) === 'zaloha' ? 'zaloha' : 'faktura',
            kryje_id: hladane.get('kryje') ?? '',
            stav: 'vystavena',
            datum_uhrady: '',
            variabilny: '',
            poznamka: '',
            polozky: [polozka ?? { ...PRAZDNA_POLOZKA }],
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

  const celkom = form.polozky.reduce((s, p) => s + Math.round(p.mnozstvo * p.cena * 100) / 100, 0)
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
      polozky: s.polozky.length ? s.polozky.map((p) => ({ ...p })) : [{ ...PRAZDNA_POLOZKA }],
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
        <h1>{novaFaktura ? 'Nová faktúra' : `Faktúra ${form.cislo}`}</h1>
        <div className="akcie">
          {!novaFaktura && (
            <>
              <button onClick={() => setPosielam(true)}>Poslať mailom</button>
              <button onClick={ulozAkoSablonu}>Uložiť ako šablónu</button>
            </>
          )}
          {!novaFaktura && (
            <a className="tlacidlo" href={`/api/faktury/${id}/pdf`} target="_blank" rel="noreferrer">
              Zobraziť PDF
            </a>
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
        <div className="mriezka">
          <div>
            <label>Číslo faktúry</label>
            <input value={form.cislo} onChange={(e) => uprav({ cislo: e.target.value })} />
          </div>
          <div>
            <label>Odberateľ</label>
            <select value={form.company_id} onChange={(e) => uprav({ company_id: e.target.value })}>
              <option value="">— vyber firmu —</option>
              {firmy.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nazov}
                </option>
              ))}
            </select>
            {firmy.length === 0 && (
              <div className="napoveda">
                Zatiaľ nemáš žiadnu firmu. <Link to="/firmy">Pridaj ju tu</Link>.
              </div>
            )}
          </div>
          <div>
            <label>Typ dokladu</label>
            <select
              value={form.typ}
              onChange={(e) => uprav({ typ: e.target.value as TypDokladu, kryje_id: '' })}
            >
              <option value="faktura">Faktúra</option>
              <option value="zaloha">Zálohová faktúra</option>
            </select>
          </div>
          {form.typ === 'zaloha' && (
            <div>
              <label>Kryje starú faktúru</label>
              <select value={form.kryje_id} onChange={(e) => uprav({ kryje_id: e.target.value })}>
                <option value="">— nekryje žiadny dlh —</option>
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
                Suma tejto zálohy sa odráta z dlhu na pôvodnej faktúre. Do príjmov sa ráta len raz —
                keď platba reálne príde.
              </div>
            </div>
          )}
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
            <label>Objednávka</label>
            <select value={form.order_id} onChange={(e) => vyberObjednavku(e.target.value)}>
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
          <div>
            <label>Variabilný symbol</label>
            <input
              value={form.variabilny}
              placeholder="doplní sa z čísla faktúry"
              onChange={(e) => uprav({ variabilny: e.target.value })}
            />
          </div>
          <div>
            <label>Dátum vystavenia</label>
            <input type="date" value={form.datum_vystav} onChange={(e) => zmenDatumVystavenia(e.target.value)} />
          </div>
          <div>
            <label>Dátum dodania</label>
            <input type="date" value={form.datum_dodania} onChange={(e) => uprav({ datum_dodania: e.target.value })} />
          </div>
          <div>
            <div className="popis-s-prepinacom">
              <label>Splatnosť ({pracovneDni ? 'pracovné dni' : 'dní'})</label>
              <button
                type="button"
                className={'mini-prepinac' + (pracovneDni ? ' zapnuty' : '')}
                aria-pressed={pracovneDni}
                title="Rátať splatnosť len v pracovných dňoch – bez víkendov a sviatkov"
                onClick={prepniPracovneDni}
              >
                <span className="mini-prepinac-draha" aria-hidden="true" />
                pracovné
              </button>
            </div>
            <input
              type="number"
              min={0}
              max={365}
              step={1}
              list="bezne-lehoty"
              value={dniSplatnosti ?? ''}
              onChange={(e) => zmenSplatnost(e.target.value)}
            />
            <datalist id="bezne-lehoty">
              {DNI_SPLATNOSTI.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            <div className="napoveda">
              {pracovneDni
                ? 'Len pracovné dni — bez víkendov a sviatkov. Predvolené v Nastaveniach.'
                : 'Napíš si vlastný počet dní, alebo vyber z bežných lehôt.'}
            </div>
          </div>
          <div>
            <label>Dátum splatnosti</label>
            <input type="date" value={form.datum_splat} onChange={(e) => uprav({ datum_splat: e.target.value })} />
            {dniSplatnosti !== null && (
              <div className="napoveda">
                {kalendarnych !== null && kalendarnych < 0
                  ? `${-kalendarnych} dní PRED vystavením — to asi nechceš.`
                  : pracovneDni
                    ? `${pocet(dniSplatnosti, ['pracovný deň', 'pracovné dni', 'pracovných dní'])} od vystavenia (${pocet(kalendarnych ?? 0, ['kalendárny', 'kalendárne', 'kalendárnych'])}).`
                    : `${dniSplatnosti} dní od vystavenia.`}
              </div>
            )}
          </div>
          <div>
            <label>Stav</label>
            <select value={stavVoVybere} onChange={(e) => zmenStav(e.target.value as Stav)}>
              <option value="koncept">Koncept</option>
              <option value="vystavena">Vystavená</option>
              <option value="zaplatena">Zaplatená</option>
            </select>
          </div>
          {novaFaktura && form.stav === 'zaplatena' && (
            <div>
              <label>Dátum úhrady</label>
              <input type="date" value={form.datum_uhrady} onChange={(e) => uprav({ datum_uhrady: e.target.value })} />
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Položky</h2>
        <table>
          <thead>
            <tr>
              <th>Popis</th>
              <th style={{ width: 100 }} className="cislo">
                Množstvo
              </th>
              <th style={{ width: 80 }}>MJ</th>
              <th style={{ width: 120 }} className="cislo">
                Cena/MJ (€)
              </th>
              <th style={{ width: 120 }} className="cislo">
                Spolu
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <button onClick={() => uprav({ polozky: [...form.polozky, { ...PRAZDNA_POLOZKA }] })}>+ Pridať položku</button>
          <div style={{ fontSize: 18, fontWeight: 680 }}>Celkom: {skSuma(celkom)}</div>
        </div>
      </div>

      {!novaFaktura && (
        <div className="panel">
          <h2>Prijaté platby</h2>
          {form.platby.length === 0 ? (
            <p className="tlmene" style={{ marginTop: 0 }}>
              Zatiaľ neprišlo nič.
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
              Túto faktúru {kryteZalohami.length === 1 ? 'kryje zálohová faktúra' : 'kryjú zálohové faktúry'}{' '}
              {kryteZalohami.map((z, i) => (
                <span key={z.id}>
                  {i > 0 && ', '}
                  <Link to={'/faktury/' + z.id}>{z.cislo}</Link> ({skSuma(z.suma)},{' '}
                  {z.prijate > 0.005 ? `prijaté ${skSuma(z.prijate)}` : 'zatiaľ neprišla'})
                </span>
              ))}
              . Spolu už týmto spôsobom prišlo <strong>{skSuma(zoZaloh)}</strong> — tie sumy sú v príjmoch
              vedené pod číslami tých záloh, sem sa druhýkrát nezapisujú.
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
            Do príjmov sa počíta dátum, kedy peniaze prišli na účet — nie dátum vystavenia faktúry.
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Poznámka na faktúre</h2>
        <textarea
          value={form.poznamka}
          placeholder="voliteľné — objaví sa dole na PDF"
          onChange={(e) => uprav({ poznamka: e.target.value })}
        />
      </div>

      {posielam && id && (
        <OdoslatMail invoiceId={Number(id)} typ="faktura" zavriet={() => setPosielam(false)} />
      )}

      <div className="riadok-akcii">
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
