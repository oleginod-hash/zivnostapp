import { Router } from 'express'
import { db } from '../db.js'
import { OTVORENY_ZOSTATOK_SQL, STAV_SQL } from '../lib/platby.js'
import { podkladXlsx } from '../lib/podkladXlsx.js'
import { dnesISO } from '../lib/format.js'

export const taxReportRouter = Router()

/**
 * Podklad pre daňové priznanie – všetko, čo od teba účtovníčka pýta,
 * na jednom mieste. Nič nevypočítava za daňového poradcu, len sumarizuje
 * to, čo je v evidencii.
 *
 * Kľúčové pravidlo: príjem patrí do roka, v ktorom peniaze reálne prišli
 * na účet, nie do roka vystavenia faktúry. Preto sa všade rátajú platby.
 */
export function zozbierajPodklad(rok: string) {
  const p = { od: `${rok}-01-01`, do: `${rok}-12-31`, rok }

  const prijmy = db
    .prepare(
      `SELECT COALESCE(SUM(suma), 0) AS suma, COUNT(*) AS pocet_platieb,
              COUNT(DISTINCT invoice_id) AS pocet
       FROM invoice_payments WHERE datum BETWEEN @od AND @do`,
    )
    .get(p) as any

  const nezaplatene = db
    .prepare(
      `SELECT COALESCE(SUM(z.otvoreny), 0) AS suma, COUNT(*) AS pocet FROM (
         SELECT ${OTVORENY_ZOSTATOK_SQL.replace('AS otvoreny_zostatok', 'AS otvoreny')}
         FROM invoices i
         WHERE i.stav <> 'koncept' AND i.kryje_id IS NULL AND i.datum_vystav <= @do
       ) z WHERE z.otvoreny > 0.005`,
    )
    .get(p) as any

  // Súkromné príjmy sú v tabuľke výdavkov, ale do dane nevstupujú –
  // držíme ich oddelene, aby si ich účtovníčka nezmýlila s tržbou.
  const vydavky = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN druh = 'vydavok' AND odpocitat = 1 THEN suma END), 0) AS uznatelne,
              COALESCE(SUM(CASE WHEN druh = 'vydavok' AND odpocitat = 0 THEN suma END), 0) AS neuznatelne,
              COALESCE(SUM(CASE WHEN druh = 'vydavok' THEN 1 END), 0) AS pocet,
              COALESCE(SUM(CASE WHEN druh = 'prijem' THEN suma END), 0) AS sukromne_prijmy,
              COALESCE(SUM(CASE WHEN druh = 'prijem' THEN 1 END), 0) AS sukromne_pocet
       FROM expenses WHERE datum BETWEEN @od AND @do`,
    )
    .get(p) as any

  const vydavkyPodlaKategorii = db
    .prepare(
      `SELECT CASE WHEN kategoria = '' THEN 'Nezaradené' ELSE kategoria END AS kategoria,
              COALESCE(SUM(suma), 0) AS suma,
              COALESCE(SUM(CASE WHEN odpocitat = 1 THEN suma END), 0) AS uznatelne,
              COUNT(*) AS pocet
       FROM expenses WHERE druh = 'vydavok' AND datum BETWEEN @od AND @do
       GROUP BY kategoria ORDER BY suma DESC`,
    )
    .all(p) as any[]

  // Rozpis výdavkov po jednom doklade – účtovníčka si vie skontrolovať,
  // z čoho sa súčty skladajú, aj či ku každému existuje bloček.
  const vydavkyRozpis = db
    .prepare(
      `SELECT v.datum, v.popis,
              CASE WHEN v.kategoria = '' THEN 'Nezaradené' ELSE v.kategoria END AS kategoria,
              v.suma, v.odpocitat, v.platba, v.poznamka, t.nazov AS turnus,
              (SELECT COUNT(*) FROM expense_files f WHERE f.expense_id = v.id) AS pocet_dokladov
       FROM expenses v LEFT JOIN tours t ON t.id = v.tour_id
       WHERE v.druh = 'vydavok' AND v.datum BETWEEN @od AND @do
       ORDER BY v.datum, v.id`,
    )
    .all(p) as any[]

  const sukromnePrijmy = db
    .prepare(
      `SELECT datum, popis, kategoria, suma, platba, poznamka
       FROM expenses WHERE druh = 'prijem' AND datum BETWEEN @od AND @do
       ORDER BY datum, id`,
    )
    .all(p) as any[]

  // Do prehľadu patria faktúry vystavené v tomto roku aj tie staršie,
  // na ktoré v tomto roku prišli peniaze.
  const faktury = db
    .prepare(
      `SELECT i.cislo, i.typ, i.datum_vystav, i.datum_splat, i.suma,
              k.cislo AS kryje_cislo, c.nazov AS firma, ${STAV_SQL}, ${OTVORENY_ZOSTATOK_SQL},
              (SELECT COALESCE(SUM(pl.suma), 0) FROM invoice_payments pl
                WHERE pl.invoice_id = i.id AND pl.datum BETWEEN @od AND @do) AS prijate_v_roku,
              (SELECT MAX(pl.datum) FROM invoice_payments pl
                WHERE pl.invoice_id = i.id AND pl.datum BETWEEN @od AND @do) AS datum_uhrady,
              (SELECT COALESCE(SUM(p2.suma), 0) FROM invoice_payments p2
                JOIN invoices z ON z.id = p2.invoice_id WHERE z.kryje_id = i.id) AS uhradene_zalohami,
              (SELECT GROUP_CONCAT(z.cislo, ', ') FROM invoices z WHERE z.kryje_id = i.id) AS kryju_zalohy
       FROM invoices i
       LEFT JOIN companies c ON c.id = i.company_id
       LEFT JOIN invoices k ON k.id = i.kryje_id
       WHERE i.stav <> 'koncept' AND (
         i.datum_vystav BETWEEN @od AND @do
         OR EXISTS (SELECT 1 FROM invoice_payments pl
                    WHERE pl.invoice_id = i.id AND pl.datum BETWEEN @od AND @do)
       )
       ORDER BY i.datum_vystav, i.id`,
    )
    .all(p) as any[]

  // Jednotlivé platby – práve tento zoznam dá dokopy sumu príjmov.
  const platby = db
    .prepare(
      `SELECT pl.datum, pl.suma, pl.poznamka, i.cislo, i.typ,
              c.nazov AS firma, k.cislo AS kryje_cislo
       FROM invoice_payments pl
       JOIN invoices i ON i.id = pl.invoice_id
       LEFT JOIN companies c ON c.id = i.company_id
       LEFT JOIN invoices k ON k.id = i.kryje_id
       WHERE pl.datum BETWEEN @od AND @do
       ORDER BY pl.datum, pl.id`,
    )
    .all(p) as any[]

  const turnusy = db
    .prepare(
      `SELECT t.nazov, t.krajina, t.miesto, t.datum_od, t.datum_do, c.nazov AS firma,
              CAST(julianday(MIN(t.datum_do, @do)) - julianday(MAX(t.datum_od, @od)) + 1 AS INTEGER) AS dni
       FROM tours t LEFT JOIN companies c ON c.id = t.company_id
       WHERE t.zruseny = 0 AND t.datum_do >= @od AND t.datum_od <= @do
       ORDER BY t.datum_od`,
    )
    .all(p) as any[]

  const dniPodlaKrajin = new Map<string, number>()
  for (const t of turnusy) {
    const k = (t.krajina || '').trim() || 'neuvedená krajina'
    dniPodlaKrajin.set(k, (dniPodlaKrajin.get(k) ?? 0) + (t.dni || 0))
  }

  const nastavenia = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any

  return {
    rok,
    zostavene: dnesISO(),
    zivnostnik: {
      meno: nastavenia?.meno ?? '',
      ico: nastavenia?.ico ?? '',
      dic: nastavenia?.dic ?? '',
      adresa: [nastavenia?.adresa, nastavenia?.psc_mesto].filter(Boolean).join(', '),
      iban: nastavenia?.iban ?? '',
    },
    prijmy: { suma: prijmy.suma, pocet: prijmy.pocet, pocet_platieb: prijmy.pocet_platieb },
    nezaplatene: { suma: nezaplatene.suma, pocet: nezaplatene.pocet },
    vydavky: {
      uznatelne: vydavky.uznatelne,
      neuznatelne: vydavky.neuznatelne,
      pocet: vydavky.pocet,
      podlaKategorii: vydavkyPodlaKategorii,
      rozpis: vydavkyRozpis,
    },
    sukromne_prijmy: {
      suma: vydavky.sukromne_prijmy,
      pocet: vydavky.sukromne_pocet,
      polozky: sukromnePrijmy,
    },
    zaklad_dane: Math.round((prijmy.suma - vydavky.uznatelne) * 100) / 100,
    faktury,
    platby,
    // Súčet prijatých platieb podľa mesiaca – kontrolný rozpis pre účtovníčku.
    platby_po_mesiacoch: db
      .prepare(
        `SELECT strftime('%m', datum) AS mesiac, COALESCE(SUM(suma), 0) AS suma, COUNT(*) AS pocet
         FROM invoice_payments WHERE datum BETWEEN @od AND @do GROUP BY mesiac ORDER BY mesiac`,
      )
      .all(p) as { mesiac: string; suma: number; pocet: number }[],
    turnusy,
    dni_v_krajinach: [...dniPodlaKrajin.entries()]
      .map(([krajina, dni]) => ({ krajina, dni }))
      .sort((a, b) => b.dni - a.dni),
  }
}

export type Podklad = ReturnType<typeof zozbierajPodklad>

taxReportRouter.get('/', (req, res) => {
  res.json(zozbierajPodklad(String(req.query.rok ?? dnesISO().slice(0, 4))))
})

/** Hotový zošit pre účtovníčku – jeden hárok na každú oblasť. */
taxReportRouter.get('/xlsx', (req, res) => {
  const rok = String(req.query.rok ?? dnesISO().slice(0, 4))
  try {
    const zosit = podkladXlsx(zozbierajPodklad(rok))
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="Danovy-podklad-${rok}.xlsx"`)
    res.send(zosit)
  } catch (e: any) {
    console.error('[podklad]', e)
    res.status(500).json({ chyba: 'Zošit sa nepodarilo vytvoriť: ' + e.message })
  }
})
