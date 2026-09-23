export class ApiChyba extends Error {
  constructor(public stav: number, sprava: string) {
    super(sprava)
  }
}

async function volaj<T>(metoda: string, cesta: string, telo?: unknown): Promise<T> {
  const odpoved = await fetch('/api' + cesta, {
    method: metoda,
    headers: telo === undefined ? {} : { 'Content-Type': 'application/json' },
    body: telo === undefined ? undefined : JSON.stringify(telo),
  })
  const text = await odpoved.text()
  const data = text ? JSON.parse(text) : null
  if (!odpoved.ok) throw new ApiChyba(odpoved.status, data?.chyba || 'Chyba servera.')
  return data as T
}

export const api = {
  get: <T>(cesta: string) => volaj<T>('GET', cesta),
  post: <T>(cesta: string, telo?: unknown) => volaj<T>('POST', cesta, telo ?? {}),
  put: <T>(cesta: string, telo: unknown) => volaj<T>('PUT', cesta, telo),
  del: <T>(cesta: string) => volaj<T>('DELETE', cesta),

  /** Nahranie súborov – telo ide ako FormData, nie JSON. */
  async upload<T>(cesta: string, data: FormData): Promise<T> {
    const odpoved = await fetch('/api' + cesta, { method: 'POST', body: data })
    const text = await odpoved.text()
    const vysledok = text ? JSON.parse(text) : null
    if (!odpoved.ok) throw new ApiChyba(odpoved.status, vysledok?.chyba || 'Nahrávanie zlyhalo.')
    return vysledok as T
  },
}

// ── Typy ──────────────────────────────────────────────────
export type DphRezim = 'neplatitel' | '7a'
export type TypVydavkov = 'pausalne' | 'skutocne'

export type Nastavenia = {
  meno: string; adresa: string; psc_mesto: string; krajina: string
  ico: string; dic: string; zapis: string; email: string; telefon: string
  iban: string; swift: string; banka: string
  cislo_vzor: string; splatnost_dni: number; poznamka_pati: string
  /** 1 = predvolená splatnosť sa ráta v pracovných dňoch. */
  splatnost_pracovne: number
  /** 1 = pracuje na zákazkách v zahraničí – AI asistenti s tým rátajú. */
  praca_v_zahranici: number
  /** Údaje o živnosti. */
  predmety: string; datum_vzniku: string; urad_zr: string; cislo_zr: string
  dph_rezim: DphRezim; ic_dph: string; vydavky_typ: TypVydavkov
  zdravotna_poistovna: string; web: string
  /** Vzhľad a údaje na faktúre. */
  sposob_uhrady: string; farba_faktury: string
}

export type Firma = {
  id: number; nazov: string; kontaktna_osoba: string; adresa: string; psc_mesto: string; krajina: string
  ico: string; dic: string; ic_dph: string; email: string; telefon: string
  poznamka: string; archived: number
}

export type Stav = 'koncept' | 'vystavena' | 'zaplatena'
export type StavZobraz = Stav | 'po_splatnosti' | 'ciastocne' | 'po_splatnosti_ciastocne'
export type TypDokladu = 'faktura' | 'zaloha'

export type PlatbaFaktury = { id: number; invoice_id: number; datum: string; suma: number; poznamka: string }

export type Polozka = { popis: string; mnozstvo: number; jednotka: string; cena: number }

export type Faktura = {
  id: number; cislo: string; company_id: number | null; firma_nazov: string | null
  tour_id: number | null; turnus_nazov: string | null
  order_id: number | null; objednavka_nazov: string | null
  datum_vystav: string; datum_dodania: string; datum_splat: string
  stav: Stav; stav_zobraz: StavZobraz; datum_uhrady: string | null
  variabilny: string; poznamka: string; suma: number
  /** Typ dokladu a prípadná väzba na starú faktúru, ktorú táto záloha kryje. */
  typ: TypDokladu; kryje_id: number | null; kryje_cislo?: string | null; kryje_suma?: number | null
  /** Dopočítané z platieb. */
  prijate: number; zostatok: number; otvoreny_zostatok: number
  /** Koľko na túto faktúru prišlo cez zálohové faktúry, ktoré ju kryjú. */
  prijate_zalohami: number
  /** prijate + prijate_zalohami – z toho sa počíta stav aj podiel uhradenia. */
  uhradene_spolu: number
  datum_poslednej_platby: string | null
  /** Posledná úhrada vrátane tej, ktorá prišla cez krycie zálohy. */
  datum_poslednej_uhrady: string | null
  pocet_platieb: number
  polozky?: Polozka[]
  platby?: PlatbaFaktury[]
  kryte_zalohami?: Faktura[]
}

/** Počty pre záložky nad zoznamom faktúr. */
export type PoctyFaktur = { vsetky: number; nevyplatene: number; vyplatene: number; zalohy: number }

export type PrehladDlhov = {
  nevyplatene: Faktura[]
  vyplatene: Faktura[]
  zalohy_kryjuce: Faktura[]
  zalohy_ostatne: Faktura[]
}

export type Suhrn = {
  zaplatene: number; nezaplatene: number; po_splatnosti: number
  po_splatnosti_pocet: number; tento_rok: number; roky: string[]
}

// ── Výdavky a financie ────────────────────────────────────
export type Platba = 'karta' | 'hotovost' | 'prevod' | 'ine'

/**
 * V evidencii výdavkov sú aj súkromné príjmy – chodia na tom istom výpise
 * z banky. Do podnikania nevstupujú: nie sú príjmom pre daň ani výdavkom.
 */
export type DruhVydavku = 'vydavok' | 'prijem'

export type Vydavok = {
  id: number; datum: string; popis: string; kategoria: string; suma: number
  druh: DruhVydavku
  company_id: number | null; firma_nazov: string | null
  tour_id: number | null; turnus_nazov: string | null
  platba: Platba; odpocitat: number; poznamka: string
  pocet_priloh?: number; prilohy?: Priloha[]
}

export type PrehladFinancii = {
  od: string; do: string
  prijmy: number; pocet_faktur: number
  vydavky: number; vydavky_odpocitatelne: number; pocet_vydavkov: number
  sukromne_prijmy: number
  zisk: number; caka_na_zaplatenie: number
}

export type SuhrnVydavkov = {
  vydavky: number; uznatelne: number; sukromne_prijmy: number
  pocet_vydavkov: number; pocet_prijmov: number
}

export type MesacneFinancie = { mesiac: string; prijmy: number; vydavky: number; zisk: number }
export type KategoriaVydavkov = { kategoria: string; suma: number; pocet: number }
export type ZiskTurnusu = {
  id: number; nazov: string; datum_od: string; datum_do: string; firma_nazov: string | null
  vyfakturovane: number; zaplatene: number; vydavky: number; zisk: number
}

export const NAZVY_PLATIEB: Record<Platba, string> = {
  karta: 'Kartou',
  hotovost: 'V hotovosti',
  prevod: 'Prevodom',
  ine: 'Inak',
}

/** Prednastavené kategórie súkromných príjmov. */
export const KATEGORIE_PRIJMOV = [
  'Vklad z vlastných peňazí',
  'Od rodiny',
  'Vrátka / refundácia',
  'Predaj súkromnej veci',
  'Iný súkromný príjem',
]

/** Prednastavené kategórie výdavkov – používateľ si môže dopísať vlastné. */
export const KATEGORIE_VYDAVKOV = [
  'Doprava',
  'Ubytovanie',
  'Materiál',
  'Náradie',
  'Stravné',
  'Telefón a internet',
  'Poistenie',
  'Odvody (SP/ZP)',
  'Daň',
  'Účtovníctvo',
  'Bankové poplatky',
  'Iné',
]

// ── Turnusy a objednávky ──────────────────────────────────
export type StavTurnusu = 'planovany' | 'prebieha' | 'ukonceny' | 'zruseny'

export type Turnus = {
  id: number; nazov: string; company_id: number | null; firma_nazov: string | null
  krajina: string; miesto: string; datum_od: string; datum_do: string
  zruseny: number; poznamka: string
  stav: StavTurnusu
  objednane: number; vyfakturovane: number; zaplatene: number; pocet_objednavok: number
  objednavky?: Objednavka[]
  faktury?: Pick<Faktura, 'id' | 'cislo' | 'typ' | 'datum_vystav' | 'datum_splat' | 'suma' | 'stav' | 'stav_zobraz'>[]
}

export type StavObjednavky = 'prijata' | 'potvrdena' | 'zrusena'
export type StavObjednavkyZobraz = StavObjednavky | 'ciastocne' | 'vyfakturovana'

export type Objednavka = {
  id: number; cislo: string; company_id: number | null; firma_nazov: string | null
  tour_id: number | null; turnus_nazov: string | null
  datum: string | null; popis: string
  hodinovka: number; hodiny: number; suma: number
  stav: StavObjednavky; stav_zobraz: StavObjednavkyZobraz
  poznamka: string; vyfakturovane: number
  faktury?: Pick<Faktura, 'id' | 'cislo' | 'typ' | 'datum_vystav' | 'suma' | 'stav' | 'stav_zobraz'>[]
}

export const NAZVY_STAVOV_TURNUSU: Record<StavTurnusu, string> = {
  planovany: 'Plánovaný',
  prebieha: 'Prebieha',
  ukonceny: 'Ukončený',
  zruseny: 'Zrušený',
}

export const NAZVY_STAVOV_OBJEDNAVKY: Record<StavObjednavkyZobraz, string> = {
  prijata: 'Prijatá',
  potvrdena: 'Potvrdená',
  zrusena: 'Zrušená',
  ciastocne: 'Čiastočne vyfakturovaná',
  vyfakturovana: 'Vyfakturovaná',
}

/** Trieda štítku – recyklujeme farby zo stavov faktúr. */
export const STITOK_TURNUSU: Record<StavTurnusu, string> = {
  planovany: 'vystavena',
  prebieha: 'zaplatena',
  ukonceny: 'koncept',
  zruseny: 'po_splatnosti',
}

export const STITOK_OBJEDNAVKY: Record<StavObjednavkyZobraz, string> = {
  prijata: 'vystavena',
  potvrdena: 'vystavena',
  ciastocne: 'vystavena',
  vyfakturovana: 'zaplatena',
  zrusena: 'koncept',
}

/** Turnus, do ktorého obdobia dátum spadá. Pri prekryve vyhrá ten, čo začal neskôr. */
export function turnusPreDatum(turnusy: Turnus[], datum: string): Turnus | null {
  if (!datum) return null
  const sediace = turnusy
    .filter((t) => t.zruseny === 0 && datum >= t.datum_od && datum <= t.datum_do)
    .sort((a, b) => b.datum_od.localeCompare(a.datum_od))
  return sediace[0] ?? null
}

/** Počet dní turnusu vrátane prvého aj posledného. */
export function dlzkaTurnusu(od: string, do_: string): number {
  const a = new Date(od + 'T12:00:00').getTime()
  const b = new Date(do_ + 'T12:00:00').getTime()
  return Math.round((b - a) / 86400000) + 1
}

export type StavZmluvy = 'navrh' | 'aktivna' | 'ukoncena'
export type Obnova = 'ziadna' | 'automaticka' | 'rucna'
export type Expiracia = 'ziadna' | 'coskoro' | 'po_expiracii'

export type Priloha = { id: number; nazov: string; velkost: number; mime: string; created_at: string }

export type Zmluva = {
  id: number; nazov: string; company_id: number | null; firma_nazov: string | null
  kategoria: string; cislo_zmluvy: string
  datum_podpisu: string | null; platnost_od: string | null; platnost_do: string | null
  obnova: Obnova; vypoved_dni: number; pripomienka_dni: number
  stav: StavZmluvy; poznamka: string
  expiracia: Expiracia; dni_do_konca: number | null
  pocet_priloh?: number; prilohy?: Priloha[]
}

export type SuhrnZmluv = {
  aktivne: number; coskoro: number; po_expiracii: number
  pripomienky: Pick<Zmluva, 'id' | 'nazov' | 'platnost_do' | 'obnova' | 'firma_nazov' | 'expiracia' | 'dni_do_konca'>[]
  kategorie: string[]
}

/** Predvolené kategórie – používateľ si môže dopísať vlastné. */
export const KATEGORIE = [
  'Rámcová zmluva',
  'Zmluva o dielo',
  'Objednávková zmluva',
  'Mlčanlivosť (NDA)',
  'Ubytovanie',
  'Doprava',
  'Poistenie',
  'Iné',
]

export const NAZVY_STAVOV_ZMLUV: Record<StavZmluvy, string> = {
  navrh: 'Návrh',
  aktivna: 'Aktívna',
  ukoncena: 'Ukončená',
}

export const NAZVY_OBNOV: Record<Obnova, string> = {
  ziadna: 'Bez obnovy',
  automaticka: 'Automatická obnova',
  rucna: 'Obnovuje sa ručne',
}

export function velkostSuboru(b: number): string {
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' kB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}

// ── Pomôcky na formátovanie ───────────────────────────────
export const NAZVY_STAVOV: Record<StavZobraz, string> = {
  koncept: 'Koncept',
  vystavena: 'Vystavená',
  zaplatena: 'Vyplatená',
  ciastocne: 'Čiastočne uhradená',
  po_splatnosti: 'Nevyplatená',
  po_splatnosti_ciastocne: 'Čiastočne, po termíne',
}

/** Farba štítku podľa stavu – čiastočné úhrady majú vlastnú. */
export const STITOK_STAVU: Record<StavZobraz, string> = {
  koncept: 'koncept',
  vystavena: 'vystavena',
  zaplatena: 'zaplatena',
  ciastocne: 'ciastocne',
  po_splatnosti: 'po_splatnosti',
  po_splatnosti_ciastocne: 'po_splatnosti',
}

/**
 * Slovenské skloňovanie po číslovke: 1 faktúra, 2–4 faktúry, 5+ faktúr.
 * tvary = [jednotné, dvoj-až-štvor, množné].
 */
export function pocet(n: number, tvary: [string, string, string]): string {
  const tvar = n === 1 ? tvary[0] : n >= 2 && n <= 4 ? tvary[1] : tvary[2]
  return `${n} ${tvar}`
}

export function skDatum(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [r, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)}.${Number(m)}.${r}`
}

/**
 * Koľko dní zostáva do splatnosti (kladné číslo), prípadne o koľko dní
 * je faktúra po termíne (záporné). Počíta sa v celých dňoch od dnešnej
 * polnoci, aby „dnes" vyšlo presne 0 bez ohľadu na hodinu.
 */
export function dniDoSplatnosti(iso: string | null | undefined): number | null {
  if (!iso) return null
  const [r, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!r || !m || !d) return null
  const splatnost = new Date(r, m - 1, d).getTime()
  const dnes = new Date()
  const polnoc = new Date(dnes.getFullYear(), dnes.getMonth(), dnes.getDate()).getTime()
  return Math.round((splatnost - polnoc) / 86400000)
}

// ── Skryté sumy ───────────────────────────────────────────
// Režim „nechcem, aby mi niekto cez plece videl čísla". Všetky sumy v appke
// idú cez skSuma, takže stačí jeden prepínač tu – a komponent, ktorý pri
// zmene prekreslí appku (App.tsx). Voľba sa pamätá aj po zatvorení appky.

const KLUC_SKRYTE = 'zivnostapp-skryte-sumy'
let skryteSumy = (() => {
  try {
    return localStorage.getItem(KLUC_SKRYTE) === '1'
  } catch {
    return false
  }
})()
const posluchaci = new Set<() => void>()

export const SKRYTA_SUMA = '*** €'

export function suSumySkryte(): boolean {
  return skryteSumy
}

export function nastavSkryteSumy(skryt: boolean) {
  skryteSumy = skryt
  try {
    localStorage.setItem(KLUC_SKRYTE, skryt ? '1' : '0')
  } catch {
    // bez úložiska to aspoň platí do zatvorenia okna
  }
  posluchaci.forEach((f) => f())
}

/** Zavolá funkciu pri každej zmene; vráti odhlásenie. */
export function sledujSkryteSumy(f: () => void): () => void {
  posluchaci.add(f)
  return () => {
    posluchaci.delete(f)
  }
}

export function skSuma(n: number): string {
  if (skryteSumy) return SKRYTA_SUMA
  return new Intl.NumberFormat('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0) + ' €'
}

export function skCislo(n: number): string {
  return new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 2 }).format(n ?? 0)
}

export function dnesISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Koľko dní zostáva do dátumu (záporné = po termíne). */
export function dniDo(iso: string): number {
  const ciel = new Date(iso + 'T12:00:00').getTime()
  const dnes = new Date(dnesISO() + 'T12:00:00').getTime()
  return Math.round((ciel - dnes) / 86400000)
}

// ── Kôš ───────────────────────────────────────────────────
/** Vráti naposledy zmazaný záznam z koša – pre tlačidlo „Vrátiť späť". */
export async function vratZKosa(tabulka: string, zaznamId: number): Promise<void> {
  const kos = await api.get<PolozkaKosa[]>('/kos')
  const polozka = kos.find((k) => k.tabulka === tabulka && k.zaznam_id === zaznamId)
  if (!polozka) throw new ApiChyba(404, 'Záznam sa už v koši nenašiel.')
  await api.post(`/kos/${polozka.id}/obnovit`)
}

export type PolozkaKosa = {
  id: number; tabulka: string; zaznam_id: number; popis: string
  zmazane_at: string; nazov_typu: string
}

// ── Stravné a dni v krajine ───────────────────────────────
export type Sadzba = { id?: number; krajina: string; sadzba: number; mena: string; poznamka: string }

export type StravneTurnus = {
  turnus: { id: number; nazov: string; krajina: string; datum_od: string; datum_do: string }
  dni: number; sadzba: number | null; mena: string; ma_sadzbu: boolean; suma: number | null
  uz_zapisane: { id: number; suma: number }[]
}

export type DniVKrajine = {
  rok: string; hranica: number; dni_v_zahranici: number
  krajiny: {
    krajina: string; dni: number; pocet_turnusov: number
    zostava_do_hranice: number; blizi_sa_hranica: boolean; prekrocena_hranica: boolean
  }[]
}

// ── Daňový podklad ────────────────────────────────────────
export type PodkladVydavok = {
  datum: string; popis: string; kategoria: string; suma: number
  odpocitat: number; platba: Platba; poznamka: string
  turnus: string | null; pocet_dokladov: number
}

export type PodkladFaktura = {
  cislo: string; typ: TypDokladu; firma: string | null
  datum_vystav: string; datum_splat: string; suma: number
  prijate_v_roku: number; datum_uhrady: string | null
  otvoreny_zostatok: number; stav_zobraz: StavZobraz; kryje_cislo: string | null
}

export type DanovyPodklad = {
  rok: string
  zostavene: string
  zivnostnik: { meno: string; ico: string; dic: string; adresa: string; iban: string }
  prijmy: { suma: number; pocet: number; pocet_platieb: number }
  nezaplatene: { suma: number; pocet: number }
  vydavky: {
    uznatelne: number; neuznatelne: number; pocet: number
    podlaKategorii: { kategoria: string; suma: number; uznatelne: number; pocet: number }[]
    rozpis: PodkladVydavok[]
  }
  sukromne_prijmy: {
    suma: number; pocet: number
    polozky: { datum: string; popis: string; kategoria: string; suma: number; platba: Platba; poznamka: string }[]
  }
  zaklad_dane: number
  faktury: PodkladFaktura[]
  platby: {
    datum: string; suma: number; poznamka: string
    cislo: string; typ: TypDokladu; firma: string | null; kryje_cislo: string | null
  }[]
  platby_po_mesiacoch: { mesiac: string; suma: number; pocet: number }[]
  turnusy: { nazov: string; krajina: string; miesto: string; datum_od: string; datum_do: string; firma: string | null; dni: number }[]
  dni_v_krajinach: { krajina: string; dni: number }[]
}

// ── Mail ──────────────────────────────────────────────────
export type StavMailu = { nastavene: boolean; odosielatel: string }
export type NavrhMailu = { komu: string; predmet: string; text: string; firma: string; dni_po_splatnosti?: number }
export type PoSplatnosti = {
  id: number; cislo: string; suma: number; datum_splat: string
  /** Koľko z faktúry ešte reálne chýba – po čiastočných úhradách je to menej. */
  otvoreny_zostatok: number
  firma_nazov: string | null; firma_email: string | null; dni_po_splatnosti: number
}

// ── Šablóny faktúr ────────────────────────────────────────
export type Sablona = {
  id: number; nazov: string; company_id: number | null; firma_nazov: string | null
  poznamka: string; polozky: Polozka[]
}
