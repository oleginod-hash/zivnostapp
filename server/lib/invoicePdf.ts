import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { encode, PaymentOptions } from 'bysquare'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../db.js'
import { zaokruhli } from './format.js'

/**
 * Faktúra v PDF.
 *
 * Rozloženie vychádza z bežných slovenských faktúr (dodávateľ vľavo, odberateľ
 * vpravo, dátumy, rámček s platobnými údajmi a QR kódom, položky, súčet),
 * aby ju účtovníčka aj odberateľ čítali bez hľadania. Farba je len jedna –
 * akcent z nastavení – a používa sa striedmo: nadpisy sekcií, hlavička
 * tabuľky, rámček platby a súčet.
 *
 * Písmo berieme zo systému, lebo vstavané fonty pdfkit nevedia slovenskú
 * diakritiku. Na Windowse je Segoe UI alebo Arial, na Macu Arial (prípadne
 * Arial Unicode), na Linuxe DejaVu alebo Liberation. Vlastné písmo sa dá
 * nastaviť v .env (PDF_FONT a PDF_FONT_BOLD – cesty k .ttf súborom).
 * Keby sa nenašlo žiadne, PDF vznikne s Helveticou a text sa napíše bez
 * mäkčeňov a dĺžňov – čitateľne, nie rozsypanými znakmi.
 */

const WIN = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')
const MAC = '/System/Library/Fonts/Supplemental'

type SadaFontov = { regular: string; semibold: string; bold: string }
const FONTY: SadaFontov[] = [
  ...(process.env.PDF_FONT?.trim()
    ? [{
        regular: process.env.PDF_FONT.trim(),
        semibold: process.env.PDF_FONT_BOLD?.trim() || process.env.PDF_FONT.trim(),
        bold: process.env.PDF_FONT_BOLD?.trim() || process.env.PDF_FONT.trim(),
      }]
    : []),
  // Windows
  { regular: path.join(WIN, 'segoeui.ttf'), semibold: path.join(WIN, 'seguisb.ttf'), bold: path.join(WIN, 'segoeuib.ttf') },
  { regular: path.join(WIN, 'arial.ttf'), semibold: path.join(WIN, 'arialbd.ttf'), bold: path.join(WIN, 'arialbd.ttf') },
  // macOS
  { regular: `${MAC}/Arial.ttf`, semibold: `${MAC}/Arial Bold.ttf`, bold: `${MAC}/Arial Bold.ttf` },
  { regular: '/Library/Fonts/Arial.ttf', semibold: '/Library/Fonts/Arial Bold.ttf', bold: '/Library/Fonts/Arial Bold.ttf' },
  { regular: `${MAC}/Arial Unicode.ttf`, semibold: `${MAC}/Arial Unicode.ttf`, bold: `${MAC}/Arial Unicode.ttf` },
  // Linux
  {
    regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    semibold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  },
  {
    regular: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    semibold: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    bold: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  },
]
const SADA = FONTY.find((f) => Object.values(f).every((c) => fs.existsSync(c)))
if (!SADA) console.warn('[pdf] nenašlo sa písmo s diakritikou – faktúry budú bez mäkčeňov (nastav PDF_FONT v .env)')
const F = SADA ? 'R' : 'Helvetica'
const FS = SADA ? 'S' : 'Helvetica-Bold'
const FB = SADA ? 'B' : 'Helvetica-Bold'

/**
 * Helvetica v pdfkit pozná len západoeurópske znaky – „č" alebo „ľ" by
 * vyšli ako nezmysly. Bez vhodného písma preto diakritiku radšej odstránime.
 */
function bezDiakritiky(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Keď chýba písmo, všetok text dokumentu pôjde bez diakritiky – aj merania šírky. */
function textBezDiakritikyAkTreba(doc: Doc) {
  if (SADA) return
  for (const metoda of ['text', 'widthOfString', 'heightOfString'] as const) {
    const povodna = (doc as any)[metoda].bind(doc)
    ;(doc as any)[metoda] = (text: unknown, ...zvysok: unknown[]) =>
      povodna(typeof text === 'string' ? bezDiakritiky(text) : text, ...zvysok)
  }
}

export type PdfFaktura = {
  cislo: string
  typ?: string
  kryje_cislo?: string | null
  datum_vystav: string
  datum_dodania: string
  datum_splat: string
  variabilny: string
  poznamka: string
  suma: number
}
export type PdfPolozka = { popis: string; mnozstvo: number; jednotka: string; cena: number }

// A4 = 595,28 × 841,89 bodu
const STRANA = { sirka: 595.28, vyska: 841.89 }
const OKRAJ = 42
const L = OKRAJ
const R = STRANA.sirka - OKRAJ
const SIRKA = R - L
const SPODOK_OBSAHU = 772 // pod týmto už je len päta s číslom strany

const TEXT = '#1f2937'
const SEDA = '#6b7280'
const CIARA = '#e5e7eb'

// ── Farby odvodené z jedného akcentu ────────────────────────────
function rgb(hex: string): [number, number, number] {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '2f6fd6'
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}
function hex([r, g, b]: number[]): string {
  return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')
}
/** Zmieša farbu s bielou (podiel 0–1 = koľko bielej). */
function zosvetli(farba: string, podiel: number): string {
  return hex(rgb(farba).map((c) => c + (255 - c) * podiel))
}
/** Zmieša farbu s čiernou. */
function stmav(farba: string, podiel: number): string {
  return hex(rgb(farba).map((c) => c * (1 - podiel)))
}

// ── Formátovanie ────────────────────────────────────────────────
const cislo2 = (n: number) =>
  new Intl.NumberFormat('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)

/** Na faktúre sa dátum píše s nulami (11.08.2026), tak ho čítajú aj účtovné programy. */
function datum(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [r, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${r}`
}

// ── Ikonky (rovnaké ťahy ako v appke, mriežka 24 × 24) ──────────
type Doc = PDFKit.PDFDocument

function ikona(doc: Doc, druh: 'telefon' | 'mail' | 'web', x: number, y: number, farba: string) {
  const velkost = 9
  doc.save()
  doc.translate(x, y).scale(velkost / 24)
  doc.lineWidth(1.9).strokeColor(farba).lineCap('round').lineJoin('round')
  if (druh === 'telefon') {
    doc
      .path('M6.6 3.5h2.8l1.5 4.3-2 1.4a11.5 11.5 0 0 0 5.9 5.9l1.4-2 4.3 1.5v2.8a2 2 0 0 1-2 2.1A16.5 16.5 0 0 1 4.5 5.6a2 2 0 0 1 2.1-2.1z')
      .stroke()
  } else if (druh === 'mail') {
    doc.roundedRect(3, 5.5, 18, 13, 2.2).stroke()
    doc.path('M3.8 7 12 13.2 20.2 7').stroke()
  } else {
    doc.circle(12, 12, 8.8).stroke()
    doc.path('M3.4 12h17.2M12 3.2c2.4 2.4 3.6 5.3 3.6 8.8s-1.2 6.4-3.6 8.8c-2.4-2.4-3.6-5.3-3.6-8.8S9.6 5.6 12 3.2z').stroke()
  }
  doc.restore()
}

// ── Pomocníci na text ───────────────────────────────────────────
function nadpisSekcie(doc: Doc, text: string, x: number, y: number, farba: string) {
  doc.font(FS).fontSize(7.8).fillColor(farba).text(text.toUpperCase(), x, y, { characterSpacing: 1.1, lineBreak: false })
}

/** Napíše riadok a vráti y pod ním. Prázdne hodnoty preskočí. */
function riadok(
  doc: Doc,
  text: string | undefined | null,
  x: number,
  y: number,
  sirka: number,
  o: { font?: string; velkost?: number; farba?: string; medzera?: number } = {},
): number {
  if (!text) return y
  doc.font(o.font ?? F).fontSize(o.velkost ?? 9.5).fillColor(o.farba ?? TEXT)
  doc.text(text, x, y, { width: sirka, lineGap: 1 })
  return doc.y + (o.medzera ?? 1.5)
}

/** Popis a hodnota na jednom riadku; dlhú hodnotu zmenší, nech sa nezalomí. */
function dvojica(
  doc: Doc,
  popis: string,
  hodnota: string,
  x: number,
  y: number,
  sirkaPopisu: number,
  sirkaHodnoty: number,
  o: { tucne?: boolean; velkost?: number } = {},
): number {
  const velkost = o.velkost ?? 9.5
  let v = velkost
  const font = o.tucne ? FS : F
  while (v > 6.8 && doc.font(font).fontSize(v).widthOfString(hodnota) > sirkaHodnoty) v -= 0.4

  doc.font(F).fontSize(velkost).fillColor(SEDA).text(popis, x, y, { width: sirkaPopisu, lineBreak: false })
  doc.font(font).fontSize(v).fillColor(TEXT)
    .text(hodnota, x + sirkaPopisu, y + (velkost - v) / 2, { width: sirkaHodnoty, lineBreak: false })
  return y + velkost + 6.5
}

// ── Hlavná funkcia ──────────────────────────────────────────────
export async function vytvorFakturuPdf(
  faktura: PdfFaktura,
  polozky: PdfPolozka[],
  firma: Record<string, any> | null,
  nastavenia: Record<string, any>,
): Promise<Buffer> {
  const akcent = /^#[0-9a-f]{6}$/i.test(nastavenia.farba_faktury ?? '') ? nastavenia.farba_faktury : '#2f6fd6'
  const farby = {
    akcent,
    tmavy: stmav(akcent, 0.28),
    podklad: zosvetli(akcent, 0.93),
    ram: zosvetli(akcent, 0.72),
  }
  const zaloha = faktura.typ === 'zaloha'

  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    info: { Title: `${zaloha ? 'Zálohová faktúra' : 'Faktúra'} ${faktura.cislo}`, Author: nastavenia.meno || '' },
  })
  if (SADA) {
    doc.registerFont('R', SADA.regular)
    doc.registerFont('S', SADA.semibold)
    doc.registerFont('B', SADA.bold)
  }
  textBezDiakritikyAkTreba(doc)
  const kusy: Buffer[] = []
  doc.on('data', (c: Buffer) => kusy.push(c))
  const hotovo = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(kusy))))

  // ── Hlavička ──────────────────────────────────────────────────
  doc.rect(0, 0, STRANA.sirka, 5).fill(farby.akcent)

  const nazovDokladu = zaloha ? 'ZÁLOHOVÁ FAKTÚRA' : 'FAKTÚRA'
  doc.font(FB).fontSize(21).fillColor(TEXT).text(nazovDokladu, L, 34, { lineBreak: false })
  doc.font(FB).fontSize(21).fillColor(farby.akcent)
    .text(faktura.cislo, L, 34, { width: SIRKA, align: 'right', lineBreak: false })
  if (zaloha && faktura.kryje_cislo) {
    doc.font(F).fontSize(9).fillColor(SEDA)
      .text(`Záloha k faktúre č. ${faktura.kryje_cislo}`, L, 62, { width: SIRKA, align: 'right' })
  }

  doc.moveTo(L, 80).lineTo(R, 80).lineWidth(0.8).strokeColor(farby.ram).stroke()

  // ── Dodávateľ a odberateľ ─────────────────────────────────────
  const stlpec = (SIRKA - 26) / 2
  const xOdb = L + stlpec + 26
  const yStron = 98

  nadpisSekcie(doc, 'Dodávateľ', L, yStron, farby.akcent)
  let yA = yStron + 17
  yA = riadok(doc, nastavenia.meno, L, yA, stlpec, { font: FS, velkost: 11.5, medzera: 3 })
  yA = riadok(
    doc,
    [nastavenia.adresa, nastavenia.psc_mesto, nastavenia.krajina].filter(Boolean).join(', '),
    L, yA, stlpec, { medzera: 4 },
  )
  yA = riadok(
    doc,
    [nastavenia.ico && `IČO: ${nastavenia.ico}`, nastavenia.dic && `DIČ: ${nastavenia.dic}`].filter(Boolean).join('     '),
    L, yA, stlpec,
  )
  if (nastavenia.ic_dph) yA = riadok(doc, `IČ DPH: ${nastavenia.ic_dph}`, L, yA, stlpec)
  yA = riadok(
    doc,
    nastavenia.dph_rezim === '7a'
      ? 'Nie je platiteľ DPH. Registrovaný pre DPH podľa § 7a zákona o DPH.'
      : 'Nie je platiteľ DPH.',
    L, yA, stlpec, { medzera: 3 },
  )
  // Zápis v registri vyžaduje § 3a Obchodného zákonníka na obchodných listinách.
  const zapis =
    nastavenia.urad_zr || nastavenia.cislo_zr
      ? `Zapísaný v živnostenskom registri${nastavenia.urad_zr ? ` OÚ ${nastavenia.urad_zr}` : ''}` +
        `${nastavenia.cislo_zr ? `, č. ${nastavenia.cislo_zr}` : ''}.`
      : nastavenia.zapis
  yA = riadok(doc, zapis, L, yA, stlpec, { velkost: 8, farba: SEDA, medzera: 3 })

  const kontakty: ['telefon' | 'mail' | 'web', string][] = []
  if (nastavenia.telefon) kontakty.push(['telefon', nastavenia.telefon])
  if (nastavenia.email) kontakty.push(['mail', nastavenia.email])
  if (nastavenia.web) kontakty.push(['web', nastavenia.web])
  if (kontakty.length) {
    yA += 8
    yA = riadok(doc, 'Kontaktné údaje', L, yA, stlpec, { font: FS, velkost: 9.5, medzera: 4 })
    for (const [druh, hodnota] of kontakty) {
      ikona(doc, druh, L, yA + 2.2, farby.akcent)
      yA = riadok(doc, hodnota, L + 15, yA, stlpec - 15, { medzera: 2.5 })
    }
  }

  nadpisSekcie(doc, 'Odberateľ', xOdb, yStron, farby.akcent)
  let yB = yStron + 17
  if (firma) {
    yB = riadok(doc, firma.nazov, xOdb, yB, stlpec, { font: FS, velkost: 11.5, medzera: 3 })
    yB = riadok(doc, firma.kontaktna_osoba, xOdb, yB, stlpec)
    yB = riadok(doc, firma.adresa, xOdb, yB, stlpec)
    yB = riadok(doc, firma.psc_mesto, xOdb, yB, stlpec)
    yB = riadok(doc, firma.krajina, xOdb, yB, stlpec, { medzera: 8 })
    yB = riadok(
      doc,
      [firma.ico && `IČO: ${firma.ico}`, firma.dic && `DIČ: ${firma.dic}`].filter(Boolean).join('     '),
      xOdb, yB, stlpec,
    )
    yB = riadok(doc, firma.ic_dph && `IČ DPH: ${firma.ic_dph}`, xOdb, yB, stlpec)
  } else {
    yB = riadok(doc, '(odberateľ neuvedený)', xOdb, yB, stlpec, { farba: SEDA })
  }

  // ── Dátumy a platba ───────────────────────────────────────────
  let y = Math.max(yA, yB) + 18
  const sirkaBoxu = 300
  const xBox = R - sirkaBoxu
  const vyskaBoxu = nastavenia.banka ? 132 : 104

  let yD = y + 14
  yD = dvojica(doc, 'Dátum vystavenia:', datum(faktura.datum_vystav), L, yD, 96, 90)
  yD = dvojica(doc, 'Dátum dodania:', datum(faktura.datum_dodania), L, yD, 96, 90)
  dvojica(doc, 'Splatnosť:', datum(faktura.datum_splat), L, yD, 96, 90, { tucne: true })

  doc.roundedRect(xBox, y, sirkaBoxu, vyskaBoxu, 7).lineWidth(0.8).fillAndStroke(farby.podklad, farby.ram)

  const qrVelkost = 80
  const xVnutri = xBox + 16
  const sirkaTextuBoxu = sirkaBoxu - qrVelkost - 46
  const polStlpca = sirkaTextuBoxu / 2
  const vs = (faktura.variabilny || faktura.cislo).replace(/\s/g, '')

  /** Malý popis a pod ním hodnota – čitateľnejšie než dvojica vedľa seba. */
  const udaj = (popis: string, hodnota: string, x: number, yU: number, sirka: number, velka = false) => {
    doc.font(FS).fontSize(6.8).fillColor(SEDA)
      .text(popis.toUpperCase(), x, yU, { width: sirka, characterSpacing: 0.5, lineBreak: false })
    let v = velka ? 11 : 9.6
    const font = velka ? FB : FS
    while (v > 7 && doc.font(font).fontSize(v).widthOfString(hodnota) > sirka) v -= 0.3
    doc.font(font).fontSize(v).fillColor(velka ? farby.tmavy : TEXT)
      .text(hodnota, x, yU + 10, { width: sirka, lineBreak: false })
  }

  let yP = y + 14
  udaj('Suma', `${cislo2(faktura.suma)} EUR`, xVnutri, yP, polStlpca - 6, true)
  udaj('Variabilný symbol', vs, xVnutri + polStlpca, yP, polStlpca, true)
  yP += 31
  udaj('IBAN', nastavenia.iban || '—', xVnutri, yP, sirkaTextuBoxu)
  yP += 29
  udaj('SWIFT', nastavenia.swift || '—', xVnutri, yP, polStlpca - 6)
  udaj('Spôsob úhrady', nastavenia.sposob_uhrady || 'Bankový prevod', xVnutri + polStlpca, yP, polStlpca)
  if (nastavenia.banka) {
    yP += 29
    udaj('Banka', nastavenia.banka, xVnutri, yP, sirkaTextuBoxu)
  }

  // QR kód PAY by square – odberateľ ho naskenuje v mobilnej banke.
  if (nastavenia.iban && faktura.suma > 0) {
    try {
      const qr = encode({
        invoiceId: faktura.cislo,
        payments: [
          {
            type: PaymentOptions.PaymentOrder,
            amount: faktura.suma,
            currencyCode: 'EUR',
            bankAccounts: [{ iban: String(nastavenia.iban).replace(/\s/g, '') }],
            variableSymbol: vs.replace(/\D/g, '').slice(0, 10),
            paymentDueDate: faktura.datum_splat,
          },
        ],
      })
      const png = await QRCode.toBuffer(qr, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      const xQr = xBox + sirkaBoxu - qrVelkost - 14
      const yQr = y + (vyskaBoxu - qrVelkost - 14) / 2
      doc.roundedRect(xQr - 3, yQr - 3, qrVelkost + 6, qrVelkost + 6, 4).fill('#ffffff')
      doc.image(png, xQr, yQr, { width: qrVelkost })
      doc.font(FS).fontSize(6.8).fillColor(farby.tmavy)
        .text('PAY by square', xQr - 3, yQr + qrVelkost + 5, { width: qrVelkost + 6, align: 'center', lineBreak: false })
    } catch {
      // QR nie je kritický – ak sa nepodarí (napr. neplatný IBAN), faktúra vyjde bez neho.
    }
  }

  y += vyskaBoxu + 26

  // ── Položky ───────────────────────────────────────────────────
  // Jednotka je priamo pri množstve (napr. „37,50 hod") – samostatný stĺpec
  // by zbytočne zúžil názov, ktorý je na faktúre najdôležitejší.
  const sirkaSpolu = 76
  const sirkaCeny = 70
  const sirkaMnozstva = 72
  const xC = L + 10
  const xNazov = L + 30
  const xSpolu = R - 10 - sirkaSpolu
  const xCena = xSpolu - 10 - sirkaCeny
  const xMn = xCena - 10 - sirkaMnozstva
  const sirkaNazvu = xMn - 14 - xNazov

  function hlavickaTabulky(yH: number): number {
    doc.roundedRect(L, yH, SIRKA, 22, 4).fill(farby.podklad)
    doc.font(FS).fontSize(7.8).fillColor(farby.tmavy)
    const o = { characterSpacing: 0.6, lineBreak: false } as const
    doc.text('Č.', xC, yH + 7, o)
    doc.text('NÁZOV', xNazov, yH + 7, o)
    doc.text('MNOŽSTVO', xMn, yH + 7, { ...o, width: sirkaMnozstva, align: 'right' })
    doc.text('JEDN. CENA', xCena, yH + 7, { ...o, width: sirkaCeny, align: 'right' })
    doc.text('SPOLU', xSpolu, yH + 7, { ...o, width: sirkaSpolu, align: 'right' })
    return yH + 30
  }

  y = hlavickaTabulky(y)

  polozky.forEach((p, i) => {
    const popis = p.popis || '—'
    doc.font(FS).fontSize(9.5)
    const vyska = Math.max(doc.heightOfString(popis, { width: sirkaNazvu, lineGap: 1 }), 12)
    if (y + vyska + 10 > SPODOK_OBSAHU) {
      doc.addPage()
      doc.rect(0, 0, STRANA.sirka, 5).fill(farby.akcent)
      y = hlavickaTabulky(40)
    }
    const spolu = zaokruhli(p.mnozstvo * p.cena)
    const mnozstvo = `${cislo2(p.mnozstvo)}${p.jednotka ? ' ' + p.jednotka : ''}`
    doc.font(F).fontSize(9.5).fillColor(SEDA).text(`${i + 1}.`, xC, y, { width: 18, lineBreak: false })
    doc.font(FS).fontSize(9.5).fillColor(TEXT).text(popis, xNazov, y, { width: sirkaNazvu, lineGap: 1 })
    doc.font(F).fontSize(9.5).fillColor(TEXT)
    doc.text(mnozstvo, xMn, y, { width: sirkaMnozstva, align: 'right', lineBreak: false })
    doc.text(cislo2(p.cena), xCena, y, { width: sirkaCeny, align: 'right', lineBreak: false })
    doc.font(FS).text(cislo2(spolu), xSpolu, y, { width: sirkaSpolu, align: 'right', lineBreak: false })
    y += vyska + 7
    doc.moveTo(L + 6, y - 1).lineTo(R - 6, y - 1).lineWidth(0.6).strokeColor(CIARA).stroke()
    y += 7
  })

  // ── Súčet ─────────────────────────────────────────────────────
  if (y + 150 > SPODOK_OBSAHU) {
    doc.addPage()
    doc.rect(0, 0, STRANA.sirka, 5).fill(farby.akcent)
    y = 50
  }
  y += 6
  const sirkaSuctu = 262
  doc.roundedRect(R - sirkaSuctu, y, sirkaSuctu, 36, 6).fill(farby.podklad)
  doc.font(FS).fontSize(11).fillColor(farby.tmavy)
    .text(zaloha ? 'Záloha na úhradu' : 'Spolu na úhradu', R - sirkaSuctu + 14, y + 12, { lineBreak: false })
  doc.font(FB).fontSize(14.5).fillColor(farby.tmavy)
    .text(`${cislo2(faktura.suma)} EUR`, R - sirkaSuctu, y + 9.5, { width: sirkaSuctu - 14, align: 'right', lineBreak: false })
  y += 56

  // ── Poznámky ──────────────────────────────────────────────────
  // Ručne pridané značky „[odoslané na …]" sú pre mňa, nie pre odberateľa.
  const poznamka = String(faktura.poznamka ?? '').replace(/\[[^\]]*odoslané na[^\]]*\]/g, '').trim()
  const pata = String(nastavenia.poznamka_pati ?? '').trim()
  const yPoznamok = y
  let yN = y
  if (poznamka) {
    yN = riadok(doc, 'Poznámka', L, yN, 250, { font: FS, velkost: 9, medzera: 2 })
    yN = riadok(doc, poznamka, L, yN, 250, { velkost: 9, farba: '#374151', medzera: 8 })
  }
  if (pata) yN = riadok(doc, pata, L, yN, 250, { velkost: 8.5, farba: SEDA })

  // ── Pečiatka a podpis ─────────────────────────────────────────
  const ySpodpis = Math.max(yPoznamok + 46, yN + 10)
  const xPodpis = R - 170
  doc.moveTo(xPodpis, ySpodpis).lineTo(R - 10, ySpodpis).lineWidth(0.7).strokeColor('#9ca3af').stroke()
  doc.font(F).fontSize(8.5).fillColor(SEDA)
    .text('Pečiatka a podpis', xPodpis, ySpodpis + 5, { width: 160, align: 'center', lineBreak: false })

  // ── Päta s číslom strany na každej strane ─────────────────────
  const rozsah = doc.bufferedPageRange()
  for (let i = 0; i < rozsah.count; i++) {
    doc.switchToPage(rozsah.start + i)
    doc.moveTo(L, 804).lineTo(R, 804).lineWidth(0.6).strokeColor(CIARA).stroke()
    doc.font(F).fontSize(7.5).fillColor('#9ca3af')
    doc.text(`${zaloha ? 'Zálohová faktúra' : 'Faktúra'} ${faktura.cislo}`, L, 811, { lineBreak: false })
    doc.text(`Strana ${i + 1}/${rozsah.count}`, L, 811, { width: SIRKA, align: 'right', lineBreak: false })
  }

  doc.end()
  return hotovo
}

/**
 * Načíta všetko potrebné k faktúre a vyrobí PDF. Používa ho stiahnutie
 * aj odoslanie mailom, aby obe cesty dávali presne tú istú faktúru.
 */
export async function fakturaPdfPodlaId(id: number | string): Promise<{ pdf: Buffer; nazov: string } | null> {
  const f = db
    .prepare(
      `SELECT i.*, k.cislo AS kryje_cislo FROM invoices i
       LEFT JOIN invoices k ON k.id = i.kryje_id WHERE i.id = ?`,
    )
    .get(id) as any
  if (!f) return null
  const polozky = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY poradie, id')
    .all(id) as PdfPolozka[]
  const firma = f.company_id ? (db.prepare('SELECT * FROM companies WHERE id = ?').get(f.company_id) as any) : null
  const nastavenia = db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, any>

  const pdf = await vytvorFakturuPdf(f, polozky, firma, nastavenia)
  const predpona = f.typ === 'zaloha' ? 'Zalohova-faktura' : 'Faktura'
  return { pdf, nazov: `${predpona}-${String(f.cislo).replace(/[^\w.-]/g, '_')}.pdf` }
}
