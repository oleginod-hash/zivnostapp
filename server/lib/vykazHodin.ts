import { db } from '../db.js'
import { pridajDni, zaokruhli } from './format.js'
import { akcentZNastaveni, F, FB, FS, novyDokument } from './invoicePdf.js'

/**
 * Výkaz hodín pri turnuse: odpracované hodiny po dňoch. Z neho appka spočíta
 * sumu za turnus (hodiny × hodinová sadzba), vystaví faktúru a vytlačí výkaz,
 * ktorý zákazník často chce podpísaný ako prílohu k faktúre.
 */
export type DenVykazu = { datum: string; hodiny: number; poznamka: string }

export type Vykaz = {
  turnus: { id: number; nazov: string; datum_od: string; datum_do: string; company_id: number | null; firma_nazov: string | null; miesto: string; krajina: string }
  dni: DenVykazu[]
  sadzba: number
  /** Odkiaľ je sadzba, keď ešte nie je uložená pri turnuse. */
  sadzba_odkial: 'turnus' | 'objednavka' | 'predosly_turnus' | ''
  spolu_hodin: number
  suma: number
}

/** Najviac jeden rok dní – turnus dlhší než rok je určite preklep v dátume. */
const NAJVIAC_DNI = 400

export function dniOdDo(od: string, do_: string): string[] {
  const dni: string[] = []
  for (let d = od; d <= do_ && dni.length < NAJVIAC_DNI; d = pridajDni(d, 1)) dni.push(d)
  return dni
}

export function nacitajVykaz(tourId: number): Vykaz | null {
  const t = db
    .prepare(
      `SELECT t.id, t.nazov, t.datum_od, t.datum_do, t.company_id, t.miesto, t.krajina, t.hodinova_sadzba, c.nazov AS firma_nazov
       FROM tours t LEFT JOIN companies c ON c.id = t.company_id WHERE t.id = ?`,
    )
    .get(tourId) as (Vykaz['turnus'] & { hodinova_sadzba: number }) | undefined
  if (!t) return null

  const ulozene = db
    .prepare('SELECT datum, hodiny, poznamka FROM tour_hours WHERE tour_id = ? ORDER BY datum')
    .all(tourId) as DenVykazu[]
  const podlaDna = new Map(ulozene.map((d) => [d.datum, d]))
  // Všetky dni turnusu; k nim aj zapísané dni mimo neho (keď sa turnus neskôr skrátil) – nič sa nestratí.
  const dni = [...new Set([...dniOdDo(t.datum_od, t.datum_do), ...ulozene.map((d) => d.datum)])]
    .sort()
    .map((datum) => podlaDna.get(datum) ?? { datum, hodiny: 0, poznamka: '' })

  // Sadzba: uložená pri turnuse, inak z objednávky na hodinovú sadzbu, inak z predošlého turnusu u tej istej firmy.
  let sadzba = t.hodinova_sadzba
  let odkial: Vykaz['sadzba_odkial'] = sadzba > 0 ? 'turnus' : ''
  if (!(sadzba > 0)) {
    const zObjednavky = db
      .prepare("SELECT hodinovka FROM orders WHERE tour_id = ? AND hodinovka > 0 AND stav <> 'zrusena' ORDER BY id DESC LIMIT 1")
      .get(tourId) as { hodinovka: number } | undefined
    const zTurnusu = t.company_id
      ? (db
          .prepare('SELECT hodinova_sadzba FROM tours WHERE company_id = ? AND id <> ? AND hodinova_sadzba > 0 ORDER BY datum_od DESC LIMIT 1')
          .get(t.company_id, tourId) as { hodinova_sadzba: number } | undefined)
      : undefined
    if (zObjednavky) {
      sadzba = zObjednavky.hodinovka
      odkial = 'objednavka'
    } else if (zTurnusu) {
      sadzba = zTurnusu.hodinova_sadzba
      odkial = 'predosly_turnus'
    } else sadzba = 0
  }

  const spolu = zaokruhli(dni.reduce((s, d) => s + d.hodiny, 0))
  const { hodinova_sadzba: _s, ...turnus } = t
  return { turnus, dni, sadzba, sadzba_odkial: odkial, spolu_hodin: spolu, suma: zaokruhli(spolu * sadzba) }
}

/** Uloží celý výkaz naraz. Dni bez hodín a bez poznámky sa neukladajú. */
export function ulozVykaz(tourId: number, dni: unknown, sadzba: unknown): string | null {
  if (!Array.isArray(dni)) return 'Chýbajú dni výkazu.'
  const ciste: DenVykazu[] = []
  for (const d of dni as any[]) {
    const datum = String(d?.datum ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return 'Neplatný dátum vo výkaze.'
    const hodiny = Math.round((Number(d?.hodiny) || 0) * 100) / 100
    if (hodiny < 0 || hodiny > 24) return `Počet hodín ${d?.hodiny} (${datum}) nie je možný – deň má 24 hodín.`
    const poznamka = String(d?.poznamka ?? '').trim().slice(0, 300)
    if (hodiny > 0 || poznamka) ciste.push({ datum, hodiny, poznamka })
  }
  const s = Math.max(0, zaokruhli(Number(sadzba) || 0))
  db.transaction(() => {
    db.prepare('DELETE FROM tour_hours WHERE tour_id = ?').run(tourId)
    const vloz = db.prepare('INSERT INTO tour_hours (tour_id, datum, hodiny, poznamka) VALUES (?, ?, ?, ?)')
    for (const d of ciste) vloz.run(tourId, d.datum, d.hodiny, d.poznamka)
    db.prepare('UPDATE tours SET hodinova_sadzba = ? WHERE id = ?').run(s, tourId)
  })()
  return null
}

// ── PDF ─────────────────────────────────────────────────────────
const DNI_TYZDNA = ['nedeľa', 'pondelok', 'utorok', 'streda', 'štvrtok', 'piatok', 'sobota']
const denTyzdna = (iso: string) => DNI_TYZDNA[new Date(iso + 'T12:00:00Z').getUTCDay()]
const datumSk = (iso: string) => {
  const [r, m, d] = iso.split('-')
  return `${d}.${m}.${r}`
}
const cislo = (n: number, desatinne = 2) =>
  new Intl.NumberFormat('sk-SK', { minimumFractionDigits: desatinne, maximumFractionDigits: 2 }).format(n ?? 0)

const L = 42
const R = 595.28 - 42
const SIRKA = R - L
const TEXT = '#1f2937'
const SEDA = '#6b7280'
const CIARA = '#e5e7eb'

export async function vykazPdf(vykaz: Vykaz): Promise<{ pdf: Buffer; nazov: string }> {
  const nastavenia = db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, any>
  const akcent = akcentZNastaveni(nastavenia)
  const t = vykaz.turnus
  const { doc, hotovo } = novyDokument(`Výkaz hodín – ${t.nazov}`, nastavenia.meno || '')

  doc.rect(0, 0, 595.28, 5).fill(akcent)
  doc.font(FB).fontSize(19).fillColor(TEXT).text('VÝKAZ ODPRACOVANÝCH HODÍN', L, 34, { lineBreak: false })
  doc.moveTo(L, 66).lineTo(R, 66).lineWidth(0.8).strokeColor(CIARA).stroke()

  // Kto, pre koho, kde a kedy.
  let y = 80
  const udaj = (popis: string, hodnota: string) => {
    if (!hodnota) return
    doc.font(F).fontSize(9.5).fillColor(SEDA).text(popis, L, y, { width: 110, lineBreak: false })
    doc.font(FS).fontSize(9.5).fillColor(TEXT).text(hodnota, L + 110, y, { width: SIRKA - 110 })
    y = doc.y + 4
  }
  udaj('Dodávateľ', [nastavenia.meno, nastavenia.ico && `IČO ${nastavenia.ico}`].filter(Boolean).join(', '))
  udaj('Odberateľ', t.firma_nazov ?? '')
  udaj('Zákazka', [t.nazov, [t.miesto, t.krajina].filter(Boolean).join(', ')].filter(Boolean).join(' – '))
  udaj('Obdobie', `${datumSk(t.datum_od)} – ${datumSk(t.datum_do)}`)
  y += 10

  // Tabuľka po dňoch.
  const stl = { datum: L + 8, den: L + 92, hodiny: L + 170, poznamka: L + 250 }
  const hlavicka = () => {
    doc.rect(L, y, SIRKA, 20).fill(akcent)
    doc.font(FS).fontSize(8.5).fillColor('#ffffff')
    doc.text('DÁTUM', stl.datum, y + 6, { lineBreak: false })
    doc.text('DEŇ', stl.den, y + 6, { lineBreak: false })
    doc.text('HODINY', stl.hodiny, y + 6, { width: 60, align: 'right', lineBreak: false })
    doc.text('POZNÁMKA', stl.poznamka, y + 6, { lineBreak: false })
    y += 20
  }
  hlavicka()
  for (const d of vykaz.dni) {
    const vysokaPoznamka = d.poznamka ? doc.font(F).fontSize(9).heightOfString(d.poznamka, { width: R - stl.poznamka - 6 }) : 0
    const vyska = Math.max(17, vysokaPoznamka + 7)
    if (y + vyska > 700) {
      doc.addPage()
      y = 42
      hlavicka()
    }
    const den = new Date(d.datum + 'T12:00:00Z').getUTCDay()
    if (den === 0 || den === 6) doc.rect(L, y, SIRKA, vyska).fill('#f3f4f6')
    doc.font(F).fontSize(9).fillColor(d.hodiny ? TEXT : SEDA)
    doc.text(datumSk(d.datum), stl.datum, y + 4.5, { lineBreak: false })
    doc.text(denTyzdna(d.datum), stl.den, y + 4.5, { lineBreak: false })
    doc.font(d.hodiny ? FS : F).text(d.hodiny ? cislo(d.hodiny, 0) : '—', stl.hodiny, y + 4.5, { width: 60, align: 'right', lineBreak: false })
    if (d.poznamka) doc.font(F).fillColor(TEXT).text(d.poznamka, stl.poznamka, y + 4.5, { width: R - stl.poznamka - 6 })
    y += vyska
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(CIARA).stroke()
  }

  // Súčet.
  if (y > 640) {
    doc.addPage()
    y = 42
  }
  y += 12
  const suctovy = (popis: string, hodnota: string, tucne = false) => {
    doc.font(tucne ? FB : F).fontSize(tucne ? 11.5 : 10).fillColor(TEXT)
    doc.text(popis, R - 260, y, { width: 150, lineBreak: false })
    doc.text(hodnota, R - 110, y, { width: 110, align: 'right', lineBreak: false })
    y += tucne ? 20 : 16
  }
  suctovy('Spolu odpracované', `${cislo(vykaz.spolu_hodin, 0)} h`, !vykaz.sadzba)
  if (vykaz.sadzba > 0) {
    suctovy('Hodinová sadzba', `${cislo(vykaz.sadzba)} €`)
    suctovy('Spolu', `${cislo(vykaz.suma)} €`, true)
  }

  // Podpisy – zákazník výkaz často potvrdzuje.
  y = Math.max(y + 50, 660)
  for (const [x, popis] of [[L, 'Podpis dodávateľa'], [R - 200, 'Potvrdenie odberateľa']] as const) {
    doc.moveTo(x, y).lineTo(x + 200, y).lineWidth(0.7).strokeColor('#9ca3af').stroke()
    doc.font(F).fontSize(8.5).fillColor(SEDA).text(popis, x, y + 5, { width: 200, align: 'center', lineBreak: false })
  }

  const rozsah = doc.bufferedPageRange()
  for (let i = 0; i < rozsah.count; i++) {
    doc.switchToPage(rozsah.start + i)
    doc.moveTo(L, 804).lineTo(R, 804).lineWidth(0.6).strokeColor(CIARA).stroke()
    doc.font(F).fontSize(7.5).fillColor('#9ca3af')
    doc.text(`Výkaz hodín – ${t.nazov}`, L, 811, { lineBreak: false })
    doc.text(`Strana ${i + 1}/${rozsah.count}`, L, 811, { width: SIRKA, align: 'right', lineBreak: false })
  }
  doc.end()
  const bezDiakritiky = t.nazov.normalize('NFD').replace(/\p{M}/gu, '')
  return { pdf: await hotovo, nazov: `Vykaz-hodin-${bezDiakritiky.replace(/[^\w.-]+/g, '_')}.pdf` }
}
