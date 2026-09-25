/**
 * Zmenšenie fotky pred odoslaním asistentovi.
 *
 * Fotka z mobilu má bežne 4000 px a viac a niekoľko MB. Asistentovi (Claude API)
 * stačí 2000 px na dlhšej strane: väčšie obrázky by API aj tak zmenšilo a pri
 * konverzácii s viac ako 20 obrázkami dokonca odmietlo. Takto sa fotka vždy
 * zmestí do limitu, rýchlejšie sa nahrá a bloček je stále dobre čitateľný.
 */
const MAX_STRANA = 2000
/** Menšie fotky, ktoré už majú rozumné rozmery, necháme tak, ako sú. */
const MAX_VELKOST_BEZ_ZMENY = 3 * 1024 * 1024
const KVALITA_JPEG = 0.85

export async function zmensiFotku(subor: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(subor.type)) return subor

  let obrazok: ImageBitmap
  try {
    // Otočenie podľa údajov z fotoaparátu (EXIF) – inak by fotka na výšku ležala.
    obrazok = await createImageBitmap(subor, { imageOrientation: 'from-image' })
  } catch {
    return subor // formát, ktorý prehliadač nevie otvoriť – pošleme originál
  }

  const pomer = Math.min(1, MAX_STRANA / Math.max(obrazok.width, obrazok.height))
  if (pomer === 1 && subor.size <= MAX_VELKOST_BEZ_ZMENY) {
    obrazok.close()
    return subor
  }

  const sirka = Math.max(1, Math.round(obrazok.width * pomer))
  const vyska = Math.max(1, Math.round(obrazok.height * pomer))
  const platno = document.createElement('canvas')
  platno.width = sirka
  platno.height = vyska
  const kreslenie = platno.getContext('2d')
  if (!kreslenie) {
    obrazok.close()
    return subor
  }
  // Priehľadné miesta (PNG) by v JPEG-u boli čierne.
  kreslenie.fillStyle = '#fff'
  kreslenie.fillRect(0, 0, sirka, vyska)
  kreslenie.drawImage(obrazok, 0, 0, sirka, vyska)
  obrazok.close()

  const jpeg = await new Promise<Blob | null>((hotovo) => platno.toBlob(hotovo, 'image/jpeg', KVALITA_JPEG))
  // Zmenšenú fotku pošleme vždy; pri fotke len veľkej v MB, ak je JPEG naozaj menší.
  if (!jpeg || (pomer === 1 && jpeg.size >= subor.size)) return subor
  return new File([jpeg], subor.name.replace(/\.(jpe?g|png|webp)$/i, '') + '.jpg', { type: 'image/jpeg' })
}
