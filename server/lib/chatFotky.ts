import multer from 'multer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { db, FILES_DIR } from '../db.js'
import { textZDocx } from './docx.js'

/**
 * Fotky priložené do chatu (bločky, skeny zmlúv). Ležia na disku,
 * v databáze je len odkaz. Keď z fotky vznikne výdavok, súbor sa
 * skopíruje k nemu ako doklad – v chate teda nič nezostane visieť samo.
 */
export const CHAT_DIR = path.join(FILES_DIR, 'chat')
fs.mkdirSync(CHAT_DIR, { recursive: true })

const OBRAZKY = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
/** Claude číta obrázky aj PDF; z Wordu (.docx) a textových súborov pošleme text. */
const POVOLENE_MIME = [...OBRAZKY, 'application/pdf', 'text/plain', 'text/csv', DOCX]

/**
 * Prehliadač niekedy typ súboru nepozná (napr. .docx bez nainštalovaného
 * Office) – vtedy sa riadime príponou.
 */
const TYP_PODLA_PRIPONY: Record<string, string> = { '.docx': DOCX, '.txt': 'text/plain', '.csv': 'text/csv' }

export const uploadFotky = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CHAT_DIR),
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    const pripona = path.extname(file.originalname).toLowerCase()
    if (pripona === '.doc') {
      return cb(new Error('Starý formát Wordu (.doc) asistent neprečíta. Ulož ho vo Worde ako .docx alebo PDF.'))
    }
    if (!POVOLENE_MIME.includes(file.mimetype)) {
      if (!TYP_PODLA_PRIPONY[pripona]) {
        return cb(new Error('Priložiť sa dá fotka (JPG, PNG, WEBP, GIF), PDF, Word (.docx) alebo textový súbor.'))
      }
      file.mimetype = TYP_PODLA_PRIPONY[pripona]
    }
    cb(null, true)
  },
})

export function ulozFotku(f: Express.Multer.File): { id: number; nazov: string } {
  const nazov = Buffer.from(f.originalname, 'latin1').toString('utf8')
  const info = db
    .prepare('INSERT INTO chat_files (nazov, ulozeny_nazov, mime, velkost) VALUES (?, ?, ?, ?)')
    .run(nazov, f.filename, f.mimetype, f.size)
  return { id: Number(info.lastInsertRowid), nazov }
}

export type Fotka = { id: number; nazov: string; ulozeny_nazov: string; mime: string }

export function najdiFotku(id: number): Fotka | undefined {
  return db.prepare('SELECT id, nazov, ulozeny_nazov, mime FROM chat_files WHERE id = ?').get(id) as Fotka | undefined
}

export function cestaFotky(f: Fotka): string {
  return path.join(CHAT_DIR, f.ulozeny_nazov)
}

/**
 * Príloha pripravená pre Claude API. Obrázky idú ako image, PDF ako document,
 * textové súbory rovno ako text – tie by inak Claude neprečítal.
 */
export function fotkaPreClaude(f: Fotka): any {
  const obsah = fs.readFileSync(cestaFotky(f))

  if (OBRAZKY.includes(f.mime)) {
    // Claude API prijme obrázok najviac 10 MB v base64 (asi 7,5 MB súboru). Appka
    // fotky zmenšuje už v prehliadači; toto je poistka, aby celá odpoveď nezlyhala.
    if (obsah.length > 7.5 * 1024 * 1024) {
      return { type: 'text', text: `(Fotka ${f.nazov} je príliš veľká – nad 7,5 MB – a asistent ju neprečíta. Treba ju zmenšiť.)` }
    }
    return {
      type: 'image',
      source: { type: 'base64', media_type: f.mime, data: obsah.toString('base64') },
    }
  }

  if (f.mime === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: obsah.toString('base64') },
    }
  }

  // Textové prílohy vložíme priamo, orezané na rozumnú dĺžku. Word je zbalený
  // ZIP – ako text by z neho boli nečitateľné znaky, preto z neho text vytiahneme.
  let text: string
  try {
    text = (f.mime === DOCX || /\.docx$/i.test(f.nazov) ? textZDocx(obsah) : obsah.toString('utf8')).slice(0, 100_000)
  } catch (e: any) {
    text = `(Súbor sa nepodarilo prečítať: ${e.message})`
  }
  return { type: 'text', text: `--- Obsah súboru ${f.nazov} ---
${text}` }
}
