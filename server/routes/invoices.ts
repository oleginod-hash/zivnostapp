import { Router } from 'express'
import { db } from '../db.js'
import { doKosa } from '../lib/kos.js'
import { dalsieCislo } from '../lib/cislovanie.js'
import { dnesISO, hladajVStlpcoch, pridajDni, vzorHladania, zaokruhli } from '../lib/format.js'
import { fakturaPdfPodlaId, vytvorFakturuPdf } from '../lib/invoicePdf.js'
import { pridajPracovneDni } from '../lib/pracovneDni.js'
import { naOdlozenie } from '../lib/rezerva.js'
import {
  OTVORENY_ZOSTATOK_SQL, PLATBY_SQL, STAV_SQL, UHRADENE_SQL,
  kryciePlatby, nastavPlatby, otvorenyZostatok, platbyFaktury, pridajPlatbu,
} from '../lib/platby.js'

export const invoicesRouter = Router()

const STAVY = ['koncept', 'vystavena', 'zaplatena'] as const
const TYPY = ['faktura', 'zaloha'] as const
type Stav = (typeof STAVY)[number]

/** Čo sa dá k faktúre pripojiť naraz – platby, stav aj otvorený zostatok. */
const ROZSIRENE_SQL = `${PLATBY_SQL}, ${STAV_SQL}, ${OTVORENY_ZOSTATOK_SQL}`

function nastavenia() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, any>
}

/** Predvolená splatnosť z nastavení – v kalendárnych alebo v pracovných dňoch. */
function predvolenaSplatnost(n: Record<string, any>, datum: string): string {
  return n.splatnost_pracovne ? pridajPracovneDni(datum, n.splatnost_dni) : pridajDni(datum, n.splatnost_dni)
}

/**
 * Väzby faktúry. Ak je vybraná objednávka, turnus aj firmu doplníme z nej –
 * inak by sa dali uložiť dva navzájom si odporujúce údaje.
 */
function vazby(b: any): { tour_id: number | null; order_id: number | null; company_id: number | null } {
  let tour_id = b.tour_id ? Number(b.tour_id) : null
  let company_id = b.company_id ? Number(b.company_id) : null
  const order_id = b.order_id ? Number(b.order_id) : null

  if (order_id) {
    const o = db.prepare('SELECT tour_id, company_id FROM orders WHERE id = ?').get(order_id) as
      | { tour_id: number | null; company_id: number | null }
      | undefined
    if (o) {
      if (o.tour_id) tour_id = o.tour_id
      if (o.company_id && !company_id) company_id = o.company_id
    }
  }
  if (tour_id && !company_id) {
    const t = db.prepare('SELECT company_id FROM tours WHERE id = ?').get(tour_id) as { company_id: number | null } | undefined
    if (t?.company_id) company_id = t.company_id
  }
  return { tour_id, order_id, company_id }
}

type PolozkaVstup = { popis?: string; mnozstvo?: unknown; jednotka?: string; cena?: unknown }

function spracujPolozky(vstup: unknown): { popis: string; mnozstvo: number; jednotka: string; cena: number }[] {
  if (!Array.isArray(vstup)) return []
  return vstup
    .map((p: PolozkaVstup) => ({
      popis: String(p.popis ?? '').trim(),
      mnozstvo: Number(p.mnozstvo) || 0,
      jednotka: String(p.jednotka ?? '').trim() || 'ks',
      cena: Number(p.cena) || 0,
    }))
    .filter((p) => p.popis !== '' || p.cena !== 0)
}

function sucet(polozky: { mnozstvo: number; cena: number }[]): number {
  return zaokruhli(polozky.reduce((s, p) => s + zaokruhli(p.mnozstvo * p.cena), 0))
}

function ulozPolozky(invoiceId: number | bigint, polozky: ReturnType<typeof spracujPolozky>) {
  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId)
  const stmt = db.prepare(
    'INSERT INTO invoice_items (invoice_id, poradie, popis, mnozstvo, jednotka, cena) VALUES (?, ?, ?, ?, ?, ?)',
  )
  polozky.forEach((p, i) => stmt.run(invoiceId, i, p.popis, p.mnozstvo, p.jednotka, p.cena))
}

/**
 * Záložky nad zoznamom faktúr. Nevyplatené a vyplatené sa delia podľa toho,
 * koľko z faktúry reálne prišlo – vrátane peňazí, ktoré prišli cez zálohové
 * faktúry kryjúce ten istý dlh. Krycie zálohy samotné patria do záložky
 * „zálohové", aby ten istý dlh nefiguroval v zozname dvakrát.
 */
const ZALOZKY: Record<string, { kde: string; radenie: string }> = {
  nevyplatene: {
    kde: `i.stav <> 'koncept' AND ${UHRADENE_SQL} < i.suma - 0.005 AND i.kryje_id IS NULL`,
    // Najsúrnejšie navrch – čo je najdlhšie po splatnosti.
    radenie: 'i.datum_splat, i.id',
  },
  vyplatene: {
    kde: `i.stav <> 'koncept' AND ${UHRADENE_SQL} >= i.suma - 0.005 AND i.kryje_id IS NULL`,
    radenie: 'i.datum_vystav DESC, i.id DESC',
  },
  zalohy: {
    kde: `i.typ = 'zaloha'`,
    radenie: 'i.datum_vystav DESC, i.id DESC',
  },
}

const STARE_STAVY: Record<string, string> = { zaplatena: 'vyplatene', vystavena: 'nevyplatene' }

/** Podmienky zo query parametrov – zdieľané zoznamom aj počítadlami záložiek. */
function filtre(query: any, soZalozkou = true) {
  const podmienky: string[] = []
  const params: Record<string, unknown> = {}

  // Staršie názvy stavov (používa ich aj AI pomocník) sa mapujú na záložky.
  const stav = STARE_STAVY[String(query.stav ?? '')] ?? String(query.stav ?? '')
  if (soZalozkou) {
    if (ZALOZKY[stav]) {
      podmienky.push(`(${ZALOZKY[stav].kde})`)
    } else if (stav === 'po_splatnosti') {
      podmienky.push(`i.stav <> 'koncept' AND ${UHRADENE_SQL} < i.suma - 0.005 AND i.datum_splat < dnes()`)
    } else if (stav === 'ciastocne') {
      podmienky.push(`i.stav <> 'koncept' AND ${UHRADENE_SQL} > 0 AND ${UHRADENE_SQL} < i.suma - 0.005`)
    } else if (stav === 'koncept') {
      podmienky.push("i.stav = 'koncept'")
    }
  }

  const typ = String(query.typ ?? '')
  if (typ === 'zaloha' || typ === 'faktura') {
    podmienky.push('i.typ = @typ')
    params.typ = typ
  }
  // Zálohové faktúry, ktoré kryjú starý dlh, verzus tie samostatné.
  if (query.kryjuce === '1') podmienky.push('i.kryje_id IS NOT NULL')
  if (query.kryjuce === '0') podmienky.push('i.kryje_id IS NULL')

  if (query.firma) {
    podmienky.push('i.company_id = @firma')
    params.firma = Number(query.firma)
  }
  if (query.turnus) {
    podmienky.push('i.tour_id = @turnus')
    params.turnus = Number(query.turnus)
  }
  if (query.rok) {
    podmienky.push("strftime('%Y', i.datum_vystav) = @rok")
    params.rok = String(query.rok)
  }
  const hladat = String(query.hladat ?? '').trim()
  if (hladat) {
    podmienky.push(hladajVStlpcoch(['i.cislo', 'c.nazov', 'i.poznamka', 't.nazov']))
    params.q = vzorHladania(hladat)
  }

  return { where: podmienky.length ? 'WHERE ' + podmienky.join(' AND ') : '', params }
}

const SPOJE_SQL = `FROM invoices i
       LEFT JOIN companies c ON c.id = i.company_id
       LEFT JOIN tours t ON t.id = i.tour_id
       LEFT JOIN invoices k ON k.id = i.kryje_id`

// ── Zoznam ─────────────────────────────────────────────
invoicesRouter.get('/', (req, res) => {
  const { where, params } = filtre(req.query)
  const radenie = ZALOZKY[String(req.query.stav ?? '')]?.radenie ?? 'i.datum_vystav DESC, i.id DESC'

  res.json(
    db
      .prepare(
        `SELECT i.*, c.nazov AS firma_nazov, t.nazov AS turnus_nazov,
                k.cislo AS kryje_cislo, k.suma AS kryje_suma, ${ROZSIRENE_SQL}
         ${SPOJE_SQL}
         ${where}
         ORDER BY ${radenie}`,
      )
      .all(params),
  )
})

// ── Počty pre záložky ──────────────────────────────────
// Počítadlá rešpektujú ostatné filtre (firma, rok, hľadanie), len nie záložku
// samotnú – inak by pri každom prepnutí ukazovali to isté číslo.
invoicesRouter.get('/pocty', (req, res) => {
  const { where, params } = filtre(req.query, false)
  const spocitaj = (kde = '1 = 1') =>
    (db
      .prepare(`SELECT COUNT(*) AS n ${SPOJE_SQL} ${where}${where ? ' AND ' : 'WHERE '}(${kde})`)
      .get(params) as { n: number }).n

  res.json({
    vsetky: spocitaj(),
    nevyplatene: spocitaj(ZALOZKY.nevyplatene.kde),
    vyplatene: spocitaj(ZALOZKY.vyplatene.kde),
    zalohy: spocitaj(ZALOZKY.zalohy.kde),
  })
})

// ── Súhrn pre prehľad ─────────────────────────────────────────
invoicesRouter.get('/suhrn', (_req, res) => {
  // Prijaté peniaze berieme z platieb podľa ich dátumu – to je aj daňovo správne.
  const prijate = db
    .prepare(
      `SELECT COALESCE(SUM(suma), 0) AS spolu,
              COALESCE(SUM(CASE WHEN strftime('%Y', datum) = strftime('%Y', dnes()) THEN suma END), 0) AS tento_rok
       FROM invoice_payments`,
    )
    .get() as any

  // Čo ešte čakám: otvorené zostatky. Pri faktúre krytej zálohami sa odráta
  // aj to, čo prišlo na tie zálohy, a samotné krycie zálohy sa nerátajú znova –
  // inak by ten istý dlh figuroval v čakajúcej sume dvakrát.
  const otvorene = db
    .prepare(
      `SELECT
         COALESCE(SUM(z.otvoreny), 0) AS nezaplatene,
         COALESCE(SUM(CASE WHEN z.po_termine THEN z.otvoreny END), 0) AS po_splatnosti,
         COALESCE(SUM(CASE WHEN z.po_termine THEN 1 END), 0) AS po_splatnosti_pocet
       FROM (
         SELECT ${OTVORENY_ZOSTATOK_SQL.replace('AS otvoreny_zostatok', 'AS otvoreny')},
                (i.datum_splat < dnes()) AS po_termine
         FROM invoices i
         WHERE i.stav <> 'koncept' AND i.kryje_id IS NULL
       ) z
       WHERE z.otvoreny > 0.005`,
    )
    .get() as any

  const r = {
    zaplatene: prijate.spolu,
    tento_rok: prijate.tento_rok,
    nezaplatene: otvorene.nezaplatene,
    po_splatnosti: otvorene.po_splatnosti,
    po_splatnosti_pocet: otvorene.po_splatnosti_pocet,
  }
  const roky = db
    .prepare("SELECT DISTINCT strftime('%Y', datum_vystav) AS rok FROM invoices ORDER BY rok DESC")
    .all() as { rok: string }[]
  res.json({ ...(r as object), roky: roky.map((x) => x.rok) })
})

// ── Návrh čísla a predvyplnenie novej faktúry ─────────────────
/**
 * Ukážka faktúry z nastavení – aby bolo hneď vidieť, ako sa zmena farby
 * alebo údajov o živnosti prejaví. Použije poslednú vystavenú faktúru;
 * keď ešte žiadna nie je, vyrobí ukážkovú, ktorá sa nikam neukladá.
 */
invoicesRouter.get('/ukazka/pdf', async (_req, res) => {
  try {
    const posledna = db
      .prepare("SELECT id FROM invoices WHERE stav <> 'koncept' ORDER BY datum_vystav DESC, id DESC LIMIT 1")
      .get() as { id: number } | undefined

    let pdf: Buffer
    if (posledna) {
      pdf = (await fakturaPdfPodlaId(posledna.id))!.pdf
    } else {
      const dnes = dnesISO()
      pdf = await vytvorFakturuPdf(
        {
          cislo: 'UKÁŽKA', datum_vystav: dnes, datum_dodania: dnes, datum_splat: predvolenaSplatnost(nastavenia(), dnes),
          variabilny: '2026001', poznamka: '', suma: 1250,
        },
        [{ popis: 'Montážne práce podľa objednávky', mnozstvo: 50, jednotka: 'hod', cena: 25 }],
        { nazov: 'Ukážková firma s.r.o.', adresa: 'Hlavná 1', psc_mesto: '811 01 Bratislava', krajina: 'Slovensko', ico: '12345678' },
        nastavenia(),
      )
    }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="Ukazka-faktury.pdf"')
    res.send(pdf)
  } catch (e: any) {
    console.error('[pdf ukážka]', e)
    res.status(500).json({ chyba: 'Ukážku sa nepodarilo vytvoriť: ' + e.message })
  }
})

invoicesRouter.get('/nova', (req, res) => {
  const n = nastavenia()
  const datum = String(req.query.datum ?? '') || dnesISO()
  res.json({
    cislo: dalsieCislo(n.cislo_vzor, datum),
    datum_vystav: datum,
    datum_dodania: datum,
    datum_splat: predvolenaSplatnost(n, datum),
    // Formulár podľa toho nastaví prepínač pracovných dní pri splatnosti.
    splatnost_dni: n.splatnost_dni,
    splatnost_pracovne: !!n.splatnost_pracovne,
  })
})

// ── Detail ────────────────────────────────────────────────────
invoicesRouter.get('/:id', (req, res) => {
  const f = db
    .prepare(
      `SELECT i.*, c.nazov AS firma_nazov, t.nazov AS turnus_nazov,
              COALESCE(NULLIF(o.cislo, ''), o.popis) AS objednavka_nazov,
              k.cislo AS kryje_cislo, k.suma AS kryje_suma, ${ROZSIRENE_SQL}
       FROM invoices i
       LEFT JOIN companies c ON c.id = i.company_id
       LEFT JOIN tours t ON t.id = i.tour_id
       LEFT JOIN orders o ON o.id = i.order_id
       LEFT JOIN invoices k ON k.id = i.kryje_id
       WHERE i.id = ?`,
    )
    .get(req.params.id)
  if (!f) return res.status(404).json({ chyba: 'Faktúra neexistuje.' })
  const polozky = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY poradie, id').all(req.params.id)
  res.json({
    ...(f as object),
    polozky,
    platby: platbyFaktury(req.params.id),
    // Zálohové faktúry, ktoré túto faktúru kryjú (ak je to pôvodná faktúra s dlhom).
    kryte_zalohami: kryciePlatby(req.params.id),
  })
})

// ── Vytvorenie ────────────────────────────────────────────────
invoicesRouter.post('/', (req, res) => {
  const b = req.body ?? {}
  const n = nastavenia()
  const datum_vystav = String(b.datum_vystav ?? '') || dnesISO()
  const polozky = spracujPolozky(b.polozky)
  if (!polozky.length) return res.status(400).json({ chyba: 'Faktúra musí mať aspoň jednu položku.' })

  const stav: Stav = STAVY.includes(b.stav) ? b.stav : 'vystavena'
  const cislo = String(b.cislo ?? '').trim() || dalsieCislo(n.cislo_vzor, datum_vystav)

  if (db.prepare('SELECT 1 FROM invoices WHERE cislo = ?').get(cislo)) {
    return res.status(400).json({ chyba: `Faktúra s číslom ${cislo} už existuje.` })
  }

  const typ = TYPY.includes(b.typ) ? b.typ : 'faktura'
  const data = {
    cislo,
    ...vazby(b),
    typ,
    // Krycia väzba dáva zmysel len pri zálohovej faktúre.
    kryje_id: typ === 'zaloha' && b.kryje_id ? Number(b.kryje_id) : null,
    datum_vystav,
    datum_dodania: String(b.datum_dodania ?? '') || datum_vystav,
    datum_splat: String(b.datum_splat ?? '') || predvolenaSplatnost(n, datum_vystav),
    // Zaplatenosť sa odvíja od platieb – „zaplatená" sa premietne do platby nižšie.
    stav: stav === 'zaplatena' ? 'vystavena' : stav,
    datum_uhrady: stav === 'zaplatena' ? String(b.datum_uhrady ?? '') || dnesISO() : null,
    variabilny: String(b.variabilny ?? '').trim() || cislo.replace(/\D/g, ''),
    poznamka: String(b.poznamka ?? '').trim(),
    suma: sucet(polozky),
  }

  const vloz = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO invoices (cislo, company_id, tour_id, order_id, typ, kryje_id, datum_vystav, datum_dodania, datum_splat, stav, datum_uhrady, variabilny, poznamka, suma)
         VALUES (@cislo, @company_id, @tour_id, @order_id, @typ, @kryje_id, @datum_vystav, @datum_dodania, @datum_splat, @stav, @datum_uhrady, @variabilny, @poznamka, @suma)`,
      )
      .run(data)
    const id = Number(info.lastInsertRowid)
    ulozPolozky(id, polozky)
    // Faktúru sa dá zapísať aj spätne aj s už prijatými platbami.
    if (Array.isArray(b.platby) && b.platby.length) nastavPlatby(id, b.platby)
    // Rýchle zadanie: stav „zaplatená" bez rozpisu = jedna platba na to, čo chýba.
    if (stav === 'zaplatena') doplatZvysok(id, String(b.datum_uhrady ?? '') || datum_vystav, 'zadané ako zaplatená faktúra')
    return id
  })

  try {
    const id = vloz()
    res.json({ id: Number(id) })
  } catch (e: any) {
    res.status(400).json({ chyba: e.message })
  }
})

// ── Úprava ────────────────────────────────────────────────────
/** Polia faktúry, ktoré úprava pri chýbajúcej hodnote prevezme z uloženej faktúry. */
const POLIA_FAKTURY = [
  'cislo', 'company_id', 'tour_id', 'order_id', 'typ', 'kryje_id',
  'datum_vystav', 'datum_dodania', 'datum_splat', 'variabilny', 'poznamka',
] as const

/**
 * „Zaplatená" znamená, že prišli celé peniaze. Čo ešte chýba po zapísaných
 * platbách a krycích zálohách, zapíšeme ako jednu platbu.
 */
function doplatZvysok(id: number, datum: string, poznamka: string) {
  const chyba = zaokruhli(otvorenyZostatok(id))
  if (chyba > 0.005) pridajPlatbu(id, datum, chyba, poznamka)
}

invoicesRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  const teraz = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Record<string, any> | undefined
  if (!teraz) return res.status(404).json({ chyba: 'Faktúra neexistuje.' })

  // Úprava je zlúčenie: pole, ktoré v požiadavke chýba, ostáva ako bolo. Inak by
  // stačilo, aby asistent neposlal typ dokladu, a zo zálohovej faktúry by sa
  // potichu stala bežná – a starý dlh by prestala kryť.
  const b: Record<string, any> = { ...(req.body ?? {}) }
  for (const pole of POLIA_FAKTURY) if (b[pole] === undefined) b[pole] = teraz[pole]

  const polozky = spracujPolozky(
    b.polozky === undefined
      ? db.prepare('SELECT popis, mnozstvo, jednotka, cena FROM invoice_items WHERE invoice_id = ? ORDER BY poradie, id').all(id)
      : b.polozky,
  )
  if (!polozky.length) return res.status(400).json({ chyba: 'Faktúra musí mať aspoň jednu položku.' })

  const stav: Stav = STAVY.includes(b.stav) ? b.stav : teraz.stav === 'koncept' && b.stav === undefined ? 'koncept' : 'vystavena'
  const cislo = String(b.cislo ?? '').trim()
  if (!cislo) return res.status(400).json({ chyba: 'Číslo faktúry je povinné.' })

  const kolizia = db.prepare('SELECT id FROM invoices WHERE cislo = ? AND id <> ?').get(cislo, id)
  if (kolizia) return res.status(400).json({ chyba: `Faktúra s číslom ${cislo} už existuje.` })

  const typUpravy = TYPY.includes(b.typ) ? b.typ : 'faktura'
  const datum_vystav = String(b.datum_vystav ?? '') || dnesISO()
  const data = {
    id,
    cislo,
    ...vazby(b),
    typ: typUpravy,
    // Zálohová faktúra nemôže kryť sama seba.
    kryje_id: typUpravy === 'zaloha' && b.kryje_id && Number(b.kryje_id) !== id ? Number(b.kryje_id) : null,
    datum_vystav,
    datum_dodania: String(b.datum_dodania ?? '') || datum_vystav,
    datum_splat: String(b.datum_splat ?? '') || predvolenaSplatnost(nastavenia(), datum_vystav),
    stav: stav === 'zaplatena' ? 'vystavena' : stav,
    datum_uhrady: stav === 'zaplatena' ? String(b.datum_uhrady ?? '') || dnesISO() : null,
    variabilny: String(b.variabilny ?? '').trim(),
    poznamka: String(b.poznamka ?? '').trim(),
    suma: sucet(polozky),
  }

  const uprav = db.transaction(() => {
    db.prepare(
      `UPDATE invoices SET cislo=@cislo, company_id=@company_id, tour_id=@tour_id, order_id=@order_id,
       typ=@typ, kryje_id=@kryje_id, datum_vystav=@datum_vystav, datum_dodania=@datum_dodania,
       datum_splat=@datum_splat, stav=@stav, datum_uhrady=@datum_uhrady, variabilny=@variabilny,
       poznamka=@poznamka, suma=@suma WHERE id=@id`,
    ).run(data)
    ulozPolozky(id, polozky)
    if (Array.isArray(b.platby)) nastavPlatby(id, b.platby)
    // Stav „zaplatená" bez platby by inak nič nezmenil – doplatíme, čo chýba.
    if (stav === 'zaplatena') doplatZvysok(id, data.datum_uhrady ?? dnesISO(), 'doplatok')
  })

  try {
    uprav()
    res.json({ ok: true })
  } catch (e: any) {
    res.status(400).json({ chyba: e.message })
  }
})

// ── Rýchla zmena stavu ────────────────────────────────────────
invoicesRouter.post('/:id/stav', (req, res) => {
  const stav = String(req.body?.stav ?? '')
  if (!STAVY.includes(stav as Stav)) return res.status(400).json({ chyba: 'Neznámy stav.' })

  const f = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any
  if (!f) return res.status(404).json({ chyba: 'Faktúra neexistuje.' })

  if (stav === 'zaplatena') {
    // Doplatíme rozdiel ako platbu – zaplatenosť sa odvíja od platieb, nie od príznaku.
    // Rátame z otvoreného zostatku, takže sa nezapíše znova to, čo už prišlo
    // cez zálohovú faktúru kryjúcu túto faktúru.
    const chyba = zaokruhli(otvorenyZostatok(req.params.id))
    let platba_id: number | null = null
    if (chyba > 0.005) {
      platba_id = pridajPlatbu(Number(req.params.id), String(req.body?.datum_uhrady ?? '') || dnesISO(), chyba, 'doplatok')
    }
    db.prepare("UPDATE invoices SET stav = 'vystavena' WHERE id = ?").run(req.params.id)
    // ID zapísanej platby vracia appke možnosť ponúknuť „Vrátiť späť";
    // `odlozit` je pripomienka, koľko si z nej odložiť na dane a odvody.
    return res.json({ ok: true, platba_id, odlozit: platba_id ? naOdlozenie(chyba) : 0 })
  } else if (stav === 'vystavena') {
    // Zrušenie úhrady = zmazanie platieb; inak by faktúra ostala „zaplatená".
    db.prepare('DELETE FROM invoice_payments WHERE invoice_id = ?').run(req.params.id)
    db.prepare("UPDATE invoices SET stav = 'vystavena', datum_uhrady = NULL WHERE id = ?").run(req.params.id)
  } else {
    db.prepare("UPDATE invoices SET stav = 'koncept' WHERE id = ?").run(req.params.id)
  }
  res.json({ ok: true })
})

// ── Platby k faktúre ──────────────────────────────────────────
invoicesRouter.get('/:id/platby', (req, res) => {
  res.json(platbyFaktury(req.params.id))
})

invoicesRouter.post('/:id/platby', (req, res) => {
  const f = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id)
  if (!f) return res.status(404).json({ chyba: 'Faktúra neexistuje.' })

  const suma = zaokruhli(Number(req.body?.suma) || 0)
  if (suma <= 0) return res.status(400).json({ chyba: 'Suma platby musí byť väčšia než nula.' })
  const datum = String(req.body?.datum ?? '').slice(0, 10) || dnesISO()

  const id = pridajPlatbu(Number(req.params.id), datum, suma, String(req.body?.poznamka ?? ''))
  res.json({ id })
})

invoicesRouter.delete('/platby/:platbaId', (req, res) => {
  const info = db.prepare('DELETE FROM invoice_payments WHERE id = ?').run(req.params.platbaId)
  if (!info.changes) return res.status(404).json({ chyba: 'Platba neexistuje.' })
  res.json({ ok: true })
})

// ── Prehľad dlhov a zálohových faktúr ─────────────────────────
invoicesRouter.get('/prehlad/dlhy', (_req, res) => {
  const spolocne = `i.*, c.nazov AS firma_nazov, k.cislo AS kryje_cislo, k.suma AS kryje_suma, ${ROZSIRENE_SQL}`
  const spoje = `FROM invoices i
                 LEFT JOIN companies c ON c.id = i.company_id
                 LEFT JOIN invoices k ON k.id = i.kryje_id`
  const dotaz = (kde: string, radenie = 'i.datum_splat, i.id') =>
    db.prepare(`SELECT ${spolocne} ${spoje} WHERE i.stav <> 'koncept' AND ${kde} ORDER BY ${radenie}`).all()

  res.json({
    // 1) Nevyplatené – čokoľvek s otvoreným zostatkom, krycie zálohy zvlášť nižšie.
    nevyplatene: dotaz(`${UHRADENE_SQL} < i.suma - 0.005 AND i.kryje_id IS NULL`),
    // 2) Plne uhradené
    vyplatene: dotaz(`${UHRADENE_SQL} >= i.suma - 0.005 AND i.kryje_id IS NULL`, 'i.datum_vystav DESC, i.id DESC'),
    // 3a) Zálohové faktúry kryjúce starý dlh
    zalohy_kryjuce: dotaz("i.typ = 'zaloha' AND i.kryje_id IS NOT NULL", 'i.datum_vystav DESC, i.id DESC'),
    // 3b) Ostatné zálohové faktúry
    zalohy_ostatne: dotaz("i.typ = 'zaloha' AND i.kryje_id IS NULL", 'i.datum_vystav DESC, i.id DESC'),
  })
})

invoicesRouter.delete('/:id', (req, res) => {
  const f = db.prepare('SELECT cislo, suma FROM invoices WHERE id = ?').get(req.params.id) as any
  if (!f) return res.status(404).json({ chyba: 'Faktúra neexistuje.' })
  doKosa('invoices', Number(req.params.id), `Faktúra ${f.cislo}`)
  res.json({ ok: true, doKosa: true })
})

// ── PDF ───────────────────────────────────────────────────────
invoicesRouter.get('/:id/pdf', async (req, res) => {
  try {
    const v = await fakturaPdfPodlaId(req.params.id)
    if (!v) return res.status(404).json({ chyba: 'Faktúra neexistuje.' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `${req.query.stiahnut === '1' ? 'attachment' : 'inline'}; filename="${v.nazov}"`,
    )
    res.send(v.pdf)
  } catch (e: any) {
    console.error('[pdf]', e)
    res.status(500).json({ chyba: 'PDF sa nepodarilo vytvoriť: ' + e.message })
  }
})
