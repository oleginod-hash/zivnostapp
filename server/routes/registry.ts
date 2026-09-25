import { Router } from 'express'

export const registryRouter = Router()

/**
 * Vyhľadanie slovenskej firmy podľa IČO cez verejný register RPO
 * (Register právnických osôb, data.gov.sk). Nepotrebuje kľúč ani registráciu.
 *
 * Ak služba nebeží alebo firma nie je slovenská, používateľ údaje vyplní ručne –
 * appka funguje aj bez toho.
 */
const RPO = 'https://api.statistics.sk/rpo/v1/search?identifier='

type Najdena = {
  nazov: string
  adresa: string
  psc_mesto: string
  krajina: string
  ico: string
  /** Zápis v obchodnom registri – ide do poznámky pri firme. */
  poznamka: string
  /** Čo register neposkytuje, aby to appka vedela používateľovi povedať. */
  chyba_v_registri: string[]
  /**
   * Zápis po zložkách – sprievodca prvým spustením z neho pri živnostníkovi
   * vyplní úrad a číslo živnostenského registra, ktoré sa tlačia na faktúru.
   */
  register: string
  urad: string
  cislo_registra: string
  vznik: string
}

registryRouter.get('/ico/:ico', async (req, res) => {
  const ico = String(req.params.ico).replace(/\s/g, '')
  if (!/^\d{6,8}$/.test(ico)) {
    return res.status(400).json({ chyba: 'IČO má mať 6 až 8 číslic.' })
  }

  try {
    const odpoved = await fetch(RPO + ico, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    })
    if (!odpoved.ok) throw new Error(`Register odpovedal ${odpoved.status}.`)

    const data = (await odpoved.json()) as any
    const zaznam = data?.results?.[0]
    if (!zaznam) return res.status(404).json({ chyba: `IČO ${ico} sa v registri nenašlo.` })

    // Register vracia aj historické názvy a adresy – zaujíma nás len ten platný,
    // teda bez dátumu ukončenia platnosti (alebo posledný v poradí).
    const platny = (pole: any[]) =>
      pole?.filter((x) => !x?.validTo).slice(-1)[0] ?? pole?.slice(-1)[0] ?? {}

    const meno = platny(zaznam.fullNames)?.value ?? zaznam.name ?? ''
    const a = platny(zaznam.addresses)
    const ulica = [a.street, a.buildingNumber || (a.regNumber ? String(a.regNumber) : '')]
      .filter(Boolean)
      .join(' ')

    // Zápis v obchodnom registri (súd + značka) – užitočné mať pri firme v poznámke.
    const sr = zaznam.sourceRegister ?? {}
    const sud = platny(sr.registrationOffices)?.value ?? ''
    const znacka = platny(sr.registrationNumbers)?.value ?? ''
    const zapis = [sr.value?.value, sud, znacka].filter(Boolean).join(', ')

    const najdena: Najdena = {
      nazov: meno,
      adresa: ulica,
      psc_mesto: [a.postalCodes?.[0], a.municipality?.value].filter(Boolean).join(' '),
      krajina: a.country?.value ?? 'Slovensko',
      ico,
      poznamka: [zapis, zaznam.establishment ? `vznik ${zaznam.establishment}` : '']
        .filter(Boolean)
        .join(' · '),
      // Register právnických osôb tieto údaje neobsahuje – sú buď kontaktné,
      // alebo ich spravuje finančná správa. Treba ich doplniť ručne.
      chyba_v_registri: ['DIČ', 'IČ DPH', 'e-mail', 'telefón'],
      register: sr.value?.value ?? '',
      urad: sud,
      cislo_registra: znacka,
      vznik: zaznam.establishment ?? '',
    }

    if (!najdena.nazov) return res.status(404).json({ chyba: 'Register nevrátil názov firmy.' })
    res.json(najdena)
  } catch (e: any) {
    const jeTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    res.status(502).json({
      chyba: jeTimeout
        ? 'Register neodpovedal včas. Skús to znova alebo vyplň údaje ručne.'
        : `Register sa nepodarilo osloviť: ${e.message}`,
    })
  }
})
