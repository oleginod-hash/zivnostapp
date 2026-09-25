import { Router } from 'express'
import multer from 'multer'
import { db } from '../db.js'
import { zaokruhli } from '../lib/format.js'
import { OTVORENY_ZOSTATOK_SQL, pridajPlatbu } from '../lib/platby.js'
import { naOdlozenie } from '../lib/rezerva.js'
import { precitajVypis, type Mapovanie } from '../lib/vypis.js'

/**
 * Import výpisu z banky. Z výpisu (CSV) zoberieme prichádzajúce platby
 * a navrhneme, ku ktorej faktúre patria – podľa variabilného symbolu, a keď
 * chýba, podľa sumy. Používateľ návrhy potvrdí alebo zmení; zapíše sa až
 * potvrdené. Každý zapísaný pohyb si pamätáme, takže ten istý výpis nahratý
 * znova nič nezdvojí, a celý import sa dá vrátiť jedným krokom.
 */
export const bankaRouter = Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })

type Akcia = 'platba' | 'prijem' | 'preskocit'
type Dovod = 'vs' | 'suma' | 'uz_zapisane' | 'uz_uhradena' | 'ina_mena' | 'nenajdene'

type OtvorenaFaktura = { id: number; cislo: string; variabilny: string; firma_nazov: string | null; otvoreny_zostatok: number }

const bezNul = (vs: string) => String(vs ?? '').replace(/\D/g, '').replace(/^0+/, '')

function faktury(): OtvorenaFaktura[] {
  return db
    .prepare(
      `SELECT i.id, i.cislo, i.variabilny, c.nazov AS firma_nazov, ${OTVORENY_ZOSTATOK_SQL}
       FROM invoices i LEFT JOIN companies c ON c.id = i.company_id
       WHERE i.stav <> 'koncept'
       ORDER BY i.datum_splat, i.id`,
    )
    .all() as OtvorenaFaktura[]
}

bankaRouter.post('/nahlad', upload.single('subor'), (req, res) => {
  if (!req.file) return res.status(400).json({ chyba: 'Vyber súbor s výpisom.' })

  let rucne: Partial<Mapovanie> | undefined
  if (req.body?.mapovanie) {
    try {
      rucne = JSON.parse(String(req.body.mapovanie))
    } catch {
      return res.status(400).json({ chyba: 'Priradenie stĺpcov sa nedá prečítať.' })
    }
  }

  const vypis = precitajVypis(req.file.buffer, rucne)
  const najdene = vypis.mapovanie.datum !== undefined && (vypis.mapovanie.suma !== undefined || vypis.mapovanie.prijem !== undefined)
  if (!najdene) {
    return res.json({ hlavicka: vypis.hlavicka, mapovanie: vypis.mapovanie, stlpce_nenajdene: true, pohyby: [], odchadzajuce: 0, necitatelne: 0 })
  }

  const vsetky = faktury()
  // Čo z faktúry ešte zostáva – návrhy v tom istom výpise ju postupne „splácajú".
  const zostava = new Map(vsetky.map((f) => [f.id, zaokruhli(f.otvoreny_zostatok)]))
  const zapisane = new Set(
    (db.prepare('SELECT odtlacok FROM bankove_pohyby').all() as { odtlacok: string }[]).map((r) => r.odtlacok),
  )

  const prichadzajuce = vypis.pohyby.filter((p) => p.suma > 0)
  const pohyby = prichadzajuce.map((p) => {
    let akcia: Akcia = 'preskocit'
    let dovod: Dovod = 'nenajdene'
    let faktura: OtvorenaFaktura | undefined

    if (zapisane.has(p.odtlacok)) {
      dovod = 'uz_zapisane'
    } else if (p.mena && p.mena !== 'EUR') {
      dovod = 'ina_mena'
    } else {
      const podlaVs = p.vs ? vsetky.filter((f) => bezNul(f.variabilny) === p.vs) : []
      if (podlaVs.length) {
        faktura = podlaVs.find((f) => (zostava.get(f.id) ?? 0) > 0.005)
        if (faktura) {
          akcia = 'platba'
          dovod = 'vs'
        } else {
          faktura = podlaVs[0]
          dovod = 'uz_uhradena'
        }
      } else {
        const podlaSumy = vsetky.filter((f) => Math.abs((zostava.get(f.id) ?? 0) - p.suma) < 0.005)
        if (podlaSumy.length === 1) {
          faktura = podlaSumy[0]
          akcia = 'platba'
          dovod = 'suma'
        }
      }
    }
    if (akcia === 'platba' && faktura) zostava.set(faktura.id, zaokruhli((zostava.get(faktura.id) ?? 0) - p.suma))

    return {
      ...p,
      uz_zapisane: dovod === 'uz_zapisane',
      navrh: { akcia, dovod, faktura_id: faktura?.id ?? null, faktura_cislo: faktura?.cislo ?? null },
    }
  })

  res.json({
    hlavicka: vypis.hlavicka,
    mapovanie: vypis.mapovanie,
    stlpce_nenajdene: false,
    pohyby,
    odchadzajuce: vypis.pohyby.length - prichadzajuce.length,
    necitatelne: vypis.necitatelne,
    // Na ručný výber: faktúry, ktoré ešte nie sú celé uhradené.
    otvorene_faktury: vsetky.filter((f) => f.otvoreny_zostatok > 0.005),
  })
})

type NaZapis = {
  odtlacok: string; datum: string; suma: number; vs?: string; protistrana?: string; sprava?: string
  akcia: Akcia; faktura_id?: number | null
}

bankaRouter.post('/zapisat', (req, res) => {
  const vstup: NaZapis[] = Array.isArray(req.body?.pohyby) ? req.body.pohyby : []
  const naZapis = vstup.filter((p) => p.akcia === 'platba' || p.akcia === 'prijem')
  if (!naZapis.length) return res.status(400).json({ chyba: 'Nie je vybraná žiadna platba na zapísanie.' })

  const zapis = db.transaction(() => {
    const importId = Number(
      db.prepare('INSERT INTO bankove_importy (nazov_suboru) VALUES (?)').run(String(req.body?.nazov_suboru ?? '')).lastInsertRowid,
    )
    const uzJe = db.prepare('SELECT 1 FROM bankove_pohyby WHERE odtlacok = ?')
    const zapamataj = db.prepare(
      `INSERT INTO bankove_pohyby (odtlacok, import_id, datum, suma, vs, protistrana, sprava, akcia, platba_id, vydavok_id)
       VALUES (@odtlacok, @import_id, @datum, @suma, @vs, @protistrana, @sprava, @akcia, @platba_id, @vydavok_id)`,
    )
    const vysledok = { import_id: importId, platby: 0, prijmy: 0, preskocene: 0, suma_platieb: 0 }

    for (const p of naZapis) {
      const datum = String(p.datum ?? '').slice(0, 10)
      const suma = zaokruhli(Number(p.suma) || 0)
      if (!p.odtlacok || !/^\d{4}-\d{2}-\d{2}$/.test(datum) || suma <= 0 || uzJe.get(p.odtlacok)) {
        vysledok.preskocene++
        continue
      }
      const protistrana = String(p.protistrana ?? '').trim()
      const sprava = String(p.sprava ?? '').trim()
      let platba_id: number | null = null
      let vydavok_id: number | null = null

      if (p.akcia === 'platba') {
        const f = db.prepare("SELECT id FROM invoices WHERE id = ? AND stav <> 'koncept'").get(Number(p.faktura_id))
        if (!f) {
          vysledok.preskocene++
          continue
        }
        platba_id = pridajPlatbu(Number(p.faktura_id), datum, suma, protistrana ? `z výpisu: ${protistrana}` : 'z výpisu z banky')
        vysledok.platby++
        vysledok.suma_platieb = zaokruhli(vysledok.suma_platieb + suma)
      } else {
        vydavok_id = Number(
          db
            .prepare(
              `INSERT INTO expenses (datum, popis, kategoria, platba, poznamka, druh, suma, odpocitat)
               VALUES (?, ?, 'Iný súkromný príjem', 'prevod', ?, 'prijem', ?, 0)`,
            )
            .run(datum, protistrana || sprava || 'Príjem z výpisu', ['z výpisu z banky', sprava].filter(Boolean).join(' – '), suma)
            .lastInsertRowid,
        )
        vysledok.prijmy++
      }
      zapamataj.run({
        odtlacok: p.odtlacok, import_id: importId, datum, suma, vs: String(p.vs ?? ''), protistrana, sprava,
        akcia: p.akcia, platba_id, vydavok_id,
      })
    }
    // Keď sa nezapísalo nič (všetko už bolo zapísané), prázdny import nenecháme.
    if (!vysledok.platby && !vysledok.prijmy) {
      db.prepare('DELETE FROM bankove_importy WHERE id = ?').run(importId)
      return { ...vysledok, import_id: null }
    }
    return vysledok
  })

  const vysledok = zapis()
  res.json({ ...vysledok, odlozit: naOdlozenie(vysledok.suma_platieb) })
})

/** Vrátenie celého importu – zmažú sa platby aj súkromné príjmy, ktoré zapísal. */
bankaRouter.delete('/importy/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!db.prepare('SELECT 1 FROM bankove_importy WHERE id = ?').get(id)) {
    return res.status(404).json({ chyba: 'Import neexistuje.' })
  }
  const vrat = db.transaction(() => {
    const pohyby = db.prepare('SELECT platba_id, vydavok_id FROM bankove_pohyby WHERE import_id = ?').all(id) as {
      platba_id: number | null; vydavok_id: number | null
    }[]
    for (const p of pohyby) {
      if (p.platba_id) db.prepare('DELETE FROM invoice_payments WHERE id = ?').run(p.platba_id)
      if (p.vydavok_id) db.prepare('DELETE FROM expenses WHERE id = ?').run(p.vydavok_id)
    }
    db.prepare('DELETE FROM bankove_pohyby WHERE import_id = ?').run(id)
    db.prepare('DELETE FROM bankove_importy WHERE id = ?').run(id)
    return pohyby.length
  })
  res.json({ ok: true, vratene: vrat() })
})

/** Posledné importy – kedy a čo sa zapísalo. */
bankaRouter.get('/importy', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT m.id, m.nazov_suboru, m.created_at,
                COUNT(CASE WHEN p.akcia = 'platba' THEN 1 END) AS platby,
                COUNT(CASE WHEN p.akcia = 'prijem' THEN 1 END) AS prijmy,
                COALESCE(SUM(p.suma), 0) AS suma
         FROM bankove_importy m LEFT JOIN bankove_pohyby p ON p.import_id = m.id
         GROUP BY m.id ORDER BY m.id DESC LIMIT 10`,
      )
      .all(),
  )
})
