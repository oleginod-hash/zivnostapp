import zlib from 'node:zlib'

/**
 * Text z Word dokumentu (.docx). Súbor .docx je ZIP a samotný text leží
 * v word/document.xml – stačí ho nájsť, rozbaliť a zahodiť XML značky.
 * Formátovanie, obrázky ani tabuľky ako tabuľky tu nezostanú; asistentovi
 * však stačí text, aby dokumentu rozumel.
 */
export function textZDocx(subor: Buffer): string {
  // Koniec centrálneho adresára ZIP-u je v posledných ~65 kB súboru.
  let koniec = -1
  for (let i = subor.length - 22; i >= Math.max(0, subor.length - 65557); i--) {
    if (subor.readUInt32LE(i) === 0x06054b50) {
      koniec = i
      break
    }
  }
  if (koniec < 0) throw new Error('Súbor nie je platný Word dokument (.docx).')

  const pocet = subor.readUInt16LE(koniec + 10)
  let p = subor.readUInt32LE(koniec + 16)
  for (let n = 0; n < pocet && subor.readUInt32LE(p) === 0x02014b50; n++) {
    const metoda = subor.readUInt16LE(p + 10)
    const velkost = subor.readUInt32LE(p + 20)
    const dlzkaMena = subor.readUInt16LE(p + 28)
    const dlzkaExtra = subor.readUInt16LE(p + 30)
    const dlzkaKomentara = subor.readUInt16LE(p + 32)
    const lokalnaHlavicka = subor.readUInt32LE(p + 42)
    const meno = subor.toString('utf8', p + 46, p + 46 + dlzkaMena)

    if (meno === 'word/document.xml') {
      const zaciatok =
        lokalnaHlavicka + 30 + subor.readUInt16LE(lokalnaHlavicka + 26) + subor.readUInt16LE(lokalnaHlavicka + 28)
      const data = subor.subarray(zaciatok, zaciatok + velkost)
      const xml = (metoda === 8 ? zlib.inflateRawSync(data) : data).toString('utf8')
      return xmlNaText(xml)
    }
    p += 46 + dlzkaMena + dlzkaExtra + dlzkaKomentara
  }
  throw new Error('V súbore .docx sa nenašiel text dokumentu.')
}

function xmlNaText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(br|cr)[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
