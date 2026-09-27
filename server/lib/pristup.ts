import { spawn } from 'node:child_process'
import fs from 'node:fs'

/**
 * Prístup z telefónu cez Tailscale.
 *
 * Tailscale spojí počítač a telefón do súkromnej šifrovanej siete, do ktorej
 * patria len zariadenia prihlásené do toho istého účtu. Príkaz `tailscale serve`
 * potom appku sprístupní na adrese https://<počítač>.<sieť>.ts.net – ale len
 * v tejto sieti. Server sám ďalej počúva iba na localhoste, Tailscale mu
 * požiadavky z telefónu len podáva.
 *
 * Z internetu sa k appke nedostane nikto. To by robil `tailscale funnel`,
 * ktorý appka nikdy nezapína – a keď ho zistí, prístup cez Tailscale zablokuje.
 */

export type StavPristupu = {
  /** Či je Tailscale v počítači a či je prihlásený. */
  tailscale: 'nenainstalovany' | 'neprihlaseny' | 'bezi'
  /** Meno počítača v sieti Tailscale, napr. pc.tail1234.ts.net. */
  meno: string | null
  /** Adresa appky pre telefón, keď je prístup zapnutý. */
  adresa: string | null
  /** `tailscale serve` smeruje na túto appku. */
  zapnute: boolean
  /** Na adrese Tailscale už beží niečo iné – appka to neprepíše. */
  obsadene: boolean
  /** Appka je vystavená na internet cez Tailscale Funnel. */
  verejne: boolean
  /** Odkaz, ktorým sa neprihlásený počítač prihlási do Tailscale (dáva ho sám Tailscale). */
  prihlasenie: string | null
}

type Vysledok = { kod: number; vystup: string }
/** Spustí príkaz tailscale; `hotovo` môže skončiť skôr, keď vo výstupe nájde, čo treba. */
export type Spustac = (args: string[], hotovo?: (vystup: string) => boolean) => Promise<Vysledok>

const NEZISTENE: StavPristupu = {
  tailscale: 'nenainstalovany', meno: null, adresa: null, zapnute: false, obsadene: false, verejne: false, prihlasenie: null,
}

function cestaKTailscale(): string {
  const kandidati =
    process.platform === 'win32'
      ? ['C:\\Program Files\\Tailscale\\tailscale.exe', 'C:\\Program Files (x86)\\Tailscale\\tailscale.exe']
      : process.platform === 'darwin'
        ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale']
        : []
  return kandidati.find((k) => fs.existsSync(k)) ?? 'tailscale'
}

const skutocnySpustac: Spustac = (args, hotovo) =>
  new Promise((resolve) => {
    let vystup = ''
    let skoncene = false
    const koniec = (kod: number) => {
      if (skoncene) return
      skoncene = true
      clearTimeout(casovac)
      resolve({ kod, vystup })
    }
    let proces: ReturnType<typeof spawn>
    try {
      proces = spawn(cestaKTailscale(), args, { windowsHide: true })
    } catch {
      return resolve({ kod: -1, vystup: '' })
    }
    // `tailscale serve` pri prvom zapnutí čaká, kým sa HTTPS povolí na webe –
    // odkaz si zoberieme hneď a príkaz ukončíme, nech appka nevisí.
    const casovac = setTimeout(() => {
      proces.kill()
      koniec(-2)
    }, 20000)
    const pridaj = (d: Buffer) => {
      vystup += d.toString()
      if (hotovo?.(vystup)) {
        proces.kill()
        koniec(0)
      }
    }
    proces.stdout?.on('data', pridaj)
    proces.stderr?.on('data', pridaj)
    proces.on('error', () => koniec(-1))
    proces.on('close', (kod) => koniec(kod ?? 0))
  })

let spustac: Spustac = skutocnySpustac
let stav: StavPristupu = NEZISTENE
let posledneZistenie = 0
let prebieha: Promise<StavPristupu> | null = null

/** Len pre testy: namiesto skutočného Tailscale použije vymyslený. */
export function nahradSpustac(novy: Spustac | null) {
  spustac = novy ?? skutocnySpustac
  posledneZistenie = 0
  stav = NEZISTENE
}

const vypnuteVTeste = () => process.env.TAILSCALE === 'vypnute'

/** Stav z `tailscale status --json`. */
export function citajStatus(json: string): Pick<StavPristupu, 'tailscale' | 'meno' | 'prihlasenie'> {
  try {
    const s = JSON.parse(json)
    if (s?.BackendState !== 'Running') {
      // Nainštalovaný, ale neprihlásený počítač má od Tailscale pripravený odkaz na prihlásenie.
      const odkaz = String(s?.AuthURL ?? '')
      return { tailscale: 'neprihlaseny', meno: null, prihlasenie: /^https:\/\/login\.tailscale\.com\//.test(odkaz) ? odkaz : null }
    }
    const meno = String(s?.Self?.DNSName ?? '').replace(/\.$/, '').toLowerCase()
    return { tailscale: 'bezi', meno: meno || null, prihlasenie: null }
  } catch {
    return { tailscale: 'neprihlaseny', meno: null, prihlasenie: null }
  }
}

/** Z `tailscale serve status --json`: či adresa smeruje na túto appku. */
export function citajServe(json: string, meno: string | null, port: number) {
  let konf: any = {}
  try {
    konf = JSON.parse(json || '{}') ?? {}
  } catch {
    konf = {}
  }
  const naAppku = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}/?$`)
  let adresa: string | null = null
  let obsadene = false
  let verejne = false
  for (const [hostPort, web] of Object.entries<any>(konf.Web ?? {})) {
    const [host, portWebu] = hostPort.split(':')
    if (!meno || host.toLowerCase() !== meno) continue
    const ciel = String(web?.Handlers?.['/']?.Proxy ?? '')
    if (naAppku.test(ciel)) {
      adresa = `https://${meno}${portWebu && portWebu !== '443' ? ':' + portWebu : ''}`
      if (konf.AllowFunnel?.[hostPort]) verejne = true
    } else if (portWebu === '443' && ciel) {
      obsadene = true
    }
  }
  return { adresa, zapnute: !!adresa, obsadene: !adresa && obsadene, verejne }
}

/** Zistí stav Tailscale. Viac volaní naraz zdieľa jedno zisťovanie. */
export function zistiStav(port: number, najStarsieMs = 5000): Promise<StavPristupu> {
  if (vypnuteVTeste() && spustac === skutocnySpustac) return Promise.resolve(NEZISTENE)
  if (prebieha) return prebieha
  if (Date.now() - posledneZistenie < najStarsieMs) return Promise.resolve(stav)
  prebieha = (async () => {
    const st = await spustac(['status', '--json'])
    if (st.kod === -1) return NEZISTENE
    const zakladny = citajStatus(st.vystup)
    if (zakladny.tailscale !== 'bezi') return { ...NEZISTENE, ...zakladny }
    const sv = await spustac(['serve', 'status', '--json'])
    return { ...NEZISTENE, ...zakladny, ...citajServe(sv.vystup, zakladny.meno, port) }
  })()
    .then((s) => {
      stav = s
      return s
    })
    .catch(() => stav)
    .finally(() => {
      posledneZistenie = Date.now()
      prebieha = null
    })
  return prebieha
}

export const poslednyStav = () => stav

const ODKAZ_NA_POVOLENIE = /https:\/\/login\.tailscale\.com\/\S+/

/**
 * Zapne `tailscale serve` na appku. Keď v sieti ešte nie je povolené HTTPS,
 * Tailscale vráti odkaz, na ktorom ho používateľ jedným klikom povolí.
 */
export async function zapniPristup(port: number): Promise<{ ok: boolean; povolit?: string; chyba?: string }> {
  const teraz = await zistiStav(port, 0)
  if (teraz.tailscale !== 'bezi') return { ok: false, chyba: 'Tailscale v počítači nebeží alebo nie je prihlásený.' }
  if (teraz.zapnute) return { ok: true }
  if (teraz.obsadene) {
    return { ok: false, chyba: 'Na adrese tohto počítača v Tailscale už beží iná služba. Appka ju neprepíše.' }
  }
  const r = await spustac(['serve', '--bg', `http://127.0.0.1:${port}`], (v) => ODKAZ_NA_POVOLENIE.test(v))
  const odkaz = r.vystup.match(ODKAZ_NA_POVOLENIE)?.[0]
  const po = await zistiStav(port, 0)
  if (po.zapnute) return { ok: true }
  if (odkaz) return { ok: false, povolit: odkaz }
  return { ok: false, chyba: 'Tailscale prístup nezapol. ' + r.vystup.trim().slice(0, 300) }
}

export async function vypniPristup(port: number): Promise<{ ok: boolean; chyba?: string }> {
  const teraz = await zistiStav(port, 0)
  if (!teraz.zapnute) return { ok: true }
  const portWebu = teraz.adresa?.match(/:(\d+)$/)?.[1] ?? '443'
  await spustac(['serve', `--https=${portWebu}`, 'off'])
  const po = await zistiStav(port, 0)
  return po.zapnute ? { ok: false, chyba: 'Prístup sa nepodarilo vypnúť.' } : { ok: true }
}

/** Adresy, ktoré smú byť v hlavičke Host a Origin okrem localhostu. */
export function dalsieAdresy(): string[] {
  const zEnv = String(process.env.DALSIE_ADRESY ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
  // Cez Funnel by na adresu mohol ktokoľvek z internetu – vtedy ju nepustíme.
  const zTailscale = stav.meno && !stav.verejne ? [stav.meno] : []
  return [...zEnv, ...zTailscale]
}
