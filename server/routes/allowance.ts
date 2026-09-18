import { Router } from 'express'
import { db } from '../db.js'
import { zaokruhli } from '../lib/format.js'

export const allowanceRouter = Router()

/**
 * Stravné (diéty) zo zahraničných turnusov a sledovanie dní v krajine.
 *
 * Sadzby si používateľ zadáva sám a sám ich aj aktualizuje – appka žiadne
 * čísla nepredpisuje, lebo sa menia a nie sme daňový poradca. Rovnako
 * nevyhodnocujeme daňovú rezidenciu; len ukazujeme počty dní.
 */

/** Orientačný limit, po ktorom sa v mnohých krajinách rieši daňová rezidencia. */
const HRANICA_DNI = 183

// ── Sadzby ────────────────────────────────────────────────────
allowanceRouter.get('/sadzby', (_req, res) => {
  res.json(db.prepare('SELECT * FROM stravne_sadzby ORDER BY krajina COLLATE NOCASE').all())
})

allowanceRouter.put('/sadzby', (req, res) => {
  const sadzby = Array.isArray(req.body?.sadzby) ? req.body.sadzby : []

  const uloz = db.transaction(() => {
    db.prepare('DELETE FROM stravne_sadzby').run()
    const vloz = db.prepare(
      'INSERT INTO stravne_sadzby (krajina, sadzba, mena, poznamka) VALUES (@krajina, @sadzba, @mena, @poznamka)',
    )
    for (const s of sadzby) {
      const krajina = String(s?.krajina ?? '').trim()
      if (!krajina) continue
      vloz.run({
        krajina,
        sadzba: zaokruhli(Number(s?.sadzba) || 0),
        mena: String(s?.mena ?? 'EUR').trim() || 'EUR',
        poznamka: String(s?.poznamka ?? '').trim(),
      })
    }
  })
  uloz()
  res.json(db.prepare('SELECT * FROM stravne_sadzby ORDER BY krajina COLLATE NOCASE').all())
})

// ── Výpočet stravného pre turnus ──────────────────────────────
allowanceRouter.get('/turnus/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tours WHERE id = ?').get(req.params.id) as any
  if (!t) return res.status(404).json({ chyba: 'Turnus neexistuje.' })

  const dni = Math.round(
    (new Date(t.datum_do + 'T12:00:00').getTime() - new Date(t.datum_od + 'T12:00:00').getTime()) / 86400000,
  ) + 1

  const sadzba = t.krajina
    ? (db.prepare('SELECT * FROM stravne_sadzby WHERE krajina = ? COLLATE NOCASE').get(t.krajina) as any)
    : null

  // Či už zo stravného za tento turnus vznikol výdavok – nech sa nezaeviduje dvakrát.
  // Rátame len výdavky, ktoré vznikli touto funkciou; bloček za jedlo v kategórii
  // „Stravné" nie sú diéty.
  const uzZapisane = db
    .prepare("SELECT id, suma FROM expenses WHERE tour_id = ? AND zdroj = 'stravne'")
    .all(req.params.id) as any[]

  res.json({
    turnus: { id: t.id, nazov: t.nazov, krajina: t.krajina, datum_od: t.datum_od, datum_do: t.datum_do },
    dni,
    sadzba: sadzba?.sadzba ?? null,
    mena: sadzba?.mena ?? 'EUR',
    ma_sadzbu: !!sadzba,
    suma: sadzba ? zaokruhli(dni * sadzba.sadzba) : null,
    uz_zapisane: uzZapisane,
  })
})

/** Zapíše stravné za turnus ako výdavok. */
allowanceRouter.post('/turnus/:id/zapisat', (req, res) => {
  const t = db.prepare('SELECT * FROM tours WHERE id = ?').get(req.params.id) as any
  if (!t) return res.status(404).json({ chyba: 'Turnus neexistuje.' })

  const suma = zaokruhli(Number(req.body?.suma) || 0)
  if (suma <= 0) return res.status(400).json({ chyba: 'Suma stravného musí byť väčšia než nula.' })

  const popis = String(req.body?.popis ?? '').trim() || `Stravné – ${t.nazov}`
  const info = db
    .prepare(
      `INSERT INTO expenses (datum, popis, kategoria, suma, tour_id, platba, odpocitat, poznamka, zdroj)
       VALUES (?, ?, 'Stravné', ?, ?, 'ine', 1, ?, 'stravne')`,
    )
    .run(t.datum_do, popis, suma, t.id, String(req.body?.poznamka ?? '').trim())

  res.json({ id: Number(info.lastInsertRowid) })
})

// ── Dni strávené v krajinách ──────────────────────────────────
allowanceRouter.get('/dni', (req, res) => {
  const rok = String(req.query.rok ?? new Date().getFullYear())

  // Turnus môže presahovať cez koniec roka – dni orežeme na hranice roka.
  const turnusy = db
    .prepare(
      `SELECT id, nazov, krajina, datum_od, datum_do FROM tours
       WHERE zruseny = 0 AND datum_do >= @od AND datum_od <= @do
       ORDER BY datum_od`,
    )
    .all({ od: `${rok}-01-01`, do: `${rok}-12-31` }) as any[]

  const podlaKrajin = new Map<string, { dni: number; turnusy: string[] }>()

  for (const t of turnusy) {
    const od = t.datum_od < `${rok}-01-01` ? `${rok}-01-01` : t.datum_od
    const doo = t.datum_do > `${rok}-12-31` ? `${rok}-12-31` : t.datum_do
    const dni =
      Math.round(
        (new Date(doo + 'T12:00:00').getTime() - new Date(od + 'T12:00:00').getTime()) / 86400000,
      ) + 1
    if (dni <= 0) continue

    const krajina = (t.krajina || '').trim() || 'neuvedená krajina'
    const zaznam = podlaKrajin.get(krajina) ?? { dni: 0, turnusy: [] }
    zaznam.dni += dni
    zaznam.turnusy.push(t.nazov)
    podlaKrajin.set(krajina, zaznam)
  }

  const krajiny = [...podlaKrajin.entries()]
    .map(([krajina, x]) => ({
      krajina,
      dni: x.dni,
      pocet_turnusov: x.turnusy.length,
      zostava_do_hranice: Math.max(0, HRANICA_DNI - x.dni),
      blizi_sa_hranica: x.dni >= HRANICA_DNI - 30 && x.dni < HRANICA_DNI,
      prekrocena_hranica: x.dni >= HRANICA_DNI,
    }))
    .sort((a, b) => b.dni - a.dni)

  res.json({
    rok,
    hranica: HRANICA_DNI,
    krajiny,
    dni_v_zahranici: krajiny.reduce((s, k) => s + k.dni, 0),
  })
})
