/**
 * Malé čítanie XML – stačí na e-faktúry (UBL, CII). Nevaliduje, nepozná DTD
 * a menné priestory zahodí: z `cbc:IssueDate` ostane `IssueDate`. Vlastné
 * namiesto knižnice, aby appka po aktualizácii nepotrebovala nové balíčky.
 */
export type Prvok = { nazov: string; atributy: Record<string, string>; deti: Prvok[]; text: string }

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function dekoduj(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (cele, e: string) => {
    if (e[0] === '#') {
      const kod = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(kod) ? String.fromCodePoint(kod) : cele
    }
    return ENTITY[e.toLowerCase()] ?? cele
  })
}

const bezPredpony = (nazov: string) => nazov.slice(nazov.indexOf(':') + 1)

export function citajXml(xml: string): Prvok {
  const koren: Prvok = { nazov: '#dokument', atributy: {}, deti: [], text: '' }
  const zasobnik: Prvok[] = [koren]
  let i = 0
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    const text = xml.slice(i, lt === -1 ? xml.length : lt)
    if (text.trim()) zasobnik[zasobnik.length - 1].text += dekoduj(text)
    if (lt === -1) break

    if (xml.startsWith('<!--', lt)) {
      i = xml.indexOf('-->', lt) + 3
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const koniec = xml.indexOf(']]>', lt)
      zasobnik[zasobnik.length - 1].text += xml.slice(lt + 9, koniec)
      i = koniec + 3
    } else if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      i = xml.indexOf('>', lt) + 1
    } else if (xml[lt + 1] === '/') {
      i = xml.indexOf('>', lt) + 1
      if (zasobnik.length > 1) zasobnik.pop()
    } else {
      const koniec = xml.indexOf('>', lt)
      if (koniec === -1) throw new Error('Neúplné XML.')
      const obsah = xml.slice(lt + 1, koniec)
      const samostatny = obsah.endsWith('/')
      const telo = samostatny ? obsah.slice(0, -1) : obsah
      const nazov = telo.match(/^[^\s/>]+/)?.[0] ?? ''
      const atributy: Record<string, string> = {}
      for (const a of telo.slice(nazov.length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
        atributy[bezPredpony(a[1])] = dekoduj(a[3] ?? a[4] ?? '')
      }
      const prvok: Prvok = { nazov: bezPredpony(nazov), atributy, deti: [], text: '' }
      zasobnik[zasobnik.length - 1].deti.push(prvok)
      if (!samostatny) zasobnik.push(prvok)
      i = koniec + 1
    }
    if (i <= 0) break
  }
  const prvy = koren.deti[0]
  if (!prvy) throw new Error('Súbor nie je XML.')
  return prvy
}

/** Prvý potomok po ceste mien, napr. dieta(p, 'Party', 'PartyName', 'Name'). */
export function dieta(p: Prvok | undefined, ...cesta: string[]): Prvok | undefined {
  let teraz = p
  for (const nazov of cesta) {
    teraz = teraz?.deti.find((d) => d.nazov === nazov)
    if (!teraz) return undefined
  }
  return teraz
}

export function deti(p: Prvok | undefined, nazov: string): Prvok[] {
  return p?.deti.filter((d) => d.nazov === nazov) ?? []
}

/** Text prvku po ceste, orezaný; prázdny, keď prvok chýba. */
export function text(p: Prvok | undefined, ...cesta: string[]): string {
  return (dieta(p, ...cesta)?.text ?? '').trim()
}
