import { Router } from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { db } from '../db.js'
import { cestaLoga, PRIECINOK_LOGA } from '../lib/logo.js'
import { jeSadzbaDph } from '../lib/dph.js'
import { vzorJePlatny } from '../lib/cislovanie.js'

export const settingsRouter = Router()

const POLIA = [
  'meno', 'adresa', 'psc_mesto', 'krajina', 'ico', 'dic', 'zapis',
  'email', 'telefon', 'iban', 'swift', 'banka', 'cislo_vzor', 'cislo_vzor_zaloha', 'poznamka_pati',
  'predmety', 'datum_vzniku', 'urad_zr', 'cislo_zr', 'ic_dph',
  'zdravotna_poistovna', 'web', 'sposob_uhrady',
] as const

/**
 * Zapnuté / vypnuté voľby (v databáze 1 / 0).
 * splatnost_pracovne – predvolená splatnosť v pracovných dňoch,
 * praca_v_zahranici – asistent počíta so zákazkami v zahraničí (turnusy),
 * sprievodca_hotovy – sprievodca prvým spustením je za nami (dokončený alebo preskočený),
 * terminy_zakonne – v kalendári termínov sú aj odvody a daňové priznanie.
 */
const PREPINACE = ['splatnost_pracovne', 'praca_v_zahranici', 'sprievodca_hotovy', 'terminy_zakonne'] as const

/** Polia s pevným zoznamom hodnôt – čokoľvek iné sa vráti na predvolenú. */
const VOLBY: Record<string, { povolene: string[]; predvolena: string }> = {
  dph_rezim: { povolene: ['neplatitel', '7a', 'platitel'], predvolena: 'neplatitel' },
  dph_obdobie: { povolene: ['mesacne', 'stvrtrocne'], predvolena: 'mesacne' },
  pdf_vzhlad: { povolene: ['klasicky', 'usporny', 'vyrazny'], predvolena: 'klasicky' },
  vydavky_typ: { povolene: ['pausalne', 'skutocne'], predvolena: 'pausalne' },
}

function aktualne() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, any>
}

settingsRouter.get('/', (_req, res) => {
  res.json(aktualne())
})

// ── Logo na faktúre ───────────────────────────────────────────
// PDF vie vložiť PNG a JPEG. Každé nahratie je nový súbor – zálohy na starý
// súbor odkazujú pevným odkazom, prepísať ho na mieste by zmenilo aj ich.
const nahratieLoga = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } })

settingsRouter.post('/logo', nahratieLoga.single('logo'), (req, res) => {
  const b = req.file?.buffer
  if (!b) return res.status(400).json({ chyba: 'Vyber obrázok s logom.' })
  const png = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const jpg = b[0] === 0xff && b[1] === 0xd8
  if (!png && !jpg) return res.status(400).json({ chyba: 'Logo musí byť obrázok PNG alebo JPG.' })
  fs.mkdirSync(PRIECINOK_LOGA, { recursive: true })
  const nazov = `${crypto.randomUUID()}.${png ? 'png' : 'jpg'}`
  fs.writeFileSync(path.join(PRIECINOK_LOGA, nazov), b)
  db.prepare('UPDATE settings SET logo = ? WHERE id = 1').run(nazov)
  res.json(aktualne())
})

settingsRouter.get('/logo', (_req, res) => {
  const cesta = cestaLoga(aktualne().logo)
  if (!cesta) return res.status(404).json({ chyba: 'Logo nie je nahraté.' })
  res.sendFile(cesta)
})

/** Faktúra bude bez loga. Súbor ostáva – môže naň odkazovať záloha. */
settingsRouter.post('/logo/odobrat', (_req, res) => {
  db.prepare("UPDATE settings SET logo = '' WHERE id = 1").run()
  res.json(aktualne())
})

/** „Vrátiť späť" po odobratí – súbor loga stále je, stačí ho znova priradiť. */
settingsRouter.post('/logo/vratit', (req, res) => {
  const logo = String(req.body?.logo ?? '')
  if (!cestaLoga(logo)) return res.status(400).json({ chyba: 'Logo sa už nedá vrátiť – nahraj ho znova.' })
  db.prepare('UPDATE settings SET logo = ? WHERE id = 1').run(logo)
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
  for (const [pole, nazov] of [['cislo_vzor', 'faktúry'], ['cislo_vzor_zaloha', 'zálohovej faktúry']] as const) {
    const vzor = String(hodnoty[pole] ?? '')
    if (vzor && !vzorJePlatny(vzor)) {
      return res.status(400).json({ chyba: `Vzor čísla ${nazov} musí obsahovať poradie, napr. {NNNN}.` })
    }
  }

  if (b.splatnost_dni === undefined) {
    hodnoty.splatnost_dni = teraz.splatnost_dni
  } else {
    const dni = Number(b.splatnost_dni)
    hodnoty.splatnost_dni = Number.isFinite(dni) && dni >= 0 && dni <= 365 ? Math.round(dni) : 14
  }

  // Rezerva na dane a odvody v percentách z prijatých platieb (0 = vypnutá).
  if (b.rezerva_percento === undefined) {
    hodnoty.rezerva_percento = teraz.rezerva_percento
  } else {
    const p = Number(String(b.rezerva_percento).replace(',', '.'))
    hodnoty.rezerva_percento = Number.isFinite(p) && p >= 0 && p <= 60 ? Math.round(p * 10) / 10 : 0
  }

  // Predvolená sadzba DPH na nové položky faktúry (len pre platiteľa).
  const sadzba = b.dph_sadzba === undefined ? teraz.dph_sadzba : Number(b.dph_sadzba)
  hodnoty.dph_sadzba = jeSadzbaDph(sadzba) ? Number(sadzba) : 23

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

  const set = [...POLIA, 'splatnost_dni', 'rezerva_percento', 'dph_sadzba', ...PREPINACE, ...Object.keys(VOLBY), 'farba_faktury']
    .map((p) => `${p} = @${p}`)
    .join(', ')
  db.prepare(`UPDATE settings SET ${set} WHERE id = 1`).run(hodnoty)
  res.json(aktualne())
})
