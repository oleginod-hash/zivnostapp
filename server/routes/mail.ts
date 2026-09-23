import { Router } from 'express'
import { db } from '../db.js'
import { fakturaPdfPodlaId } from '../lib/invoicePdf.js'
import { mailNastaveny, mailOdosielatel, overSpojenie, posliMail, textFaktury, textUpomienky } from '../lib/mail.js'
import { OTVORENY_ZOSTATOK_SQL, UHRADENE_SQL } from '../lib/platby.js'

export const mailRouter = Router()

type Jazyk = 'sk' | 'en' | 'de'
const jazyk = (x: unknown): Jazyk => (x === 'en' || x === 'de' ? x : 'sk')

mailRouter.get('/stav', (_req, res) => {
  res.json({ nastavene: mailNastaveny(), odosielatel: mailOdosielatel() })
})

mailRouter.post('/test', async (_req, res) => {
  try {
    await overSpojenie()
    res.json({ ok: true, sprava: 'Spojenie s poštovým serverom funguje.' })
  } catch (e: any) {
    res.status(400).json({ chyba: e.message })
  }
})

/** Náhľad textu – používateľ ho môže pred odoslaním upraviť. */
mailRouter.get('/navrh/:id', (req, res) => {
  const typ = String(req.query.typ ?? 'faktura')
  try {
    const navrh =
      typ === 'upomienka'
        ? textUpomienky(Number(req.params.id), jazyk(req.query.jazyk))
        : textFaktury(Number(req.params.id), jazyk(req.query.jazyk))
    res.json(navrh)
  } catch (e: any) {
    res.status(404).json({ chyba: e.message })
  }
})

/** Odoslanie faktúry alebo upomienky. Faktúra ide vždy aj ako PDF príloha. */
mailRouter.post('/odoslat/:id', async (req, res) => {
  const id = Number(req.params.id)
  const komu = String(req.body?.komu ?? '').trim()
  const predmet = String(req.body?.predmet ?? '').trim()
  const text = String(req.body?.text ?? '').trim()

  if (!komu) return res.status(400).json({ chyba: 'Chýba e-mail príjemcu.' })
  if (!predmet || !text) return res.status(400).json({ chyba: 'Chýba predmet alebo text správy.' })

  const f = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any
  if (!f) return res.status(404).json({ chyba: 'Faktúra neexistuje.' })

  try {
    // Rovnaké PDF ako pri stiahnutí – nech klient dostane presne to, čo vidím ja.
    const v = await fakturaPdfPodlaId(id)
    if (!v) return res.status(404).json({ chyba: 'Faktúra neexistuje.' })

    await posliMail({ komu, predmet, text, prilohy: [{ filename: v.nazov, content: v.pdf }] })

    // Poznačíme si, kedy a komu sme faktúru poslali. Mail už odišiel – keby
    // zlyhal len tento zápis, nesmie to vyzerať ako neodoslaný mail (hrozilo
    // by, že ho človek pošle znova).
    try {
      const znacka = `[${new Date().toLocaleDateString('sk-SK')} odoslané na ${komu}]`
      db.prepare("UPDATE invoices SET poznamka = TRIM(COALESCE(poznamka, '') || ' ' || ?) WHERE id = ?")
        .run(znacka, id)
    } catch (e) {
      console.error('[mail] poznámku o odoslaní sa nepodarilo zapísať:', e)
    }

    res.json({ ok: true, sprava: `Odoslané na ${komu}.` })
  } catch (e: any) {
    console.error('[mail]', e)
    res.status(500).json({ chyba: e.message || 'Odoslanie zlyhalo.' })
  }
})

/** Faktúry po splatnosti – podklad pre upomienky. */
mailRouter.get('/po-splatnosti', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT i.id, i.cislo, i.suma, i.datum_splat, c.nazov AS firma_nazov, c.email AS firma_email,
                CAST(julianday(dnes()) - julianday(i.datum_splat) AS INTEGER) AS dni_po_splatnosti,
                ${OTVORENY_ZOSTATOK_SQL}
         FROM invoices i LEFT JOIN companies c ON c.id = i.company_id
         WHERE i.stav <> 'koncept'
           AND i.datum_splat < dnes()
           AND ${UHRADENE_SQL} < i.suma - 0.005
           -- Zálohovú faktúru kryjúcu starý dlh neupomíname zvlášť: ten istý
           -- dlh je už v otvorenom zostatku pôvodnej faktúry.
           AND i.kryje_id IS NULL
         ORDER BY i.datum_splat`,
      )
      .all(),
  )
})
