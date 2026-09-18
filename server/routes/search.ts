import { Router } from 'express'
import { db } from '../db.js'
import { skSuma, vzorHladania } from '../lib/format.js'

export const searchRouter = Router()

export type Vysledok = {
  typ: 'faktura' | 'zmluva' | 'firma' | 'turnus' | 'objednavka' | 'vydavok'
  id: number
  nadpis: string
  popis: string
  cesta: string
  datum: string | null
  suma: number | null
}

/**
 * Jedno hľadanie naprieč celou appkou. Každý zdroj má vlastný dotaz –
 * SQLite by síce zvládlo UNION, ale takto je vidieť, čo sa v ktorej
 * tabuľke prehľadáva, a dá sa to ľahko rozšíriť.
 */
export function hladaj(dopyt: string, limitNaTyp = 5): Vysledok[] {
  const q = vzorHladania(dopyt)
  const v: Vysledok[] = []

  const faktury = db
    .prepare(
      `SELECT i.id, i.cislo, i.suma, i.datum_vystav, i.stav, c.nazov AS firma
       FROM invoices i LEFT JOIN companies c ON c.id = i.company_id
       WHERE bez_diakritiky(i.cislo) LIKE @q OR bez_diakritiky(i.poznamka) LIKE @q OR bez_diakritiky(c.nazov) LIKE @q
       ORDER BY i.datum_vystav DESC LIMIT @limit`,
    )
    .all({ q, limit: limitNaTyp }) as any[]
  for (const f of faktury) {
    v.push({
      typ: 'faktura',
      id: f.id,
      nadpis: `Faktúra ${f.cislo}`,
      popis: f.firma || 'bez odberateľa',
      cesta: `/faktury/${f.id}`,
      datum: f.datum_vystav,
      suma: f.suma,
    })
  }

  const zmluvy = db
    .prepare(
      `SELECT z.id, z.nazov, z.cislo_zmluvy, z.kategoria, z.platnost_do, c.nazov AS firma
       FROM contracts z LEFT JOIN companies c ON c.id = z.company_id
       WHERE bez_diakritiky(z.nazov) LIKE @q OR bez_diakritiky(z.cislo_zmluvy) LIKE @q OR bez_diakritiky(z.poznamka) LIKE @q
          OR bez_diakritiky(z.kategoria) LIKE @q OR bez_diakritiky(c.nazov) LIKE @q
       ORDER BY z.stav = 'aktivna' DESC, z.nazov LIMIT @limit`,
    )
    .all({ q, limit: limitNaTyp }) as any[]
  for (const z of zmluvy) {
    v.push({
      typ: 'zmluva',
      id: z.id,
      nadpis: z.nazov,
      popis: [z.firma, z.kategoria].filter(Boolean).join(' · ') || 'zmluva',
      cesta: `/zmluvy/${z.id}`,
      datum: z.platnost_do,
      suma: null,
    })
  }

  const turnusy = db
    .prepare(
      `SELECT t.id, t.nazov, t.krajina, t.miesto, t.datum_od, t.datum_do, c.nazov AS firma
       FROM tours t LEFT JOIN companies c ON c.id = t.company_id
       WHERE bez_diakritiky(t.nazov) LIKE @q OR bez_diakritiky(t.krajina) LIKE @q OR bez_diakritiky(t.miesto) LIKE @q
          OR bez_diakritiky(t.poznamka) LIKE @q OR bez_diakritiky(c.nazov) LIKE @q
       ORDER BY t.datum_od DESC LIMIT @limit`,
    )
    .all({ q, limit: limitNaTyp }) as any[]
  for (const t of turnusy) {
    v.push({
      typ: 'turnus',
      id: t.id,
      nadpis: t.nazov,
      popis: [t.firma, [t.miesto, t.krajina].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
      cesta: `/turnusy/${t.id}`,
      datum: t.datum_od,
      suma: null,
    })
  }

  const firmy = db
    .prepare(
      `SELECT id, nazov, ico, psc_mesto, krajina FROM companies
       WHERE bez_diakritiky(nazov) LIKE @q OR bez_diakritiky(ico) LIKE @q OR bez_diakritiky(dic) LIKE @q OR bez_diakritiky(ic_dph) LIKE @q
          OR bez_diakritiky(email) LIKE @q OR bez_diakritiky(poznamka) LIKE @q
       ORDER BY archived, nazov LIMIT @limit`,
    )
    .all({ q, limit: limitNaTyp }) as any[]
  for (const f of firmy) {
    v.push({
      typ: 'firma',
      id: f.id,
      nadpis: f.nazov,
      popis: [f.psc_mesto, f.krajina].filter(Boolean).join(', ') || (f.ico ? `IČO ${f.ico}` : 'firma'),
      cesta: '/firmy',
      datum: null,
      suma: null,
    })
  }

  const objednavky = db
    .prepare(
      `SELECT o.id, o.cislo, o.popis, o.suma, o.hodinovka, o.datum, c.nazov AS firma
       FROM orders o LEFT JOIN companies c ON c.id = o.company_id
       WHERE bez_diakritiky(o.cislo) LIKE @q OR bez_diakritiky(o.popis) LIKE @q OR bez_diakritiky(o.poznamka) LIKE @q OR bez_diakritiky(c.nazov) LIKE @q
       ORDER BY COALESCE(o.datum, o.created_at) DESC LIMIT @limit`,
    )
    .all({ q, limit: limitNaTyp }) as any[]
  for (const o of objednavky) {
    v.push({
      typ: 'objednavka',
      id: o.id,
      nadpis: `Objednávka ${o.cislo || o.popis || ''}`.trim(),
      popis: [o.firma, o.hodinovka ? `${skSuma(o.hodinovka)}/h` : ''].filter(Boolean).join(' · '),
      cesta: `/objednavky/${o.id}`,
      datum: o.datum,
      suma: o.suma || null,
    })
  }

  const vydavky = db
    .prepare(
      `SELECT v.id, v.popis, v.kategoria, v.suma, v.datum, v.druh, t.nazov AS turnus
       FROM expenses v LEFT JOIN tours t ON t.id = v.tour_id
       WHERE bez_diakritiky(v.popis) LIKE @q OR bez_diakritiky(v.kategoria) LIKE @q OR bez_diakritiky(v.poznamka) LIKE @q
       ORDER BY v.datum DESC LIMIT @limit`,
    )
    .all({ q, limit: limitNaTyp }) as any[]
  for (const x of vydavky) {
    v.push({
      typ: 'vydavok',
      id: x.id,
      nadpis: x.popis,
      popis:
        [x.druh === 'prijem' ? 'súkromný príjem' : null, x.kategoria, x.turnus]
          .filter(Boolean)
          .join(' · ') || 'výdavok',
      cesta: '/vydavky',
      datum: x.datum,
      suma: x.suma,
    })
  }

  return v
}

searchRouter.get('/', (req, res) => {
  const dopyt = String(req.query.q ?? '').trim()
  if (dopyt.length < 2) return res.json([])
  res.json(hladaj(dopyt))
})
