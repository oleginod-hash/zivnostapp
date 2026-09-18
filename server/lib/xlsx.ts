import { deflateRawSync } from 'node:zlib'

/**
 * Malý zapisovač zošitov .xlsx.
 *
 * Appka má byť bez zbytočných závislostí, a na to, čo potrebujeme – niekoľko
 * hárkov s textom, sumami a dátumami – stačí pár desiatok riadkov. Zošit je
 * ZIP s XML súbormi, takže si ho poskladáme sami. Texty píšeme ako „inline
 * strings", aby sme nemuseli viesť tabuľku zdieľaných reťazcov.
 */

export type Bunka =
  | string
  | number
  | null
  | { t: 'nadpis'; v: string }
  | { t: 'hlavicka'; v: string }
  | { t: 'tucne'; v: string }
  | { t: 'eur'; v: number }
  | { t: 'eurTucne'; v: number }
  | { t: 'datum'; v: string | null }

export type Harok = {
  nazov: string
  /** Šírky stĺpcov v znakoch. */
  sirky?: number[]
  riadky: Bunka[][]
}

// Poradie musí sedieť s cellXfs v styles.xml nižšie.
const STYL = { bezny: 0, nadpis: 1, hlavicka: 2, eur: 3, eurTucne: 4, datum: 5, tucne: 6 }

export const eur = (v: number): Bunka => ({ t: 'eur', v: v ?? 0 })
export const eurTucne = (v: number): Bunka => ({ t: 'eurTucne', v: v ?? 0 })
export const datum = (v: string | null | undefined): Bunka => ({ t: 'datum', v: v ?? null })
export const tucne = (v: string): Bunka => ({ t: 'tucne', v })
export const nadpis = (v: string): Bunka => ({ t: 'nadpis', v })
export const hlavicka = (v: string): Bunka => ({ t: 'hlavicka', v })

function xml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Excel neprijme riadiace znaky v XML – v poznámkach sa občas objavia.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

/** Excel počíta dni od 30. 12. 1899. */
function serialDatumu(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const dni = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000
  return dni + 25569
}

function stlpec(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; ) {
    const zvysok = (n - 1) % 26
    s = String.fromCharCode(65 + zvysok) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function bunkaXml(b: Bunka, adresa: string): string {
  if (b === null || b === undefined || b === '') return ''
  if (typeof b === 'number') {
    return Number.isFinite(b) ? `<c r="${adresa}"><v>${b}</v></c>` : ''
  }
  if (typeof b === 'string') {
    return `<c r="${adresa}" t="inlineStr"><is><t xml:space="preserve">${xml(b)}</t></is></c>`
  }
  if (b.t === 'eur' || b.t === 'eurTucne') {
    const s = b.t === 'eur' ? STYL.eur : STYL.eurTucne
    const hodnota = Math.round((Number(b.v) || 0) * 100) / 100
    return `<c r="${adresa}" s="${s}"><v>${hodnota}</v></c>`
  }
  if (b.t === 'datum') {
    const serial = b.v ? serialDatumu(b.v) : null
    return serial === null ? '' : `<c r="${adresa}" s="${STYL.datum}"><v>${serial}</v></c>`
  }
  const s = b.t === 'nadpis' ? STYL.nadpis : b.t === 'hlavicka' ? STYL.hlavicka : STYL.tucne
  return `<c r="${adresa}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(b.v)}</t></is></c>`
}

function harokXml(h: Harok): string {
  const stlpce = h.sirky?.length
    ? `<cols>${h.sirky
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : ''

  const riadky = h.riadky
    .map((r, ri) => {
      const bunky = r.map((b, ci) => bunkaXml(b, stlpec(ci) + (ri + 1))).join('')
      return bunky ? `<row r="${ri + 1}">${bunky}</row>` : `<row r="${ri + 1}"/>`
    })
    .join('')

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    stlpce +
    `<sheetData>${riadky}</sheetData></worksheet>`
  )
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2">' +
  '<numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/>' +
  '<numFmt numFmtId="165" formatCode="dd\\.mm\\.yyyy"/>' +
  '</numFmts>' +
  '<fonts count="3">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFA0A0A0"/></bottom><diagonal/></border>' +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="7">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

/** Excel neprijme v názve hárka [ ] : * ? / \ a viac než 31 znakov. */
function nazovHarka(nazov: string, pouzite: Set<string>): string {
  let n = nazov.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hárok'
  let i = 2
  while (pouzite.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i++}`
  pouzite.add(n.toLowerCase())
  return n
}

// ── ZIP ────────────────────────────────────────────────────────
const TABULKA_CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = TABULKA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

type Zaznam = { nazov: string; data: Buffer }

function zip(subory: Zaznam[]): Buffer {
  const lokalne: Buffer[] = []
  const centralne: Buffer[] = []
  let posun = 0

  for (const s of subory) {
    const meno = Buffer.from(s.nazov, 'utf8')
    const stlacene = deflateRawSync(s.data, { level: 9 })
    const kontrola = crc32(s.data)

    const hlavicka = Buffer.alloc(30)
    hlavicka.writeUInt32LE(0x04034b50, 0)
    hlavicka.writeUInt16LE(20, 4) // potrebná verzia
    hlavicka.writeUInt16LE(0x0800, 6) // názvy v UTF-8
    hlavicka.writeUInt16LE(8, 8) // deflate
    hlavicka.writeUInt16LE(0, 10) // čas
    hlavicka.writeUInt16LE(0x2821, 12) // dátum (1. 1. 2000)
    hlavicka.writeUInt32LE(kontrola, 14)
    hlavicka.writeUInt32LE(stlacene.length, 18)
    hlavicka.writeUInt32LE(s.data.length, 22)
    hlavicka.writeUInt16LE(meno.length, 26)
    hlavicka.writeUInt16LE(0, 28)
    lokalne.push(hlavicka, meno, stlacene)

    const zaznam = Buffer.alloc(46)
    zaznam.writeUInt32LE(0x02014b50, 0)
    zaznam.writeUInt16LE(20, 4)
    zaznam.writeUInt16LE(20, 6)
    zaznam.writeUInt16LE(0x0800, 8)
    zaznam.writeUInt16LE(8, 10)
    zaznam.writeUInt16LE(0, 12)
    zaznam.writeUInt16LE(0x2821, 14)
    zaznam.writeUInt32LE(kontrola, 16)
    zaznam.writeUInt32LE(stlacene.length, 20)
    zaznam.writeUInt32LE(s.data.length, 24)
    zaznam.writeUInt16LE(meno.length, 28)
    zaznam.writeUInt32LE(posun, 42)
    centralne.push(zaznam, meno)

    posun += hlavicka.length + meno.length + stlacene.length
  }

  const telo = Buffer.concat(lokalne)
  const adresar = Buffer.concat(centralne)
  const koniec = Buffer.alloc(22)
  koniec.writeUInt32LE(0x06054b50, 0)
  koniec.writeUInt16LE(subory.length, 8)
  koniec.writeUInt16LE(subory.length, 10)
  koniec.writeUInt32LE(adresar.length, 12)
  koniec.writeUInt32LE(telo.length, 16)

  return Buffer.concat([telo, adresar, koniec])
}

// ── Zošit ──────────────────────────────────────────────────────
export function vytvorZosit(harky: Harok[]): Buffer {
  if (!harky.length) throw new Error('Zošit musí mať aspoň jeden hárok.')
  const pouzite = new Set<string>()
  const nazvy = harky.map((h) => nazovHarka(h.nazov, pouzite))

  const subory: Zaznam[] = [
    {
      nazov: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          harky
            .map(
              (_, i) =>
                `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join('') +
          '</Types>',
        'utf8',
      ),
    },
    {
      nazov: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
        'utf8',
      ),
    },
    {
      nazov: 'xl/workbook.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          nazvy
            .map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
            .join('') +
          '</sheets></workbook>',
        'utf8',
      ),
    },
    {
      nazov: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          harky
            .map(
              (_, i) =>
                `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
            )
            .join('') +
          `<Relationship Id="rId${harky.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          '</Relationships>',
        'utf8',
      ),
    },
    { nazov: 'xl/styles.xml', data: Buffer.from(STYLES_XML, 'utf8') },
    ...harky.map((h, i) => ({
      nazov: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(harokXml(h), 'utf8'),
    })),
  ]

  return zip(subory)
}
