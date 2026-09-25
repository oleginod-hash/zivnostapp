import crypto from 'node:crypto'
import { naHladanie } from './format.js'

/**
 * Výpis z banky vo formáte CSV. Každá banka ho exportuje trochu inak – iné
 * kódovanie, oddeľovač, názvy stĺpcov aj zápis súm a dátumov. Preto stĺpce
 * hľadáme podľa názvov v záhlaví a hodnoty čítame zhovievavo. Keď sa stĺpce
 * nájsť nepodarí, používateľ ich priradí ručne (pozri `mapovanie`).
 */

export type Mapovanie = {
  datum: number
  suma: number
  /** Samostatné stĺpce príjem/výdaj, keď banka nemá jednu sumu so znamienkom. */
  prijem?: number
  vydaj?: number
  mena?: number
  vs?: number
  protistrana?: number
  protiucet?: number
  sprava?: number
  id?: number
}

export type Pohyb = {
  riadok: number
  datum: string
  suma: number
  mena: string
  vs: string
  protistrana: string
  sprava: string
  /** Stály identifikátor pohybu – ten istý výpis sa nezapíše dvakrát. */
  odtlacok: string
}

export type Vypis = {
  hlavicka: string[]
  mapovanie: Partial<Mapovanie>
  pohyby: Pohyb[]
  /** Riadky, ktoré sa nedali prečítať (chýba dátum alebo suma). */
  necitatelne: number
}

/** Text výpisu – UTF-8, a keď v ňom sú neplatné znaky, windows-1250 (staršie exporty slovenských bánk). */
export function textVypisu(obsah: Buffer): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(obsah)
  } catch {
    text = new TextDecoder('windows-1250').decode(obsah)
  }
  return text.replace(/^\uFEFF/, '')
}

/** CSV s úvodzovkami (aj s novým riadkom vnútri) a zadaným oddeľovačom. */
export function riadkyCsv(text: string, oddelovac: string): string[][] {
  const riadky: string[][] = []
  let riadok: string[] = []
  let pole = ''
  let vUvodzovkach = false
  for (let i = 0; i < text.length; i++) {
    const z = text[i]
    if (vUvodzovkach) {
      if (z === '"' && text[i + 1] === '"') {
        pole += '"'
        i++
      } else if (z === '"') {
        vUvodzovkach = false
      } else {
        pole += z
      }
    } else if (z === '"') {
      vUvodzovkach = true
    } else if (z === oddelovac) {
      riadok.push(pole)
      pole = ''
    } else if (z === '\n' || z === '\r') {
      if (z === '\r' && text[i + 1] === '\n') i++
      riadok.push(pole)
      pole = ''
      if (riadok.some((p) => p.trim() !== '')) riadky.push(riadok)
      riadok = []
    } else {
      pole += z
    }
  }
  riadok.push(pole)
  if (riadok.some((p) => p.trim() !== '')) riadky.push(riadok)
  return riadky
}

function najdiOddelovac(text: string): string {
  const ukazka = text.split(/\r?\n/).slice(0, 40).join('\n')
  const pocty = [';', ',', '\t', '|'].map((o) => [o, ukazka.split(o).length] as const)
  return pocty.sort((a, b) => b[1] - a[1])[0][0]
}

const normalizuj = (s: string) => naHladanie(s).replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Stĺpce podľa názvu v záhlaví. Poradie pravidiel rozhoduje – konkrétnejší
 * názov (napr. „dátum zaúčtovania") má prednosť pred všeobecným.
 */
const STLPCE: [keyof Mapovanie, RegExp[]][] = [
  ['datum', [/^datum (zauctovania|transakcie|pohybu|operacie|realizacie)/, /^(booking|transaction) date/, /^datum/, /date$/, /^datum a cas/]],
  ['prijem', [/^(prijem|pripisane|kredit|credit|pripis)( |$)/]],
  ['vydaj', [/^(vydaj|odpisane|debet|debit|odpis)( |$)/]],
  ['suma', [/^(suma|ciastka|amount|objem|hodnota)( |$)/, /suma/, /ciastka/, /amount/]],
  ['mena', [/^(mena|currency)( |$)/]],
  ['vs', [/^(variabilny symbol|vs|variable symbol)$/, /variabiln/]],
  ['protiucet', [/(protiucet|iban protistrany|iban protiuctu|cislo protiuctu|counterparty account|ucet protistrany)/]],
  ['protistrana', [/(nazov protiuctu|nazov protistrany|protistrana|odosielatel|platca|prikazca|counterparty|nazov platitela|meno protistrany)/]],
  ['sprava', [/(sprava pre prijemcu|sprava|poznamka|informacia|popis|detail|reference|description|ucel platby)/]],
  ['id', [/^(id transakcie|id pohybu|referencia transakcie|transaction id|cislo transakcie|id)$/]],
]

export function najdiStlpce(hlavicka: string[]): Partial<Mapovanie> {
  const mena = hlavicka.map(normalizuj)
  const mapovanie: Partial<Mapovanie> = {}
  const pouzite = new Set<number>()
  for (const [kluc, vzory] of STLPCE) {
    for (const vzor of vzory) {
      const i = mena.findIndex((m, j) => !pouzite.has(j) && vzor.test(m))
      if (i >= 0) {
        mapovanie[kluc] = i
        pouzite.add(i)
        break
      }
    }
  }
  return mapovanie
}

/** Suma v akomkoľvek bežnom zápise: „1 234,56", „-1.234,56", „1,234.56", „+120.00 EUR". */
export function citajSumu(text: string): number | null {
  let s = String(text ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(/[^0-9,.+-]/g, '')
  if (!/\d/.test(s)) return null
  const minus = s.includes('-')
  s = s.replace(/[+-]/g, '')
  const bodka = s.lastIndexOf('.')
  const ciarka = s.lastIndexOf(',')
  if (bodka >= 0 && ciarka >= 0) {
    // Oddeľovač desatín je ten, ktorý je bližšie ku koncu.
    s = bodka > ciarka ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.')
  } else if (ciarka >= 0) {
    s = s.replace(',', '.')
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.round((minus ? -n : n) * 100) / 100
}

/** Dátum „24.09.2026", „24. 9. 2026", „2026-09-24", „24/09/2026" (aj s časom) → RRRR-MM-DD. */
export function citajDatum(text: string): string | null {
  const s = String(text ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

/** Variabilný symbol – zo stĺpca, alebo zo správy v tvare „/VS123/SS/KS". Bez úvodných núl. */
export function citajVs(stlpec: string, sprava: string): string {
  const zoStlpca = String(stlpec ?? '').replace(/\D/g, '')
  const zoSpravy = sprava.match(/(?:^|[^A-Z])VS[:\s]*0*(\d{1,10})/i)?.[1] ?? ''
  return (zoStlpca || zoSpravy).replace(/^0+/, '')
}

export function precitajVypis(obsah: Buffer, rucneMapovanie?: Partial<Mapovanie>): Vypis {
  const text = textVypisu(obsah)
  const riadky = riadkyCsv(text, najdiOddelovac(text))

  // Pred záhlavím býva pár riadkov o účte – záhlavie je prvý riadok, v ktorom
  // sa dá nájsť dátum aj suma (alebo príjem/výdaj).
  let iZahlavia = 0
  let mapovanie: Partial<Mapovanie> = rucneMapovanie ?? {}
  if (!rucneMapovanie) {
    for (let i = 0; i < Math.min(riadky.length, 30); i++) {
      const m = najdiStlpce(riadky[i])
      if (m.datum !== undefined && (m.suma !== undefined || m.prijem !== undefined)) {
        iZahlavia = i
        mapovanie = m
        break
      }
    }
  } else {
    // Pri ručnom priradení je záhlavie prvý riadok, ktorý nie je popis účtu (má dosť stĺpcov).
    const najviac = Math.max(...riadky.slice(0, 30).map((r) => r.length))
    iZahlavia = Math.max(0, riadky.findIndex((r) => r.length === najviac))
  }

  const hlavicka = (riadky[iZahlavia] ?? []).map((h) => h.trim())
  const pohyby: Pohyb[] = []
  let necitatelne = 0
  // Dva rovnaké pohyby v jeden deň (napr. dve splátky po 100 €) nesmú splynúť do jedného.
  const vyskyty = new Map<string, number>()
  const hodnota = (r: string[], i?: number) => (i === undefined ? '' : String(r[i] ?? '').trim())

  if (mapovanie.datum === undefined || (mapovanie.suma === undefined && mapovanie.prijem === undefined)) {
    return { hlavicka, mapovanie, pohyby, necitatelne }
  }

  for (let i = iZahlavia + 1; i < riadky.length; i++) {
    const r = riadky[i]
    const datum = citajDatum(hodnota(r, mapovanie.datum))
    let suma: number | null
    if (mapovanie.suma !== undefined) {
      suma = citajSumu(hodnota(r, mapovanie.suma))
    } else {
      const prijem = citajSumu(hodnota(r, mapovanie.prijem))
      const vydaj = citajSumu(hodnota(r, mapovanie.vydaj))
      suma = prijem ? Math.abs(prijem) : vydaj ? -Math.abs(vydaj) : null
    }
    if (!datum || suma === null || suma === 0) {
      // Súčtové a prázdne riadky na konci výpisu nie sú chyba.
      if (r.some((p) => /\d/.test(p))) necitatelne++
      continue
    }
    const sprava = hodnota(r, mapovanie.sprava)
    const protistrana = hodnota(r, mapovanie.protistrana) || hodnota(r, mapovanie.protiucet)
    const vs = citajVs(hodnota(r, mapovanie.vs), sprava)
    const id = hodnota(r, mapovanie.id)
    let odtlacok = id
      ? 'id:' + id
      : crypto
          .createHash('sha1')
          .update([datum, suma.toFixed(2), vs, hodnota(r, mapovanie.protiucet), protistrana, sprava].join('|'))
          .digest('hex')
    const poradie = (vyskyty.get(odtlacok) ?? 0) + 1
    vyskyty.set(odtlacok, poradie)
    if (poradie > 1) odtlacok += ':' + poradie
    pohyby.push({ riadok: i + 1, datum, suma, mena: hodnota(r, mapovanie.mena).toUpperCase(), vs, protistrana, sprava, odtlacok })
  }
  return { hlavicka, mapovanie, pohyby, necitatelne }
}
