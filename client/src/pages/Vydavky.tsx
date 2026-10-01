import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  api, dnesISO, pocet, skDatum, skSuma, sumaVMene, turnusPreDatum, velkostSuboru, vratZKosa,
  KATEGORIE_PRIJMOV, KATEGORIE_VYDAVKOV, MENY, NAZVY_PLATIEB,
  type DruhVydavku, type NahladEfaktury, type Platba, type Priloha, type SuhrnVydavkov, type Turnus, type Vydavok,
} from '../api'
import { Ikona } from '../components/Ikony'
import { FarebnyCip, tonKategorie } from '../components/Farby'
import { MenuAkcii } from '../components/MenuAkcii'
import { oznam, potvrd } from '../components/Oznamenia'
import { PrazdnyStav } from '../components/PrazdnyStav'
import { QrOkno, usePristup } from '../components/PristupZTelefonu'
import { FiltreZoznamu, HladanieSFiltrom, ZaznamRiadok } from '../components/Zoznam'
import { useMaleOkno } from '../maleOkno'
import { useNeulozeneZmeny } from '../neulozene'
import { CisloPole } from '../components/CisloPole'

type Formular = {
  id?: number
  datum: string; popis: string; kategoria: string; suma: number
  /** Súkromný príjem sa vedie tu, ale s podnikaním nemá nič spoločné. */
  druh: DruhVydavku
  /** Prázdne = appka priradí turnus podľa dátumu. `bezTurnusu` to vypne. */
  tour_id: string; bezTurnusu: boolean
  platba: Platba; odpocitat: boolean; poznamka: string
  /** Cudzia mena: `suma` je v eurách, `suma_mena` v mene dokladu. */
  mena: string; suma_mena: number; kurz: number | null
  /** Sumu v eurách zadal človek (napr. podľa výpisu z banky) – kurz ju už neprepíše. */
  sumaRucne: boolean
  doklad_cislo: string; dodavatel_ico: string; variabilny: string
  /** DPH z dokladu – vidí a vypĺňa ju len platiteľ DPH (odpočet). */
  dph: number
}

const PRAZDNY = (druh: DruhVydavku): Formular => ({
  datum: dnesISO(), popis: '', kategoria: '', suma: 0, druh,
  tour_id: '', bezTurnusu: druh === 'prijem', platba: druh === 'prijem' ? 'prevod' : 'karta',
  odpocitat: druh === 'vydavok', poznamka: '',
  mena: 'EUR', suma_mena: 0, kurz: null, sumaRucne: false,
  doklad_cislo: '', dodavatel_ico: '', variabilny: '', dph: 0,
})

const naCenty = (n: number) => Math.round(n * 100) / 100

/** Suma v eurách podľa kurzu – pokiaľ ju človek neprepísal sám. */
function prepocitaj(u: Formular): Formular {
  if (u.mena === 'EUR' || u.sumaRucne || !u.kurz) return u
  return { ...u, suma: naCenty(u.suma_mena / u.kurz) }
}

/**
 * Dve možnosti navyše v rozbaľovacom zozname kategórií. Nie sú to kategórie,
 * ale hľadá sa to na tom istom mieste — „ukáž mi všetko, čo ide do dane"
 * je otázka, ktorú si človek kladie častejšie než hľadanie jednej kategórie.
 */
const PODLA_DANE = { uznatelne: '__uznatelne', neuznatelne: '__neuznatelne' }

const ZALOZKY: { kluc: DruhVydavku; text: string }[] = [
  { kluc: 'vydavok', text: 'Výdavky' },
  { kluc: 'prijem', text: 'Súkromné príjmy' },
]

export function Vydavky() {
  const [druh, setDruh] = useState<DruhVydavku>('vydavok')
  const [vydavky, setVydavky] = useState<Vydavok[] | null>(null)
  const [suhrn, setSuhrn] = useState<SuhrnVydavkov | null>(null)
  const [turnusy, setTurnusy] = useState<Turnus[]>([])
  const [kategorie, setKategorie] = useState<string[]>(KATEGORIE_VYDAVKOV)
  const [uprava, setUprava] = useState<Formular | null>(null)
  const [prilohy, setPrilohy] = useState<Priloha[]>([])
  const [chyba, setChyba] = useState('')
  const [nahrava, setNahrava] = useState(false)
  const [cakajuceSubory, setCakajuceSubory] = useState<File[]>([])
  const [f, setF] = useState({ od: '', do: '', kategoria: '', turnus: '', hladat: '' })
  const vstupSuborov = useRef<HTMLInputElement>(null)
  const vstupFotky = useRef<HTMLInputElement>(null)
  const vstupXml = useRef<HTMLInputElement>(null)
  const [efaktura, setEfaktura] = useState<NahladEfaktury | null>(null)
  const [kurzInfo, setKurzInfo] = useState('')
  /** Pre akú menu a dátum formulár naposledy pýtal kurz – aby ho zbytočne neprepisoval. */
  const kurzPre = useRef('')
  const [pristup] = usePristup()
  const [platitelDph, setPlatitelDph] = useState(false)
  const [qrOkno, setQrOkno] = useState(false)
  /** Formulár otvorený z QR kódu v telefóne – fotoaparát ide na prvé miesto. */
  const [fotoHned, setFotoHned] = useState(false)
  /** „Viac údajov" – null = podľa obsahu (rozbalí sa, keď je v nich niečo nezvyčajné). */
  const [viacUdajov, setViacUdajov] = useState<boolean | null>(null)
  const oznacUlozene = useNeulozeneZmeny(uprava, uprava?.id ?? 'novy')
  const navigate = useNavigate()
  const male = useMaleOkno()
  /** Na telefóne sú dátumy, kategória a turnus schované pod tlačidlom Filter. */
  const [filtreOtvorene, setFiltreOtvorene] = useState(false)
  const aktivnychFiltrov = [f.od, f.do, f.kategoria, f.turnus].filter(Boolean).length
  const formular = useRef<HTMLDivElement>(null)
  /** Formulár je nad zoznamom – po otvorení z karty nižšie by ostal mimo obrazovky. */
  const posunutNaFormular = useRef(false)

  const prijem = druh === 'prijem'

  function nacitaj() {
    const q = new URLSearchParams({ druh })
    for (const [k, v] of Object.entries(f)) {
      if (!v) continue
      // Voľby „podľa dane" sedia v tom istom poli, ale posielajú sa inak.
      if (k === 'kategoria' && v === PODLA_DANE.uznatelne) q.set('uznatelne', '1')
      else if (k === 'kategoria' && v === PODLA_DANE.neuznatelne) q.set('uznatelne', '0')
      else q.set(k, v)
    }
    api.get<Vydavok[]>('/vydavky?' + q).then(setVydavky).catch((e) => setChyba(e.message))

    const obdobie = new URLSearchParams()
    if (f.od) obdobie.set('od', f.od)
    if (f.do) obdobie.set('do', f.do)
    api.get<SuhrnVydavkov>('/vydavky/suhrn?' + obdobie).then(setSuhrn).catch(() => {})

    const zaklad = prijem ? KATEGORIE_PRIJMOV : KATEGORIE_VYDAVKOV
    api
      .get<string[]>('/vydavky/kategorie?druh=' + druh)
      .then((k) => setKategorie([...new Set([...zaklad, ...k])].sort((a, b) => a.localeCompare(b, 'sk'))))
      .catch(() => setKategorie(zaklad))
  }

  useEffect(() => {
    api.get<Turnus[]>('/turnusy').then(setTurnusy).catch(() => {})
    api.get<{ dph_rezim: string }>('/nastavenia').then((n) => setPlatitelDph(n.dph_rezim === 'platitel')).catch(() => {})
  }, [])

  // Z rýchlej akcie na Prehľade prichádzame s ?novy=1 – rovno otvoríme formulár.
  const [parametre, setParametre] = useSearchParams()
  useEffect(() => {
    if (parametre.get('novy') !== '1') return
    otvorNovy(parametre.get('kategoria') ?? '')
    setFotoHned(parametre.get('foto') === '1')
    setParametre({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parametre])

  useEffect(() => {
    const t = setTimeout(nacitaj, f.hladat ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, druh])

  useEffect(() => {
    if (!uprava || !posunutNaFormular.current) return
    posunutNaFormular.current = false
    formular.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [uprava])

  // Kurz ECB pre cudziu menu – vypýta sa pri výbere meny a pri zmene dátumu dokladu.
  useEffect(() => {
    if (!uprava || uprava.mena === 'EUR' || !uprava.datum) return
    const kluc = `${uprava.mena}|${uprava.datum}`
    if (kurzPre.current === kluc) return
    kurzPre.current = kluc
    setKurzInfo('Zisťujem kurz ECB…')
    api
      .get<{ kurz: number; datum_kurzu: string }>(`/vydavky/kurz?mena=${uprava.mena}&datum=${uprava.datum}`)
      .then((k) => {
        if (kurzPre.current !== kluc) return
        setUprava((u) => (u ? prepocitaj({ ...u, kurz: k.kurz }) : u))
        setKurzInfo(`kurz ECB z ${skDatum(k.datum_kurzu)}`)
      })
      .catch((e) => setKurzInfo(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uprava?.mena, uprava?.datum])

  function zmenMenu(mena: string) {
    if (!uprava) return
    // Číslo v poli sumy ostáva – mení sa len to, v akej mene je.
    const cislo = uprava.mena === 'EUR' ? uprava.suma : uprava.suma_mena
    if (mena === 'EUR') setUprava({ ...uprava, mena, suma: cislo, suma_mena: 0, kurz: null, sumaRucne: false })
    else setUprava({ ...uprava, mena, suma_mena: cislo, suma: 0, kurz: null, sumaRucne: false })
  }

  async function nacitajEfakturu(subor: File | undefined) {
    if (!subor) return
    setChyba('')
    try {
      const data = new FormData()
      data.append('subor', subor)
      const r = await api.upload<NahladEfaktury>('/vydavky/efaktura', data)
      kurzPre.current = ''
      setUprava({
        ...PRAZDNY('vydavok'),
        ...r.navrh,
        suma_mena: r.navrh.suma_mena ?? 0,
        tour_id: '',
      })
      setCakajuceSubory([subor])
      setEfaktura(r)
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      if (vstupXml.current) vstupXml.current.value = ''
    }
  }

  // Kým je otvorený QR kód, sledujeme, či z telefónu neprišiel nový záznam.
  useEffect(() => {
    if (!qrOkno) return
    let povodne: number | null = null
    const zisti = () =>
      api
        .get<SuhrnVydavkov>('/vydavky/suhrn')
        .then((s) => {
          const teraz = s.pocet_vydavkov + s.pocet_prijmov
          if (povodne === null) povodne = teraz
          else if (teraz > povodne) {
            setQrOkno(false)
            nacitaj()
            oznam('Výdavok z telefónu je uložený.')
          }
        })
        .catch(() => {})
    zisti()
    const t = setInterval(zisti, 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrOkno])

  function prepni(kluc: DruhVydavku) {
    setDruh(kluc)
    setUprava(null)
    setF({ ...f, kategoria: '', turnus: '' })
  }

  function otvorNovy(kategoria = '') {
    posunutNaFormular.current = true
    setViacUdajov(null)
    setUprava({ ...PRAZDNY(druh), kategoria })
    setFotoHned(false)
    setEfaktura(null)
    kurzPre.current = ''
    setPrilohy([])
    setCakajuceSubory([])
    setChyba('')
  }

  async function otvorUpravu(v: Vydavok) {
    setChyba('')
    const detail = await api.get<Vydavok>('/vydavky/' + v.id)
    setCakajuceSubory([])
    setEfaktura(null)
    const mena = detail.mena || 'EUR'
    const kurz = detail.kurz ?? null
    // Uložený kurz sa pri otvorení nemení – nový sa vypýta až po zmene meny alebo dátumu.
    kurzPre.current = `${mena}|${detail.datum}`
    setKurzInfo(kurz ? 'uložený kurz' : '')
    posunutNaFormular.current = true
    setViacUdajov(null)
    setUprava({
      id: detail.id,
      datum: detail.datum,
      popis: detail.popis,
      kategoria: detail.kategoria,
      suma: detail.suma,
      druh: detail.druh ?? 'vydavok',
      tour_id: detail.tour_id ? String(detail.tour_id) : '',
      bezTurnusu: !detail.tour_id,
      platba: detail.platba,
      odpocitat: detail.odpocitat === 1,
      poznamka: detail.poznamka,
      mena,
      suma_mena: detail.suma_mena ?? 0,
      kurz,
      sumaRucne: mena !== 'EUR' && !!kurz && Math.abs(detail.suma - naCenty((detail.suma_mena ?? 0) / kurz)) > 0.005,
      doklad_cislo: detail.doklad_cislo ?? '',
      dodavatel_ico: detail.dodavatel_ico ?? '',
      variabilny: detail.variabilny ?? '',
      dph: detail.dph ?? 0,
    })
    setPrilohy(detail.prilohy ?? [])
  }

  async function uloz(zavriet: boolean) {
    if (!uprava) return
    setChyba('')
    try {
      const telo = { ...uprava, tour_id: uprava.tour_id || null, bezTurnusu: uprava.bezTurnusu }
      if (uprava.id) {
        await api.put('/vydavky/' + uprava.id, telo)
        oznacUlozene()
        if (zavriet) setUprava(null)
      } else {
        const { id } = await api.post<{ id: number }>('/vydavky', telo)
        // ID si formulár pamätá hneď – keby zlyhalo nahratie dokladu, ďalšie
        // „Uložiť" už len upraví tento výdavok a nevytvorí druhý rovnaký.
        const ulozeny = { ...uprava, id }
        setUprava(zavriet ? null : ulozeny)
        oznacUlozene(ulozeny)
        if (cakajuceSubory.length) {
          const subory = cakajuceSubory
          setCakajuceSubory([])
          try {
            const data = new FormData()
            for (const su of subory) data.append('subory', su)
            const r = await api.upload<{ prilohy: Priloha[] }>(`/vydavky/${id}/subory`, data)
            setPrilohy(r.prilohy)
          } catch (e: any) {
            if (zavriet) setUprava(ulozeny)
            setChyba(`Výdavok je uložený, ale doklad sa nepodarilo nahrať: ${e.message} Skús ho pridať znova.`)
          }
        }
        // Po uložení bez zatvorenia ostávame vo formulári, aby sa dal hneď pripnúť ďalší bloček.
      }
      nacitaj()
    } catch (e: any) {
      setChyba(e.message)
    }
  }

  async function nahrajSubory(subory: File[]) {
    if (!subory.length || !uprava?.id) return
    setNahrava(true)
    try {
      const data = new FormData()
      for (const s of subory) data.append('subory', s)
      const r = await api.upload<{ prilohy: Priloha[] }>(`/vydavky/${uprava.id}/subory`, data)
      setPrilohy(r.prilohy)
      nacitaj()
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setNahrava(false)
    }
  }

  /** Uložený výdavok dostane doklad hneď, nový si ho podrží a nahrá po uložení. */
  function pridajSubory(subory: File[]) {
    if (!subory.length) return
    if (uprava?.id) nahrajSubory(subory)
    else setCakajuceSubory([...cakajuceSubory, ...subory])
  }

  async function zmazDoklad(p: Priloha) {
    const ano = await potvrd({
      nadpis: `Zmazať doklad „${p.nazov}"?`,
      text: 'Súbor sa odstráni z počítača a vrátiť sa nedá.',
      potvrdit: 'Zmazať doklad',
      nebezpecne: true,
    })
    if (!ano) return
    try {
      await api.del('/vydavky/subory/' + p.id)
      setPrilohy(prilohy.filter((x) => x.id !== p.id))
      nacitaj()
    } catch (e: any) {
      setChyba(e.message)
    }
  }

  async function zmaz(v: Vydavok) {
    const co = v.druh === 'prijem' ? 'Súkromný príjem' : 'Výdavok'
    await api.del('/vydavky/' + v.id)
    if (uprava?.id === v.id) setUprava(null)
    nacitaj()
    oznam(`${co} „${v.popis}" je v koši aj s dokladmi.`, {
      text: 'Vrátiť späť',
      sprav: async () => {
        await vratZKosa('expenses', v.id)
        nacitaj()
      },
    })
  }

  const spolu = vydavky?.reduce((s, v) => s + v.suma, 0) ?? 0
  const uznatelneVZozname = vydavky?.reduce((s, v) => (v.odpocitat ? s + v.suma : s), 0) ?? 0

  // Keď používateľ turnus nevybral, ukážeme mu ten, ktorý sa priradí podľa dátumu.
  const navrhnutyTurnus =
    uprava && uprava.druh === 'vydavok' && !uprava.tour_id && !uprava.bezTurnusu
      ? turnusPreDatum(turnusy, uprava.datum)
      : null

  const upravujemPrijem = uprava?.druh === 'prijem'
  const ef = efaktura?.efaktura
  const doklady = uprava?.id ? prilohy : cakajuceSubory
  /** Na telefóne sa doklad fotí priamo – na počítači len keď formulár otvoril QR kód. */
  const fotoaparat = male || fotoHned

  const turnusFormulara = uprava?.tour_id ? turnusy.find((t) => String(t.id) === uprava.tour_id) : null
  const zhrnutieViac = uprava
    ? [
        !upravujemPrijem && (turnusFormulara?.nazov ?? navrhnutyTurnus?.nazov ?? 'bez turnusu'),
        NAZVY_PLATIEB[uprava.platba]?.toLowerCase(),
        !upravujemPrijem && (uprava.odpocitat ? 'uznateľný' : 'neuznateľný'),
        uprava.druh !== druh && (upravujemPrijem ? 'súkromný príjem' : 'výdavok'),
        uprava.poznamka.trim() && 'poznámka',
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  // Zbalené, pokiaľ v nich nie je nič nezvyčajné – inak by človek zmenu prehliadol.
  const viacOtvorene =
    viacUdajov ?? (!!uprava && (!!uprava.poznamka.trim() || uprava.druh !== druh || (!upravujemPrijem && !uprava.odpocitat)))

  return (
    <>
      <div className="hlavicka">
        <h1>Výdavky</h1>
        <div className="akcie">
          {!male && (
            <Link className="tlacidlo" to="/financie">
              Prehľad financií
            </Link>
          )}
          {pristup?.zapnute && pristup.z_pocitaca && !prijem && (
            <button onClick={() => setQrOkno(true)}>
              <Ikona nazov="telefon" velkost={16} /> Odfotiť telefónom
            </button>
          )}
          <button className="primar" onClick={() => otvorNovy()}>
            {prijem ? '+ Nový súkromný príjem' : '+ Nový výdavok'}
          </button>
          {male && (
            <MenuAkcii
              popis="Ďalšie možnosti"
              akcie={[{ text: 'Prehľad financií', ikona: 'financie', sprav: () => navigate('/financie') }]}
            />
          )}
        </div>
      </div>

      <div className="taby">
        {ZALOZKY.map((z) => (
          <button key={z.kluc} className={druh === z.kluc ? 'aktivny' : ''} onClick={() => prepni(z.kluc)}>
            {z.text}
            {suhrn && (
              <span className="pocet">{z.kluc === 'prijem' ? suhrn.pocet_prijmov : suhrn.pocet_vydavkov}</span>
            )}
          </button>
        ))}
      </div>

      {chyba && <div className="chyba">{chyba}</div>}

      {qrOkno && (
        <QrOkno nadpis="Odfotiť doklad telefónom" cesta="/vydavky?novy=1&foto=1" zavriet={() => setQrOkno(false)}>
          <p style={{ marginTop: 0 }}>
            Naskenuj kód fotoaparátom telefónu. Otvorí sa nový výdavok – odfoť doklad, doplň sumu a popis a ulož.
          </p>
          <p className="tlmene" style={{ fontSize: 14 }}>
            Výdavok sa tu potom objaví sám. V telefóne musí byť zapnutý Tailscale.
          </p>
        </QrOkno>
      )}

      {prijem && (
        <div className="napoveda" style={{ marginTop: -8, marginBottom: 12 }}>
          Sem zapíš peniaze, ktoré prišli na účet, ale nie sú príjmom z podnikania – vklad vlastných peňazí,
          prevod od rodiny, vrátené peniaze z e-shopu. Do daňového podkladu ani do zisku sa nezapočítavajú,
          evidujú sa len preto, aby súhlasil výpis z banky.
        </div>
      )}

      {uprava && (
        <div className="panel panel-formulara" ref={formular}>
          <h2>
            {uprava.id
              ? upravujemPrijem
                ? 'Úprava súkromného príjmu'
                : 'Úprava výdavku'
              : upravujemPrijem
                ? 'Nový súkromný príjem'
                : 'Nový výdavok'}
          </h2>

          {/* Doklad je na prvom mieste – na telefóne sa začína fotkou a čísla sa dopíšu podľa nej. */}
          <div className="doklady-formulara">
            {doklady.length > 0 && (
              <div className="zoznam-dokladov">
                {uprava.id
                  ? prilohy.map((p) => (
                      <div key={p.id} className="doklad-riadok">
                        <a className="typ-s-ikonou" href={`/api/vydavky/subory/${p.id}`} target="_blank" rel="noreferrer">
                          <Ikona nazov="subor" velkost={15} />
                          {p.nazov}
                        </a>
                        <span className="tlmene">{velkostSuboru(p.velkost)}</span>
                        <button
                          className="ikonove holy zmazat"
                          title="Zmazať doklad"
                          aria-label={`Zmazať doklad ${p.nazov}`}
                          onClick={() => zmazDoklad(p)}
                        >
                          <Ikona nazov="zmazat" velkost={15} />
                        </button>
                      </div>
                    ))
                  : cakajuceSubory.map((su, i) => (
                      <div key={i} className="doklad-riadok">
                        <span className="typ-s-ikonou">
                          <Ikona nazov="subor" velkost={15} /> {su.name}
                        </span>
                        <span className="tlmene">{velkostSuboru(su.size)}</span>
                        <button
                          className="ikonove holy"
                          title="Odobrať"
                          aria-label={`Odobrať ${su.name}`}
                          onClick={() => setCakajuceSubory(cakajuceSubory.filter((_, j) => j !== i))}
                        >
                          <Ikona nazov="zavriet" velkost={14} hrubka={2} />
                        </button>
                      </div>
                    ))}
              </div>
            )}
            <input
              ref={vstupFotky}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => {
                const subory = Array.from(e.target.files ?? [])
                e.target.value = ''
                pridajSubory(subory)
              }}
            />
            <input
              ref={vstupSuborov}
              type="file"
              multiple
              accept="image/*,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const subory = Array.from(e.target.files ?? [])
                e.target.value = ''
                pridajSubory(subory)
              }}
            />
            {fotoaparat && (
              <button className="primar foto-dokladu" onClick={() => vstupFotky.current?.click()} disabled={nahrava}>
                <Ikona nazov="sken" velkost={20} /> {doklady.length ? 'Odfotiť ďalší doklad' : 'Odfotiť doklad'}
              </button>
            )}
            <div className="riadok-nastroju">
              <button className="maly" onClick={() => vstupSuborov.current?.click()} disabled={nahrava}>
                <Ikona nazov="priloha" velkost={15} />
                {nahrava ? 'Nahrávam…' : fotoaparat ? 'Vybrať súbor' : '+ Pridať doklad'}
              </button>
              {!uprava.id && !upravujemPrijem && (
                <>
                  <input
                    ref={vstupXml}
                    type="file"
                    accept=".xml,application/xml,text/xml"
                    style={{ display: 'none' }}
                    onChange={(e) => nacitajEfakturu(e.target.files?.[0])}
                  />
                  <button className="maly" onClick={() => vstupXml.current?.click()}>
                    <Ikona nazov="subor" velkost={15} /> Načítať e-faktúru (XML)
                  </button>
                </>
              )}
            </div>
            {!uprava.id && !ef && (
              <div className="napoveda">
                {upravujemPrijem
                  ? 'Priložiť môžeš napríklad výpis z banky – uloží sa spolu so záznamom.'
                  : 'Fotka alebo PDF dokladu sa priloží po uložení. Z e-faktúry (XML) sa údaje vyplnia samy.'}
              </div>
            )}
          </div>

          {ef && !uprava.id && (
            <>
              {efaktura.zapisana ? (
                <div className="chyba">
                  Túto faktúru už máš zapísanú – výdavok z {skDatum(efaktura.zapisana.datum)} „{efaktura.zapisana.popis}".{' '}
                  <button className="maly" onClick={() => otvorUpravu({ id: efaktura.zapisana!.id } as Vydavok)}>
                    Otvoriť ho
                  </button>
                </div>
              ) : (
                <div className="info-pruh">
                  Z e-faktúry: <strong>{ef.dodavatel.nazov || 'dodávateľ'}</strong>
                  {ef.dodavatel.ico && ` (IČO ${ef.dodavatel.ico})`} · {ef.dobropis ? 'dobropis' : 'faktúra'} {ef.cislo} z{' '}
                  {skDatum(ef.datum)}
                  {ef.splatnost && ` · splatná do ${skDatum(ef.splatnost)}`}
                  {ef.k_uhrade > 0 && ` · k úhrade ${ef.mena === 'EUR' ? skSuma(ef.k_uhrade) : sumaVMene(ef.k_uhrade, ef.mena)}`}.
                  {ef.pdf && ' PDF faktúry sa priloží samo.'} Dátum je dátum vystavenia – ak sa platí neskôr, zmeň ho na deň
                  platby.
                </div>
              )}
              {ef.ine_ico && (
                <div className="chyba">Faktúra je vystavená na iné IČO ({ef.ine_ico}) – skontroluj, či patrí tebe.</div>
              )}
            </>
          )}

          <div className="mriezka dvojice">
            <div className="pole-siroke">
              <label htmlFor="popis-vydavku">Popis *</label>
              <input
                id="popis-vydavku"
                autoFocus={!male && !fotoHned}
                placeholder={upravujemPrijem ? 'napr. Prevod od brata' : 'napr. Nafta – cesta do Mníchova'}
                value={uprava.popis}
                onChange={(e) => setUprava({ ...uprava, popis: e.target.value })}
              />
            </div>
            <div className="pole-siroke">
              <label htmlFor="suma-vydavku">{uprava.mena === 'EUR' ? 'Suma (€) *' : `Suma (${uprava.mena}) *`}</label>
              <div className="suma-s-menou">
                <CisloPole
                  id="suma-vydavku"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0,00"
                  // Prázdne pole namiesto „0" – nulu by človek musel najprv zmazať.
                  hodnota={(uprava.mena === 'EUR' ? uprava.suma : uprava.suma_mena)}
                  zmen={(n) =>
                    setUprava(
                      uprava.mena === 'EUR'
                        ? { ...uprava, suma: n }
                        : prepocitaj({ ...uprava, suma_mena: n }),
                    )
                  }
                />
                <select aria-label="Mena" value={uprava.mena} onChange={(e) => zmenMenu(e.target.value)}>
                  {[...new Set([...MENY, uprava.mena])].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {uprava.mena !== 'EUR' && (
              <>
                <div>
                  <label htmlFor="kurz-vydavku">Kurz ({uprava.mena} za 1 €)</label>
                  <CisloPole
                    id="kurz-vydavku"
                    step="0.0001"
                    inputMode="decimal"
                    hodnota={uprava.kurz}
                    zmen={(n) => setUprava(prepocitaj({ ...uprava, kurz: n || null }))}
                  />
                </div>
                <div>
                  <label htmlFor="suma-v-eurach">Suma v eurách *</label>
                  <CisloPole
                    id="suma-v-eurach"
                    step="0.01"
                    inputMode="decimal"
                    hodnota={uprava.suma}
                    zmen={(n) => setUprava({ ...uprava, suma: n, sumaRucne: true })}
                  />
                </div>
                <div className="pole-siroke napoveda" style={{ marginTop: -6 }}>
                  {kurzInfo && `${kurzInfo}. `}Keď sa platilo kartou, prepíš sumu v eurách podľa výpisu z banky – to je
                  skutočný výdavok.
                </div>
              </>
            )}
            <div>
              <label htmlFor="datum-vydavku">Dátum *</label>
              <input
                id="datum-vydavku"
                type="date"
                value={uprava.datum}
                onChange={(e) => setUprava({ ...uprava, datum: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="kategoria-vydavku">Kategória</label>
              <input
                id="kategoria-vydavku"
                list="kategorie-vydavkov"
                placeholder={upravujemPrijem ? 'napr. vklad' : 'napr. PHM'}
                value={uprava.kategoria}
                onChange={(e) => setUprava({ ...uprava, kategoria: e.target.value })}
              />
              <datalist id="kategorie-vydavkov">
                {(upravujemPrijem ? KATEGORIE_PRIJMOV : kategorie).map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            {platitelDph && !upravujemPrijem && (
              <div>
                <label htmlFor="dph-vydavku">DPH z dokladu (€)</label>
                <CisloPole
                  id="dph-vydavku"
                  step="0.01"
                  inputMode="decimal"
                  hodnota={uprava.dph}
                  placeholder="0,00"
                  zmen={(n) => setUprava({ ...uprava, dph: n || 0 })}
                />
                <div className="napoveda">Odpočítaš si ju v priznaní k DPH.</div>
              </div>
            )}
          </div>

          {/* Zriedkavé polia – súhrn v nadpise ukáže, čo v nich je, aj keď sú zbalené. */}
          <details className="viac-udajov" open={viacOtvorene} onToggle={(e) => setViacUdajov(e.currentTarget.open)}>
            <summary>
              Viac údajov {zhrnutieViac && <span className="tlmene zhrnutie-viac">{zhrnutieViac}</span>}
            </summary>
            <div className="mriezka dvojice">
              {!upravujemPrijem && (
                <div className="pole-siroke">
                  <label htmlFor="turnus-vydavku">Turnus</label>
                  <select
                    id="turnus-vydavku"
                    value={uprava.tour_id}
                    onChange={(e) =>
                      setUprava({ ...uprava, tour_id: e.target.value, bezTurnusu: e.target.value === '' })
                    }
                  >
                    <option value="">
                      {navrhnutyTurnus ? `automaticky: ${navrhnutyTurnus.nazov}` : '— bez turnusu —'}
                    </option>
                    {turnusy.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nazov}
                      </option>
                    ))}
                  </select>
                  <div className="napoveda">
                    {navrhnutyTurnus
                      ? `${skDatum(uprava.datum)} spadá do turnusu ${navrhnutyTurnus.nazov} – priradí sa k nemu automaticky.`
                      : 'Vďaka priradeniu k turnusu appka spočíta jeho skutočný zisk.'}
                  </div>
                </div>
              )}
              <div>
                <label htmlFor="platba-vydavku">Platba</label>
                <select
                  id="platba-vydavku"
                  value={uprava.platba}
                  onChange={(e) => setUprava({ ...uprava, platba: e.target.value as Platba })}
                >
                  {(Object.keys(NAZVY_PLATIEB) as Platba[]).map((p) => (
                    <option key={p} value={p}>
                      {NAZVY_PLATIEB[p]}
                    </option>
                  ))}
                </select>
              </div>
              {!upravujemPrijem && (
                <div className="pole-zaskrtavacie">
                  <label className="zaskrtavacie">
                    <input
                      type="checkbox"
                      checked={uprava.odpocitat}
                      onChange={(e) => setUprava({ ...uprava, odpocitat: e.target.checked })}
                    />
                    Daňovo uznateľný
                  </label>
                </div>
              )}
              <div className="pole-siroke">
                <label htmlFor="druh-vydavku">Druh záznamu</label>
                <select
                  id="druh-vydavku"
                  value={uprava.druh}
                  onChange={(e) => {
                    const d = e.target.value as DruhVydavku
                    setUprava({
                      ...uprava,
                      druh: d,
                      // Súkromný príjem nie je daňový výdavok a nepatrí k turnusu.
                      odpocitat: d === 'vydavok' ? uprava.odpocitat : false,
                      tour_id: d === 'prijem' ? '' : uprava.tour_id,
                      bezTurnusu: d === 'prijem' ? true : uprava.bezTurnusu,
                    })
                  }}
                >
                  <option value="vydavok">Výdavok</option>
                  <option value="prijem">Súkromný príjem (mimo podnikania)</option>
                </select>
              </div>
              <div className="pole-siroke">
                <label htmlFor="poznamka-vydavku">Poznámka</label>
                <input
                  id="poznamka-vydavku"
                  value={uprava.poznamka}
                  onChange={(e) => setUprava({ ...uprava, poznamka: e.target.value })}
                />
              </div>
            </div>
          </details>

          {/* Na telefóne ostáva Uložiť po ruke, kým je formulár na obrazovke. */}
          <div className="riadok-akcii lepkave-akcie">
            <button onClick={() => setUprava(null)}>Zavrieť</button>
            <button className="primar" onClick={() => uloz(true)} disabled={!uprava.popis.trim() || !!efaktura?.zapisana}>
              {uprava.id ? 'Uložiť zmeny' : 'Uložiť'}
            </button>
          </div>
        </div>
      )}

      <FiltreZoznamu
        male={male}
        otvorene={filtreOtvorene}
        hladanie={
          <HladanieSFiltrom
            id="hladat-vydavky"
            hodnota={f.hladat}
            zmen={(hladat) => setF({ ...f, hladat })}
            placeholder={prijem ? 'popis, kategória…' : 'popis, kategória, turnus…'}
            male={male}
            aktivnych={aktivnychFiltrov}
            otvorene={filtreOtvorene}
            prepni={() => setFiltreOtvorene(!filtreOtvorene)}
          />
        }
      >
        <div>
          <label>Od</label>
          <input type="date" value={f.od} onChange={(e) => setF({ ...f, od: e.target.value })} />
        </div>
        <div>
          <label>Do</label>
          <input type="date" value={f.do} onChange={(e) => setF({ ...f, do: e.target.value })} />
        </div>
        <div>
          <label>Kategória</label>
          <select value={f.kategoria} onChange={(e) => setF({ ...f, kategoria: e.target.value })}>
            <option value="">Všetky</option>
            {!prijem && (
              <optgroup label="Podľa dane">
                <option value={PODLA_DANE.uznatelne}>Len daňovo uznateľné</option>
                <option value={PODLA_DANE.neuznatelne}>Len neuznateľné</option>
              </optgroup>
            )}
            <optgroup label="Kategórie">
              {kategorie.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        {!prijem && (
          <div>
            <label>Turnus</label>
            <select value={f.turnus} onChange={(e) => setF({ ...f, turnus: e.target.value })}>
              <option value="">Všetky</option>
              {turnusy.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nazov}
                </option>
              ))}
            </select>
          </div>
        )}
      </FiltreZoznamu>

      {male && vydavky && vydavky.length > 0 && (
        <div className="suhrn-zoznamu">
          <span>
            {prijem
              ? pocet(vydavky.length, ['príjem', 'príjmy', 'príjmov'])
              : pocet(vydavky.length, ['výdavok', 'výdavky', 'výdavkov'])}
          </span>
          <span>
            spolu <strong>{skSuma(spolu)}</strong>
          </span>
          {prijem ? (
            <span>do dane nevstupujú</span>
          ) : (
            Math.abs(uznatelneVZozname - spolu) > 0.005 && (
              <span>
                uznateľné <strong>{skSuma(uznatelneVZozname)}</strong>
              </span>
            )
          )}
        </div>
      )}

      <div className={male && vydavky?.length ? 'zoznam-zaznamov' : 'panel tesny'}>
        {!vydavky ? (
          <div className="nacitava">Načítavam…</div>
        ) : vydavky.length === 0 ? (
          <PrazdnyStav
            ikona={prijem ? 'zaloha' : 'vydavky'}
            ton={prijem ? 'tyrkys' : 'akcent'}
            nadpis={
              prijem
                ? 'Zatiaľ žiadne súkromné príjmy'
                : f.kategoria === PODLA_DANE.uznatelne
                  ? 'Žiadny daňovo uznateľný výdavok'
                  : f.kategoria === PODLA_DANE.neuznatelne
                    ? 'Žiadny neuznateľný výdavok'
                    : 'Za vybrané obdobie nie sú žiadne záznamy'
            }
            text={
              prijem
                ? 'Peniaze, ktoré prišli na účet, ale nie sú príjmom z podnikania. Evidujú sa len preto, aby súhlasil výpis z banky.'
                : 'Zapíš výdavok aj s fotkou dokladu – asistent ho z fotky môže vyplniť za teba.'
            }
            akcia={
              <button className="primar" onClick={() => otvorNovy()}>
                {prijem ? '+ Nový súkromný príjem' : '+ Nový výdavok'}
              </button>
            }
          />
        ) : male ? (
          // Telefón: dátum, popis s turnusom, kategória a suma – ťuknutím sa výdavok otvorí na úpravu.
          vydavky.map((v) => (
            <ZaznamRiadok
              key={v.id}
              className="vydavok-riadok"
              otvor={() => otvorUpravu(v)}
              hore={<span className="zaznam-datum">{skDatum(v.datum)}</span>}
              popisAkcii={`Akcie – ${v.popis}`}
              akcie={[
                { text: 'Upraviť', ikona: 'upravit', sprav: () => otvorUpravu(v) },
                { text: 'Presunúť do koša', ikona: 'zmazat', nebezpecne: true, sprav: () => zmaz(v) },
              ]}
              hlavny={
                <>
                  {v.popis}
                  {v.turnus_nazov && <span className="pod-textom">{v.turnus_nazov}</span>}
                </>
              }
              dole={
                <>
                  {v.kategoria && <FarebnyCip ton={tonKategorie(v.kategoria)}>{v.kategoria}</FarebnyCip>}
                  {v.druh === 'vydavok' && v.odpocitat === 0 && <span className="stitok koncept">neuznateľný</span>}
                  {!!v.pocet_priloh && (
                    <span className="typ-s-ikonou ma-prilohu" aria-label={pocet(v.pocet_priloh, ['doklad', 'doklady', 'dokladov'])}>
                      <Ikona nazov="priloha" velkost={14} /> {v.pocet_priloh}
                    </span>
                  )}
                </>
              }
              suma={
                <>
                  {v.druh === 'prijem' ? (
                    <strong className="prijem-suma">+ {skSuma(v.suma)}</strong>
                  ) : (
                    <strong>{skSuma(v.suma)}</strong>
                  )}
                  {v.mena && v.mena !== 'EUR' && <span className="pod-textom">{sumaVMene(v.suma_mena, v.mena)}</span>}
                </>
              }
            />
          ))
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Dátum</th>
                <th>Popis</th>
                <th>Kategória</th>
                {!prijem && <th>Turnus</th>}
                <th>Doklad</th>
                <th className="cislo">Suma</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {vydavky.map((v) => (
                <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => otvorUpravu(v)}>
                  <td>{skDatum(v.datum)}</td>
                  <td className="hlavna-bunka">
                    <strong>{v.popis}</strong>
                    {v.druh === 'vydavok' && v.odpocitat === 0 && (
                      <span className="stitok koncept" style={{ marginLeft: 8 }}>
                        neuznateľný
                      </span>
                    )}
                  </td>
                  <td>
                    {v.kategoria ? (
                      <FarebnyCip ton={tonKategorie(v.kategoria)}>{v.kategoria}</FarebnyCip>
                    ) : (
                      <span className="tlmene">—</span>
                    )}
                  </td>
                  {!prijem && <td className="tlmene">{v.turnus_nazov || '—'}</td>}
                  <td className="tlmene">{v.pocet_priloh ? (
                    <span className="typ-s-ikonou ma-prilohu">
                      <Ikona nazov="priloha" velkost={14} /> {v.pocet_priloh}
                    </span>
                  ) : (
                    '—'
                  )}</td>
                  <td className="cislo">
                    {v.druh === 'prijem' ? (
                      <strong className="prijem-suma">+ {skSuma(v.suma)}</strong>
                    ) : (
                      <strong>{skSuma(v.suma)}</strong>
                    )}
                    {v.mena && v.mena !== 'EUR' && <div className="suma-v-mene">{sumaVMene(v.suma_mena, v.mena)}</div>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="akcie-riadku">
                      <button className="ikonove maly" title="Upraviť" aria-label="Upraviť" onClick={() => otvorUpravu(v)}>
                        <Ikona nazov="upravit" velkost={15} />
                      </button>
                      <button className="ikonove maly holy zmazat" title="Presunúť do koša" aria-label="Presunúť do koša" onClick={() => zmaz(v)}>
                        <Ikona nazov="zmazat" velkost={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!male && vydavky && vydavky.length > 0 && (
        <div className="tlmene" style={{ fontSize: 13 }}>
          {prijem ? (
            <>
              Spolu {pocet(vydavky.length, ['súkromný príjem', 'súkromné príjmy', 'súkromných príjmov'])} ·{' '}
              <strong>{skSuma(spolu)}</strong> – do dane nevstupuje
            </>
          ) : (
            <>
              Spolu {pocet(vydavky.length, ['výdavok', 'výdavky', 'výdavkov'])} · <strong>{skSuma(spolu)}</strong>
              {uznatelneVZozname !== spolu && <> · z toho uznateľných {skSuma(uznatelneVZozname)}</>}
            </>
          )}
        </div>
      )}
    </>
  )
}
