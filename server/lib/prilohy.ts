import { Router } from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { db, FILES_DIR } from '../db.js'

const POVOLENE = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.doc', '.docx', '.odt', '.txt']

export type NastaveniePriloh = {
  /** Tabuľka so súbormi, napr. contract_files. */
  tabulka: string
  /** Stĺpec odkazujúci na rodičovský záznam, napr. contract_id. */
  cudziKluc: string
  /** Tabuľka rodiča, kvôli kontrole existencie. */
  rodic: string
  /** Podpriečinok v DATA_DIR/files, napr. "zmluvy". */
  priecinok: string
}

/**
 * Prílohy fungujú rovnako pri zmluvách aj výdavkoch, takže logika žije na jednom
 * mieste a jednotlivé moduly si vypýtajú router pre svoju tabuľku.
 */
export function prilohyModul(n: NastaveniePriloh) {
  const adresar = path.join(FILES_DIR, n.priecinok)
  fs.mkdirSync(adresar, { recursive: true })

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, adresar),
      filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
    }),
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, cb) => {
      const pripona = path.extname(file.originalname).toLowerCase()
      if (!POVOLENE.includes(pripona)) {
        return cb(new Error(`Nepodporovaný typ súboru (${pripona}). Povolené: ${POVOLENE.join(', ')}`))
      }
      cb(null, true)
    },
  })

  function zoznam(rodicId: number | string) {
    return db
      .prepare(
        `SELECT id, nazov, velkost, mime, created_at FROM ${n.tabulka} WHERE ${n.cudziKluc} = ? ORDER BY id`,
      )
      .all(rodicId)
  }

  /** Zmaže súbory na disku patriace rodičovi. Riadky v DB odstráni kaskáda. */
  function zmazSuboryRodica(rodicId: number | string) {
    const subory = db
      .prepare(`SELECT ulozeny_nazov FROM ${n.tabulka} WHERE ${n.cudziKluc} = ?`)
      .all(rodicId) as { ulozeny_nazov: string }[]
    for (const s of subory) {
      try {
        fs.unlinkSync(path.join(adresar, s.ulozeny_nazov))
      } catch {
        /* súbor už neexistuje – nevadí */
      }
    }
  }

  const router = Router()

  router.post('/:id/subory', upload.array('subory', 10), (req, res) => {
    const rodic = db.prepare(`SELECT id FROM ${n.rodic} WHERE id = ?`).get(req.params.id)
    if (!rodic) return res.status(404).json({ chyba: 'Záznam neexistuje.' })

    const stmt = db.prepare(
      `INSERT INTO ${n.tabulka} (${n.cudziKluc}, nazov, ulozeny_nazov, velkost, mime) VALUES (?, ?, ?, ?, ?)`,
    )
    for (const f of (req.files as Express.Multer.File[]) ?? []) {
      // Pôvodný názov prichádza ako latin1, inak sa diakritika rozsype.
      const nazov = Buffer.from(f.originalname, 'latin1').toString('utf8')
      stmt.run(req.params.id, nazov, f.filename, f.size, f.mimetype)
    }
    res.json({ prilohy: zoznam(req.params.id) })
  })

  router.get('/subory/:fileId', (req, res) => {
    const f = db.prepare(`SELECT * FROM ${n.tabulka} WHERE id = ?`).get(req.params.fileId) as any
    if (!f) return res.status(404).json({ chyba: 'Súbor neexistuje.' })
    const cesta = path.join(adresar, f.ulozeny_nazov)
    if (!fs.existsSync(cesta)) return res.status(404).json({ chyba: 'Súbor sa nenašiel na disku.' })

    res.setHeader('Content-Type', f.mime || 'application/octet-stream')
    res.setHeader(
      'Content-Disposition',
      `${req.query.stiahnut === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.nazov)}`,
    )
    fs.createReadStream(cesta).pipe(res)
  })

  router.delete('/subory/:fileId', (req, res) => {
    const f = db.prepare(`SELECT * FROM ${n.tabulka} WHERE id = ?`).get(req.params.fileId) as any
    if (!f) return res.status(404).json({ chyba: 'Súbor neexistuje.' })
    db.prepare(`DELETE FROM ${n.tabulka} WHERE id = ?`).run(req.params.fileId)
    try {
      fs.unlinkSync(path.join(adresar, f.ulozeny_nazov))
    } catch {
      /* už zmazaný */
    }
    res.json({ ok: true })
  })

  return { router, zoznam, zmazSuboryRodica }
}
