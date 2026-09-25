import { Router } from 'express'
import { db } from '../db.js'
import { dnesISO } from '../lib/format.js'
import { rezervaZaRok } from '../lib/rezerva.js'
import { UHRADENE_SQL, VYFAKTUROVANE_SQL } from '../lib/platby.js'

export const financeRouter = Router()

/**
 * Príjem = skutočne prijaté peniaze ku dňu, keď prišli na účet. Berieme ich
 * z jednotlivých platieb, takže sedia aj čiastočné úhrady a splátky dlhu.
 * Faktúra vystavená v marci a zaplatená v máji patrí do mája.
 */

function obdobie(req: any): { od: string; do: string } {
  const rok = String(req.query.rok ?? '')
  if (rok) return { od: `${rok}-01-01`, do: `${rok}-12-31` }
  return {
    od: String(req.query.od ?? '') || '0000-01-01',
    do: String(req.query.do ?? '') || '9999-12-31',
  }
}

// ── Hlavné čísla za obdobie ───────────────────────────────────
financeRouter.get('/prehlad', (req, res) => {
  const o = obdobie(req)

  const prijmy = db
    .prepare(
      `SELECT COALESCE(SUM(p.suma), 0) AS suma, COUNT(DISTINCT p.invoice_id) AS pocet
       FROM invoice_payments p WHERE p.datum BETWEEN @od AND @do`,
    )
    .get(o) as { suma: number; pocet: number }

  // Súkromné príjmy sú v tej istej tabuľke, ale s podnikaním nemajú nič
  // spoločné – držíme ich mimo výdavkov aj mimo zisku.
  const vydavky = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN druh = 'vydavok' THEN suma END), 0) AS suma,
              COALESCE(SUM(CASE WHEN druh = 'vydavok' AND odpocitat = 1 THEN suma END), 0) AS odpocitatelne,
              COALESCE(SUM(CASE WHEN druh = 'vydavok' THEN 1 END), 0) AS pocet,
              COALESCE(SUM(CASE WHEN druh = 'prijem' THEN suma END), 0) AS sukromne_prijmy
       FROM expenses WHERE datum BETWEEN @od AND @do`,
    )
    .get(o) as { suma: number; odpocitatelne: number; pocet: number; sukromne_prijmy: number }

  // Otvorené zostatky. Krycie zálohy sa nerátajú zvlášť – ich dlh je už
  // zahrnutý v pôvodnej faktúre, inak by suma vyšla dvakrát.
  const caka = db
    .prepare(
      `SELECT COALESCE(SUM(z.otvoreny), 0) AS suma FROM (
         SELECT ROUND(
           i.suma
           - (SELECT COALESCE(SUM(p.suma), 0) FROM invoice_payments p WHERE p.invoice_id = i.id)
           - (SELECT COALESCE(SUM(p2.suma), 0) FROM invoice_payments p2
              JOIN invoices z2 ON z2.id = p2.invoice_id WHERE z2.kryje_id = i.id), 2) AS otvoreny
         FROM invoices i
         -- Zámerne bez filtra obdobia: je to aktuálny dlh voči tebe, nie
         -- niečo, čo patrí do vybraného roka. Faktúra z minulého roka,
         -- ktorú ti stále nezaplatili, je stále nezaplatená.
         WHERE i.stav <> 'koncept' AND i.kryje_id IS NULL
       ) z WHERE z.otvoreny > 0.005`,
    )
    .get(o) as { suma: number }

  res.json({
    od: o.od,
    do: o.do,
    prijmy: prijmy.suma,
    pocet_faktur: prijmy.pocet,
    vydavky: vydavky.suma,
    vydavky_odpocitatelne: vydavky.odpocitatelne,
    pocet_vydavkov: vydavky.pocet,
    sukromne_prijmy: vydavky.sukromne_prijmy,
    zisk: Math.round((prijmy.suma - vydavky.suma) * 100) / 100,
    caka_na_zaplatenie: caka.suma,
  })
})

// ── Rezerva na dane a odvody ──────────────────────────────────
financeRouter.get('/rezerva', (req, res) => {
  const rok = /^\d{4}$/.test(String(req.query.rok ?? '')) ? String(req.query.rok) : dnesISO().slice(0, 4)
  res.json(rezervaZaRok(rok))
})

// ── Mesačný priebeh pre graf ──────────────────────────────────
financeRouter.get('/mesacne', (req, res) => {
  const rok = String(req.query.rok ?? dnesISO().slice(0, 4))

  const prijmy = db
    .prepare(
      `SELECT strftime('%m', datum) AS m, COALESCE(SUM(suma), 0) AS suma
       FROM invoice_payments WHERE strftime('%Y', datum) = ? GROUP BY m`,
    )
    .all(rok) as { m: string; suma: number }[]

  const vydavky = db
    .prepare(
      `SELECT strftime('%m', datum) AS m, COALESCE(SUM(suma), 0) AS suma
       FROM expenses WHERE druh = 'vydavok' AND strftime('%Y', datum) = ? GROUP BY m`,
    )
    .all(rok) as { m: string; suma: number }[]

  const NAZVY = ['Jan', 'Feb', 'Mar', 'Apr', 'Máj', 'Jún', 'Júl', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']
  const mesiace = NAZVY.map((nazov, i) => {
    const kluc = String(i + 1).padStart(2, '0')
    const p = prijmy.find((x) => x.m === kluc)?.suma ?? 0
    const v = vydavky.find((x) => x.m === kluc)?.suma ?? 0
    return { mesiac: nazov, prijmy: p, vydavky: v, zisk: Math.round((p - v) * 100) / 100 }
  })

  res.json(mesiace)
})

// ── Rozpad výdavkov podľa kategórií ───────────────────────────
financeRouter.get('/kategorie', (req, res) => {
  const o = obdobie(req)
  res.json(
    db
      .prepare(
        `SELECT CASE WHEN kategoria = '' THEN 'Nezaradené' ELSE kategoria END AS kategoria,
                COALESCE(SUM(suma), 0) AS suma, COUNT(*) AS pocet
         FROM expenses WHERE druh = 'vydavok' AND datum BETWEEN @od AND @do
         GROUP BY kategoria ORDER BY suma DESC`,
      )
      .all(o),
  )
})

// ── Zisk podľa turnusov ───────────────────────────────────────
financeRouter.get('/turnusy', (req, res) => {
  const rok = String(req.query.rok ?? '')
  const where = rok ? "WHERE strftime('%Y', t.datum_od) = @rok" : ''

  const riadky = db
    .prepare(
      `SELECT t.id, t.nazov, t.datum_od, t.datum_do, c.nazov AS firma_nazov,
              -- Rovnaký výpočet ako pri turnusoch: bez konceptov a bez krycích záloh,
              -- inak by sa zálohy kryjúce starý dlh rátali do tržby dvakrát.
              (SELECT COALESCE(SUM(i.suma), 0) FROM invoices i WHERE i.tour_id = t.id AND ${VYFAKTUROVANE_SQL}) AS vyfakturovane,
              (SELECT COALESCE(SUM(MIN(i.suma, ${UHRADENE_SQL})), 0) FROM invoices i
                WHERE i.tour_id = t.id AND ${VYFAKTUROVANE_SQL}) AS zaplatene,
              (SELECT COALESCE(SUM(v.suma), 0) FROM expenses v
                WHERE v.tour_id = t.id AND v.druh = 'vydavok') AS vydavky
       FROM tours t LEFT JOIN companies c ON c.id = t.company_id
       ${where}
       ORDER BY t.datum_od DESC`,
    )
    .all(rok ? { rok } : {}) as any[]

  res.json(
    riadky.map((t) => ({
      ...t,
      zisk: Math.round((t.vyfakturovane - t.vydavky) * 100) / 100,
    })),
  )
})

/** Roky, za ktoré vôbec existujú nejaké dáta – pre prepínač obdobia. */
financeRouter.get('/roky', (_req, res) => {
  const r = db
    .prepare(
      `SELECT DISTINCT rok FROM (
         SELECT strftime('%Y', datum) AS rok FROM invoice_payments
         UNION
         SELECT strftime('%Y', datum_vystav) AS rok FROM invoices
         UNION
         SELECT strftime('%Y', datum) AS rok FROM expenses
       ) WHERE rok IS NOT NULL ORDER BY rok DESC`,
    )
    .all() as { rok: string }[]
  const roky = r.map((x) => x.rok)
  const tentoRok = dnesISO().slice(0, 4)
  if (!roky.includes(tentoRok)) roky.unshift(tentoRok)
  res.json(roky)
})
