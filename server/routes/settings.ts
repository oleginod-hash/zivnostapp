import { Router } from 'express'
import { db } from '../db.js'

export const settingsRouter = Router()

const POLIA = [
  'meno', 'adresa', 'psc_mesto', 'krajina', 'ico', 'dic', 'zapis',
  'email', 'telefon', 'iban', 'swift', 'banka', 'cislo_vzor', 'poznamka_pati',
  'predmety', 'datum_vzniku', 'urad_zr', 'cislo_zr', 'ic_dph',
  'zdravotna_poistovna', 'web', 'sposob_uhrady',
] as const

/**
 * Zapnuté / vypnuté voľby (v databáze 1 / 0).
 * splatnost_pracovne – predvolená splatnosť v pracovných dňoch,
 * praca_v_zahranici – AI asistenti rátajú so zákazkami v zahraničí (turnusy).
 */
const PREPINACE = ['splatnost_pracovne', 'praca_v_zahranici'] as const

/** Polia s pevným zoznamom hodnôt – čokoľvek iné sa vráti na predvolenú. */
const VOLBY: Record<string, { povolene: string[]; predvolena: string }> = {
  dph_rezim: { povolene: ['neplatitel', '7a'], predvolena: 'neplatitel' },
  vydavky_typ: { povolene: ['pausalne', 'skutocne'], predvolena: 'pausalne' },
}

function aktualne() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, any>
}

settingsRouter.get('/', (_req, res) => {
  res.json(aktualne())
})

/**
 * Úprava je zlúčenie, nie prepísanie: pole, ktoré v požiadavke chýba, ostáva
 * ako bolo. Inak by stačilo, aby asistent alebo staršia verzia formulára
 * poslala len časť údajov, a zvyšok (napr. predmety podnikania) by sa potichu
 * vymazal.
 */
settingsRouter.put('/', (req, res) => {
  const b = req.body ?? {}
  const teraz = aktualne()
  const hodnoty: Record<string, unknown> = {}

  for (const p of POLIA) {
    hodnoty[p] = b[p] === undefined ? teraz[p] : String(b[p] ?? '').trim()
  }
  if (!hodnoty.cislo_vzor) hodnoty.cislo_vzor = '{RRRR}{NNN}'

  if (b.splatnost_dni === undefined) {
    hodnoty.splatnost_dni = teraz.splatnost_dni
  } else {
    const dni = Number(b.splatnost_dni)
    hodnoty.splatnost_dni = Number.isFinite(dni) && dni >= 0 && dni <= 365 ? Math.round(dni) : 14
  }

  // Prepínače môžu prísť ako true/false z formulára aj ako 1/0 od asistenta.
  for (const prepinac of PREPINACE) {
    const v = b[prepinac] === undefined ? teraz[prepinac] : b[prepinac]
    hodnoty[prepinac] = v === true || v === 1 || v === '1' ? 1 : 0
  }

  for (const [pole, v] of Object.entries(VOLBY)) {
    const vstup = b[pole] === undefined ? teraz[pole] : b[pole]
    hodnoty[pole] = v.povolene.includes(vstup) ? vstup : v.predvolena
  }

  // Farba faktúry ide rovno do PDF, preto berieme len platný hex zápis.
  const farba = b.farba_faktury === undefined ? teraz.farba_faktury : b.farba_faktury
  hodnoty.farba_faktury = /^#[0-9a-fA-F]{6}$/.test(String(farba ?? '')) ? farba : '#2f6fd6'

  const set = [...POLIA, 'splatnost_dni', ...PREPINACE, ...Object.keys(VOLBY), 'farba_faktury']
    .map((p) => `${p} = @${p}`)
    .join(', ')
  db.prepare(`UPDATE settings SET ${set} WHERE id = 1`).run(hodnoty)
  res.json(aktualne())
})
