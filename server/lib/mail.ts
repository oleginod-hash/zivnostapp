import nodemailer from 'nodemailer'
import { db } from '../db.js'
import { skDatum, skSuma } from './format.js'
import { otvorenyZostatok } from './platby.js'

/**
 * Odosielanie e-mailov cez SMTP účet používateľa. Prihlasovacie údaje sú
 * v .env, appka ich nikam neposiela – pripája sa priamo na jeho poštový server.
 */
export function mailNastaveny(): boolean {
  return !!(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim())
}

export function mailOdosielatel(): string {
  return process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || ''
}

function prenos() {
  const port = Number(process.env.SMTP_PORT) || 587
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
}

export async function posliMail(vstup: {
  komu: string
  predmet: string
  text: string
  prilohy?: { filename: string; content: Buffer }[]
}): Promise<void> {
  if (!mailNastaveny()) throw new Error('SMTP nie je nastavené. Doplň SMTP_HOST a spol. do .env.')
  await prenos().sendMail({
    from: mailOdosielatel(),
    to: vstup.komu,
    subject: vstup.predmet,
    text: vstup.text,
    attachments: vstup.prilohy,
  })
}

export async function overSpojenie(): Promise<void> {
  if (!mailNastaveny()) throw new Error('SMTP nie je nastavené.')
  await prenos().verify()
}

// ── Predpripravené texty ──────────────────────────────────────
type Kontext = { faktura: any; firma: any; nastavenia: any }

function nacitajKontext(invoiceId: number): Kontext {
  const faktura = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any
  if (!faktura) throw new Error('Faktúra neexistuje.')
  const firma = faktura.company_id
    ? (db.prepare('SELECT * FROM companies WHERE id = ?').get(faktura.company_id) as any)
    : null
  const nastavenia = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any
  return { faktura, firma, nastavenia }
}

/** Sprievodný text k odoslaniu faktúry. */
export function textFaktury(invoiceId: number, jazyk: 'sk' | 'en' | 'de' = 'sk') {
  const { faktura, firma, nastavenia } = nacitajKontext(invoiceId)
  const meno = nastavenia?.meno || ''
  const c = faktura.cislo

  const texty = {
    sk: {
      predmet: `Faktúra ${c}`,
      text: `Dobrý deň,

v prílohe posielam faktúru ${c} na sumu ${skSuma(faktura.suma)} so splatnosťou ${skDatum(faktura.datum_splat)}.

Platbu, prosím, pošlite na účet ${nastavenia?.iban || ''} s variabilným symbolom ${faktura.variabilny || c}.

Ďakujem a prajem pekný deň.
${meno}`,
    },
    en: {
      predmet: `Invoice ${c}`,
      text: `Dear Sir or Madam,

please find attached invoice ${c} for ${skSuma(faktura.suma)}, due on ${skDatum(faktura.datum_splat)}.

Please transfer the payment to IBAN ${nastavenia?.iban || ''}, reference ${faktura.variabilny || c}.

Thank you and best regards,
${meno}`,
    },
    de: {
      predmet: `Rechnung ${c}`,
      text: `Sehr geehrte Damen und Herren,

anbei sende ich Ihnen die Rechnung ${c} über ${skSuma(faktura.suma)}, zahlbar bis ${skDatum(faktura.datum_splat)}.

Bitte überweisen Sie den Betrag auf das Konto ${nastavenia?.iban || ''}, Verwendungszweck ${faktura.variabilny || c}.

Vielen Dank und freundliche Grüße,
${meno}`,
    },
  }

  return { ...texty[jazyk], komu: firma?.email ?? '', firma: firma?.nazov ?? '' }
}

/** Upomienka na faktúru po splatnosti. Tón sa stupňuje podľa počtu dní. */
export function textUpomienky(invoiceId: number, jazyk: 'sk' | 'en' | 'de' = 'sk') {
  const { faktura, firma, nastavenia } = nacitajKontext(invoiceId)
  const meno = nastavenia?.meno || ''
  const c = faktura.cislo
  // Pýtame to, čo naozaj chýba – po čiastočnej úhrade alebo po zaplatenej
  // zálohe je to menej než pôvodná suma faktúry.
  const dlzna = otvorenyZostatok(invoiceId)
  // Poistka proti trápnosti: upomienku na zaplatenú faktúru radšej vôbec
  // nevygenerujeme, než by mala klientovi odísť výzva na 0,00 €.
  if (dlzna <= 0.005) {
    throw new Error(`Faktúra ${faktura.cislo} je už uhradená – upomienka nemá čo pýtať.`)
  }
  const ciastocne = dlzna < faktura.suma - 0.005

  const dniPo = Math.max(
    0,
    Math.round((Date.now() - new Date(faktura.datum_splat + 'T12:00:00').getTime()) / 86400000),
  )

  const texty = {
    sk: {
      predmet: `Upomienka – faktúra ${c}`,
      text: `Dobrý deň,

dovoľujem si upozorniť, že faktúra ${c} na sumu ${skSuma(faktura.suma)} bola splatná ${skDatum(faktura.datum_splat)}, teda pred ${dniPo} dňami.${
        ciastocne
          ? ` K dnešnému dňu z nej evidujem uhradených ${skSuma(faktura.suma - dlzna)}, zostáva teda ${skSuma(dlzna)}.`
          : ' K dnešnému dňu evidujem, že nebola uhradená.'
      }

Ak už platba prebehla, považujte, prosím, túto správu za bezpredmetnú a dajte mi vedieť.
V opačnom prípade vás prosím o úhradu na účet ${nastavenia?.iban || ''}, variabilný symbol ${faktura.variabilny || c}.

Ďakujem.
${meno}`,
    },
    en: {
      predmet: `Payment reminder – invoice ${c}`,
      text: `Dear Sir or Madam,

invoice ${c} for ${skSuma(faktura.suma)} was due on ${skDatum(faktura.datum_splat)}, that is ${dniPo} days ago.${
        ciastocne
          ? ` So far I have received ${skSuma(faktura.suma - dlzna)}, so ${skSuma(dlzna)} is still outstanding.`
          : ' I have not received the payment yet.'
      }

If the payment has already been made, please disregard this message and let me know.
Otherwise I kindly ask you to transfer the amount to IBAN ${nastavenia?.iban || ''}, reference ${faktura.variabilny || c}.

Thank you.
${meno}`,
    },
    de: {
      predmet: `Zahlungserinnerung – Rechnung ${c}`,
      text: `Sehr geehrte Damen und Herren,

die Rechnung ${c} über ${skSuma(faktura.suma)} war am ${skDatum(faktura.datum_splat)} fällig, also vor ${dniPo} Tagen.${
        ciastocne
          ? ` Bisher sind ${skSuma(faktura.suma - dlzna)} eingegangen, offen sind noch ${skSuma(dlzna)}.`
          : ' Sie ist bis heute nicht beglichen.'
      }

Sollte die Zahlung bereits erfolgt sein, betrachten Sie diese Nachricht bitte als gegenstandslos.
Andernfalls bitte ich Sie um Überweisung auf das Konto ${nastavenia?.iban || ''}, Verwendungszweck ${faktura.variabilny || c}.

Vielen Dank.
${meno}`,
    },
  }

  return { ...texty[jazyk], komu: firma?.email ?? '', firma: firma?.nazov ?? '', dni_po_splatnosti: dniPo }
}
