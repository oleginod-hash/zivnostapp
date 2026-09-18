import { db } from '../db.js'
import { zaokruhli } from './format.js'

/**
 * Platby k faktúram.
 *
 * Zaplatenosť faktúry sa nikde neukladá – vyplýva zo súčtu prijatých platieb.
 * Rovnaký princíp ako pri stave „po splatnosti": nedá sa to rozsynchronizovať.
 *
 * Dôležité pre daň: do príjmov ide suma podľa DÁTUMU PLATBY, nie podľa dátumu
 * vystavenia faktúry. Preto sú platby samostatné riadky s vlastným dátumom.
 */

/** Peniaze prijaté priamo na túto faktúru. Toto je príjem pre daň. */
const PRIJATE = `(SELECT COALESCE(SUM(p.suma), 0) FROM invoice_payments p WHERE p.invoice_id = i.id)`

/**
 * Peniaze, ktoré na túto faktúru prišli cez zálohové faktúry, ktoré ju kryjú.
 * Do príjmu sa nerátajú znova – tam figurujú pod tou zálohovou faktúrou.
 * Slúžia na to, aby bolo vidieť, koľko z pôvodného dlhu je reálne splatené.
 */
const KRYTE = `(SELECT COALESCE(SUM(p2.suma), 0)
                FROM invoice_payments p2
                JOIN invoices z ON z.id = p2.invoice_id
                WHERE z.kryje_id = i.id)`

/** Koľko z faktúry je uhradené dokopy – priamo aj cez krycie zálohy. */
export const UHRADENE_SQL = `(${PRIJATE} + ${KRYTE})`

/**
 * Faktúra, ktorá sa ráta do „vyfakturovaného": nie koncept a nie zálohová
 * faktúra kryjúca starý dlh (tá je len jeho splátkou, suma je už v pôvodnej).
 */
export const VYFAKTUROVANE_SQL = `(i.stav <> 'koncept' AND i.kryje_id IS NULL)`

/** Koľko z faktúry je uhradené a čo z toho vyplýva pre jej stav. */
export const PLATBY_SQL = `
  ${PRIJATE} AS prijate,
  ${KRYTE} AS prijate_zalohami,
  ${UHRADENE_SQL} AS uhradene_spolu,
  ROUND(i.suma - ${PRIJATE}, 2) AS zostatok,
  (SELECT MAX(p.datum) FROM invoice_payments p WHERE p.invoice_id = i.id) AS datum_poslednej_platby,
  (SELECT MAX(x.datum) FROM (
     SELECT p.datum FROM invoice_payments p WHERE p.invoice_id = i.id
     UNION ALL
     SELECT p2.datum FROM invoice_payments p2
       JOIN invoices z ON z.id = p2.invoice_id WHERE z.kryje_id = i.id
   ) x) AS datum_poslednej_uhrady,
  (SELECT COUNT(*) FROM invoice_payments p WHERE p.invoice_id = i.id) AS pocet_platieb`

/**
 * Stav faktúry odvodený z úhrad a splatnosti.
 * koncept → vystavena → ciastocne → zaplatena, a k tomu po_splatnosti.
 *
 * Faktúra, ktorú plne pokryli zaplatené zálohové faktúry, je vyplatená –
 * peniaze prišli, len pod iným číslom dokladu.
 */
export const STAV_SQL = `
  CASE
    WHEN i.stav = 'koncept' THEN 'koncept'
    WHEN ${UHRADENE_SQL} >= i.suma - 0.005 THEN 'zaplatena'
    WHEN ${UHRADENE_SQL} > 0
      THEN CASE WHEN i.datum_splat < date('now') THEN 'po_splatnosti_ciastocne' ELSE 'ciastocne' END
    WHEN i.datum_splat < date('now') THEN 'po_splatnosti'
    ELSE 'vystavena'
  END AS stav_zobraz`

/**
 * Koľko z faktúry ešte reálne čakám. Pri pôvodnej faktúre, ktorú kryjú
 * zálohové faktúry, sa od zostatku odráta aj to, čo prišlo na tie zálohy –
 * inak by sa ten istý dlh počítal dvakrát.
 */
export const OTVORENY_ZOSTATOK_SQL = `ROUND(i.suma - ${UHRADENE_SQL}, 2) AS otvoreny_zostatok`

export type Platba = { id: number; invoice_id: number; datum: string; suma: number; poznamka: string }

export function platbyFaktury(invoiceId: number | string): Platba[] {
  return db
    .prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY datum, id')
    .all(invoiceId) as Platba[]
}

export function pridajPlatbu(invoiceId: number, datum: string, suma: number, poznamka = ''): number {
  const info = db
    .prepare('INSERT INTO invoice_payments (invoice_id, datum, suma, poznamka) VALUES (?, ?, ?, ?)')
    .run(invoiceId, datum, zaokruhli(suma), poznamka.trim())
  return Number(info.lastInsertRowid)
}

/** Prepíše celý zoznam platieb faktúry (používa sa pri úprave faktúry). */
export function nastavPlatby(
  invoiceId: number,
  platby: { datum: string; suma: number; poznamka?: string }[],
): void {
  const uloz = db.transaction(() => {
    db.prepare('DELETE FROM invoice_payments WHERE invoice_id = ?').run(invoiceId)
    const vloz = db.prepare(
      'INSERT INTO invoice_payments (invoice_id, datum, suma, poznamka) VALUES (?, ?, ?, ?)',
    )
    for (const p of platby) {
      const datum = String(p.datum ?? '').slice(0, 10)
      const suma = zaokruhli(Number(p.suma) || 0)
      if (!datum || suma === 0) continue
      vloz.run(invoiceId, datum, suma, String(p.poznamka ?? '').trim())
    }
  })
  uloz()
}

/** Koľko z faktúry ešte reálne čaká na zaplatenie (vrátane krytia zálohami). */
export function otvorenyZostatok(invoiceId: number | string): number {
  const r = db
    .prepare(`SELECT ${OTVORENY_ZOSTATOK_SQL} FROM invoices i WHERE i.id = ?`)
    .get(invoiceId) as { otvoreny_zostatok: number } | undefined
  return r?.otvoreny_zostatok ?? 0
}

/**
 * Zálohové faktúry, ktoré kryjú danú pôvodnú faktúru, aj s tým,
 * koľko z nich už reálne prišlo na účet.
 */
export function kryciePlatby(invoiceId: number | string) {
  return db
    .prepare(
      `SELECT i.id, i.cislo, i.suma, i.datum_vystav, i.datum_splat, ${PLATBY_SQL}, ${STAV_SQL}
       FROM invoices i WHERE i.kryje_id = ? ORDER BY i.datum_vystav, i.id`,
    )
    .all(invoiceId)
}
