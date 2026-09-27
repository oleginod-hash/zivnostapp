import { citajXml, deti, dieta, text, type Prvok } from './xml.js'
import { zaokruhli } from './format.js'

/**
 * Prijatá e-faktúra od dodávateľa. Od roku 2027 ich na Slovensku doručuje
 * „digitálny poštár" (Peppol) ako XML podľa normy EN 16931 – najčastejšie vo
 * formáte UBL (Peppol BIS Billing 3.0), niekedy CII. Z XML zoberieme údaje
 * pre výdavok a PDF, ktoré býva vložené priamo v ňom.
 */
export type Strana = { nazov: string; ico: string; dic: string; ic_dph: string; adresa: string }

export type Efaktura = {
  format: 'UBL' | 'CII'
  /** Dobropis (opravná faktúra) – suma je záporná. */
  dobropis: boolean
  cislo: string
  datum: string
  splatnost: string
  mena: string
  /** Celková suma s DPH – to je výdavok. */
  suma: number
  /** Koľko ostáva zaplatiť (po odpočítaní zálohy). */
  k_uhrade: number
  dph: number
  dodavatel: Strana
  odberatel: Strana
  vs: string
  iban: string
  polozky: string[]
  pdf: { nazov: string; data: Buffer } | null
}

const cislo = (t: string) => {
  const n = Number(String(t).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const lenCislice = (t: string) => String(t ?? '').replace(/\D/g, '')

/** Dátum 20260915 (CII, formát 102) alebo 2026-09-15 na RRRR-MM-DD. */
function datum(t: string): string {
  const s = String(t ?? '').trim()
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''
}

/** Variabilný symbol – z „VS 2026123" alebo „2026123/0308" nechá číslice, najviac 10. */
function vs(t: string): string {
  const s = String(t ?? '').trim()
  const zVs = s.match(/VS\D{0,3}(\d{1,10})/i)?.[1]
  if (zVs) return zVs
  // „2026123/0308" – pred lomkou je VS, za ňou konštantný symbol.
  return (s.match(/\d+/)?.[0] ?? '').slice(0, 10)
}

function pdfZPrilohy(obj: Prvok | undefined, cisloFaktury: string): Efaktura['pdf'] {
  if (!obj?.text.trim()) return null
  const mime = (obj.atributy.mimeCode ?? '').toLowerCase()
  const nazov = obj.atributy.filename ?? ''
  if (mime !== 'application/pdf' && !/\.pdf$/i.test(nazov)) return null
  const data = Buffer.from(obj.text, 'base64')
  if (data.subarray(0, 5).toString() !== '%PDF-') return null
  return { nazov: nazov || `Faktúra ${cisloFaktury}.pdf`, data }
}

// ── UBL (Peppol BIS Billing 3.0) ──────────────────────────────
function stranaUbl(party: Prvok | undefined): Strana {
  const ico =
    lenCislice(text(party, 'PartyLegalEntity', 'CompanyID')) ||
    lenCislice(deti(party, 'PartyIdentification').map((p) => text(p, 'ID')).find((id) => /^\d{6,8}$/.test(lenCislice(id))) ?? '')
  const endpoint = dieta(party, 'EndpointID')
  const icDph = deti(party, 'PartyTaxScheme').map((p) => text(p, 'CompanyID')).find(Boolean) ?? ''
  const adr = dieta(party, 'PostalAddress')
  return {
    nazov: text(party, 'PartyLegalEntity', 'RegistrationName') || text(party, 'PartyName', 'Name'),
    ico: ico.length <= 8 ? ico : '',
    // Peppol ID slovenskej firmy je jej DIČ (schéma 0245).
    dic: endpoint?.atributy.schemeID === '0245' ? lenCislice(endpoint.text) : '',
    ic_dph: icDph.replace(/\s/g, ''),
    adresa: [text(adr, 'StreetName'), [text(adr, 'PostalZone'), text(adr, 'CityName')].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
  }
}

function citajUbl(koren: Prvok): Efaktura {
  const dobropis = koren.nazov === 'CreditNote' || text(koren, 'InvoiceTypeCode') === '381'
  const znamienko = dobropis ? -1 : 1
  const suma = dieta(koren, 'LegalMonetaryTotal')
  const platba = deti(koren, 'PaymentMeans')
  const cisloFaktury = text(koren, 'ID')
  const pdf =
    deti(koren, 'AdditionalDocumentReference')
      .map((r) => pdfZPrilohy(dieta(r, 'Attachment', 'EmbeddedDocumentBinaryObject'), cisloFaktury))
      .find(Boolean) ?? null
  const riadky = deti(koren, dobropis && koren.nazov === 'CreditNote' ? 'CreditNoteLine' : 'InvoiceLine')
  const sDph = cislo(text(suma, 'TaxInclusiveAmount')) || cislo(text(suma, 'PayableAmount'))
  return {
    format: 'UBL',
    dobropis,
    cislo: cisloFaktury,
    datum: datum(text(koren, 'IssueDate')),
    splatnost: datum(text(koren, 'DueDate') || text(koren, 'PaymentTerms', 'PaymentDueDate')),
    mena: (text(koren, 'DocumentCurrencyCode') || 'EUR').toUpperCase(),
    suma: zaokruhli(znamienko * Math.abs(sDph)),
    k_uhrade: zaokruhli(znamienko * Math.abs(cislo(text(suma, 'PayableAmount')))),
    dph: zaokruhli(deti(koren, 'TaxTotal').reduce((s, t) => s + cislo(text(t, 'TaxAmount')), 0) * znamienko),
    dodavatel: stranaUbl(dieta(koren, 'AccountingSupplierParty', 'Party')),
    odberatel: stranaUbl(dieta(koren, 'AccountingCustomerParty', 'Party')),
    vs: vs(platba.map((p) => text(p, 'PaymentID')).find(Boolean) ?? ''),
    iban: (platba.map((p) => text(p, 'PayeeFinancialAccount', 'ID')).find(Boolean) ?? '').replace(/\s/g, ''),
    polozky: riadky.map((r) => text(r, 'Item', 'Name') || text(r, 'Note')).filter(Boolean),
    pdf,
  }
}

// ── CII (UN/CEFACT Cross Industry Invoice) ────────────────────
function stranaCii(p: Prvok | undefined): Strana {
  const adr = dieta(p, 'PostalTradeAddress')
  const registracie = deti(p, 'SpecifiedTaxRegistration').map((r) => dieta(r, 'ID'))
  return {
    nazov: text(p, 'Name'),
    ico: lenCislice(text(p, 'SpecifiedLegalOrganization', 'ID')).slice(0, 8),
    dic: lenCislice(registracie.find((r) => r?.atributy.schemeID === 'FC')?.text ?? ''),
    ic_dph: (registracie.find((r) => r?.atributy.schemeID === 'VA')?.text ?? '').replace(/\s/g, ''),
    adresa: [text(adr, 'LineOne'), [text(adr, 'PostcodeCode'), text(adr, 'CityName')].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
  }
}

function citajCii(koren: Prvok): Efaktura {
  const doklad = dieta(koren, 'ExchangedDocument')
  const obchod = dieta(koren, 'SupplyChainTradeTransaction')
  const dohoda = dieta(obchod, 'ApplicableHeaderTradeAgreement')
  const vyrovnanie = dieta(obchod, 'ApplicableHeaderTradeSettlement')
  const sucty = dieta(vyrovnanie, 'SpecifiedTradeSettlementHeaderMonetarySummation')
  const dobropis = text(doklad, 'TypeCode') === '381'
  const znamienko = dobropis ? -1 : 1
  const cisloFaktury = text(doklad, 'ID')
  const pdf =
    deti(dohoda, 'AdditionalReferencedDocument')
      .map((r) => pdfZPrilohy(dieta(r, 'AttachmentBinaryObject'), cisloFaktury))
      .find(Boolean) ?? null
  return {
    format: 'CII',
    dobropis,
    cislo: cisloFaktury,
    datum: datum(text(doklad, 'IssueDateTime', 'DateTimeString')),
    splatnost: datum(text(vyrovnanie, 'SpecifiedTradePaymentTerms', 'DueDateDateTime', 'DateTimeString')),
    mena: (text(vyrovnanie, 'InvoiceCurrencyCode') || 'EUR').toUpperCase(),
    suma: zaokruhli(znamienko * Math.abs(cislo(text(sucty, 'GrandTotalAmount')) || cislo(text(sucty, 'DuePayableAmount')))),
    k_uhrade: zaokruhli(znamienko * Math.abs(cislo(text(sucty, 'DuePayableAmount')))),
    dph: zaokruhli(znamienko * cislo(text(sucty, 'TaxTotalAmount'))),
    dodavatel: stranaCii(dieta(dohoda, 'SellerTradeParty')),
    odberatel: stranaCii(dieta(dohoda, 'BuyerTradeParty')),
    vs: vs(text(vyrovnanie, 'PaymentReference')),
    iban: text(vyrovnanie, 'SpecifiedTradeSettlementPaymentMeans', 'PayeePartyCreditorFinancialAccount', 'IBANID').replace(/\s/g, ''),
    polozky: deti(obchod, 'IncludedSupplyChainTradeLineItem')
      .map((r) => text(r, 'SpecifiedTradeProduct', 'Name'))
      .filter(Boolean),
    pdf,
  }
}

export function citajEfakturu(xml: string | Buffer): Efaktura {
  const obsah = Buffer.isBuffer(xml) ? xml.toString('utf8') : xml
  let koren: Prvok
  try {
    koren = citajXml(obsah.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('Súbor sa nedá prečítať ako XML.')
  }
  if (koren.nazov === 'Invoice' || koren.nazov === 'CreditNote') return citajUbl(koren)
  if (koren.nazov === 'CrossIndustryInvoice') return citajCii(koren)
  throw new Error('Súbor nie je e-faktúra (UBL ani CII).')
}
