import { Router } from 'express'
import { db } from '../db.js'
import { dnesISO, pridajDni, skSuma } from '../lib/format.js'
import { jePracovnyDen } from '../lib/pracovneDni.js'
import { OTVORENY_ZOSTATOK_SQL } from '../lib/platby.js'

/**
 * Kalendár termínov – čo ma v najbližších týždňoch čaká. Z dát appky
 * (splatnosti faktúr, koniec a výpoveď zmlúv, začiatok turnusov) a k tomu
 * všeobecné termíny živnostníka (odvody, daňové priznanie, pri registrácii
 * podľa § 7a súhrnný výkaz), ktoré sa dajú v Nastaveniach vypnúť.
 *
 * Zákonné termíny sú pripomienka, nie výklad zákona – popis to hovorí
 * a pri každom je odkaz „over si u účtovníčky" na strane appky.
 */
export const terminyRouter = Router()

export type Termin = {
  datum: string
  druh: 'splatnost' | 'zmluva' | 'vypoved' | 'turnus' | 'odvody' | 'dan' | 'suhrnny_vykaz'
  nazov: string
  popis: string
  cesta: string
}

const MESIACE = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december']
const PORADIE: Termin['druh'][] = ['dan', 'odvody', 'suhrnny_vykaz', 'vypoved', 'zmluva', 'splatnost', 'turnus']

/** Krajiny EÚ podľa predpony IČ DPH (Grécko má EL). Slovensko nie – to je tuzemsko. */
const EU = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI']

/** Termín, ktorý pripadne na víkend alebo sviatok, sa posúva na najbližší pracovný deň. */
function pracovny(iso: string): string {
  let d = iso
  while (!jePracovnyDen(d)) d = pridajDni(d, 1)
  return d
}

/** Prvé dni mesiacov od mesiaca `od` po mesiac `doDna` (vrátane). */
function mesiace(od: string, doDna: string): { rok: number; mesiac: number }[] {
  const vysledok = []
  let rok = Number(od.slice(0, 4))
  let mesiac = Number(od.slice(5, 7))
  const konecny = Number(doDna.slice(0, 4)) * 12 + Number(doDna.slice(5, 7))
  while (rok * 12 + mesiac <= konecny) {
    vysledok.push({ rok, mesiac })
    mesiac++
    if (mesiac > 12) {
      mesiac = 1
      rok++
    }
  }
  return vysledok
}

const iso = (rok: number, mesiac: number, den: number) =>
  `${rok}-${String(mesiac).padStart(2, '0')}-${String(den).padStart(2, '0')}`

export function terminy(od: string, doDna: string): Termin[] {
  const vysledok: Termin[] = []
  const vOkne = (d: string | null | undefined) => !!d && d >= od && d <= doDna

  // Splatnosti faktúr, ktoré ešte nie sú uhradené. Tie po splatnosti sú v „Vyžaduje pozornosť".
  const faktury = db
    .prepare(
      `SELECT * FROM (
         SELECT i.id, i.cislo, i.datum_splat, c.nazov AS firma, ${OTVORENY_ZOSTATOK_SQL}
         FROM invoices i LEFT JOIN companies c ON c.id = i.company_id
         WHERE i.stav <> 'koncept' AND i.kryje_id IS NULL AND i.datum_splat BETWEEN ? AND ?
       ) WHERE otvoreny_zostatok > 0.005`,
    )
    .all(od, doDna) as { id: number; cislo: string; datum_splat: string; firma: string | null; otvoreny_zostatok: number }[]
  for (const f of faktury) {
    vysledok.push({
      datum: f.datum_splat,
      druh: 'splatnost',
      nazov: `Splatnosť faktúry ${f.cislo}`,
      popis: [f.firma, `čaká sa ${skSuma(f.otvoreny_zostatok)}`].filter(Boolean).join(' · '),
      cesta: `/faktury/${f.id}`,
    })
  }

  // Zmluvy: koniec platnosti, a pri automatickej obnove posledný deň na výpoveď.
  const zmluvy = db
    .prepare(
      `SELECT id, nazov, platnost_do, obnova, vypoved_dni FROM contracts
       WHERE stav = 'aktivna' AND platnost_do IS NOT NULL AND platnost_do <> ''`,
    )
    .all() as { id: number; nazov: string; platnost_do: string; obnova: string; vypoved_dni: number }[]
  for (const z of zmluvy) {
    if (vOkne(z.platnost_do)) {
      vysledok.push({
        datum: z.platnost_do,
        druh: 'zmluva',
        nazov: `Koniec zmluvy ${z.nazov}`,
        popis: z.obnova === 'automaticka' ? 'Zmluva sa obnoví automaticky, ak nebola vypovedaná.' : 'Končí platnosť zmluvy.',
        cesta: `/zmluvy/${z.id}`,
      })
    }
    if (z.obnova === 'automaticka' && z.vypoved_dni > 0) {
      const vypoved = pridajDni(z.platnost_do, -z.vypoved_dni)
      if (vOkne(vypoved)) {
        vysledok.push({
          datum: vypoved,
          druh: 'vypoved',
          nazov: `Posledný deň na výpoveď zmluvy ${z.nazov}`,
          popis: 'Ak zmluvu nevypovieš, automaticky sa obnoví.',
          cesta: `/zmluvy/${z.id}`,
        })
      }
    }
  }

  // Začiatok naplánovaných turnusov.
  const turnusy = db
    .prepare(
      `SELECT t.id, t.nazov, t.datum_od, t.krajina, c.nazov AS firma FROM tours t
       LEFT JOIN companies c ON c.id = t.company_id
       WHERE t.zruseny = 0 AND t.datum_od BETWEEN ? AND ?`,
    )
    .all(od, doDna) as { id: number; nazov: string; datum_od: string; krajina: string; firma: string | null }[]
  for (const t of turnusy) {
    vysledok.push({
      datum: t.datum_od,
      druh: 'turnus',
      nazov: `Začiatok turnusu ${t.nazov}`,
      popis: [t.firma, t.krajina].filter(Boolean).join(' · '),
      cesta: `/turnusy/${t.id}`,
    })
  }

  const n = db.prepare('SELECT terminy_zakonne, dph_rezim FROM settings WHERE id = 1').get() as {
    terminy_zakonne: number; dph_rezim: string
  }
  if (n?.terminy_zakonne !== 0) {
    for (const { rok, mesiac } of mesiace(od, doDna)) {
      // Poistné do Sociálnej aj preddavky do zdravotnej poisťovne sú splatné
      // do 8. dňa mesiaca za predchádzajúci mesiac.
      const odvody = pracovny(iso(rok, mesiac, 8))
      if (vOkne(odvody)) {
        vysledok.push({
          datum: odvody,
          druh: 'odvody',
          nazov: `Odvody za ${MESIACE[(mesiac + 10) % 12]}`,
          popis: 'Sociálna a zdravotná poisťovňa',
          cesta: '/financie',
        })
      }

      // Daňové priznanie typu B a zaplatenie dane za predchádzajúci rok.
      if (mesiac === 3) {
        const dan = pracovny(iso(rok, 3, 31))
        if (vOkne(dan)) {
          vysledok.push({
            datum: dan,
            druh: 'dan',
            nazov: `Daňové priznanie a daň za ${rok - 1}`,
            popis:
              'Podať priznanie a zaplatiť daň. Oznámením daňovému úradu sa termín dá predĺžiť o 3 mesiace, ' +
              'pri príjmoch zo zahraničia o 6 mesiacov.',
            cesta: '/danovy-podklad',
          })
        }
      }

      // Súhrnný výkaz pri registrácii podľa § 7a – len keď boli v predchádzajúcom
      // mesiaci vystavené faktúry firmám s IČ DPH z inej krajiny EÚ.
      if (n.dph_rezim === '7a') {
        const vykaz = pracovny(iso(rok, mesiac, 25))
        const [r0, m0] = mesiac === 1 ? [rok - 1, 12] : [rok, mesiac - 1]
        if (vOkne(vykaz)) {
          const pocet = (
            db
              .prepare(
                `SELECT COUNT(*) AS n FROM invoices i JOIN companies c ON c.id = i.company_id
                 WHERE i.stav <> 'koncept' AND i.datum_vystav BETWEEN ? AND ?
                   AND upper(substr(replace(c.ic_dph, ' ', ''), 1, 2)) IN (${EU.map(() => '?').join(', ')})`,
              )
              .get(iso(r0, m0, 1), iso(r0, m0, 31), ...EU) as { n: number }
          ).n
          if (pocet > 0) {
            vysledok.push({
              datum: vykaz,
              druh: 'suhrnny_vykaz',
              nazov: `Súhrnný výkaz za ${MESIACE[m0 - 1]}`,
              popis: `V mesiaci ${MESIACE[m0 - 1]} boli vystavené faktúry firmám z inej krajiny EÚ. Over si s účtovníčkou.`,
              cesta: '/faktury',
            })
          }
        }
      }
    }
  }

  return vysledok.sort((a, b) => a.datum.localeCompare(b.datum) || PORADIE.indexOf(a.druh) - PORADIE.indexOf(b.druh))
}

terminyRouter.get('/', (req, res) => {
  const dni = Math.min(Math.max(Number(req.query.dni) || 60, 1), 400)
  const od = dnesISO()
  const doDna = pridajDni(od, dni)
  res.json({ od, do: doDna, terminy: terminy(od, doDna) })
})
