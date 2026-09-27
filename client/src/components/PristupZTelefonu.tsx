import { useEffect, useState, type ReactNode } from 'react'
import { api, type StavPristupu } from '../api'
import { Ikona } from './Ikony'
import { oznam, potvrd } from './Oznamenia'

/** Stav prístupu z telefónu – `null`, kým sa nezistí. */
export function usePristup(): [StavPristupu | null, (s: StavPristupu) => void, () => Promise<void>] {
  const [stav, setStav] = useState<StavPristupu | null>(null)
  const nacitaj = () => api.get<StavPristupu>('/pristup').then(setStav).catch(() => {})
  useEffect(() => {
    nacitaj()
  }, [])
  return [stav, setStav, nacitaj]
}

/** QR kód s adresou appky pre telefón, voliteľne rovno na konkrétnu stránku. */
export function QrKod({ cesta = '/', velkost = 184 }: { cesta?: string; velkost?: number }) {
  return (
    <img
      className="qr-kod"
      src={'/api/pristup/qr?cesta=' + encodeURIComponent(cesta)}
      width={velkost}
      height={velkost}
      alt="QR kód s adresou appky pre telefón"
    />
  )
}

/** Okno s QR kódom – napr. „odfoť doklad telefónom". */
export function QrOkno({ nadpis, cesta, children, zavriet }: { nadpis: string; cesta: string; children: ReactNode; zavriet: () => void }) {
  useEffect(() => {
    const klaves = (e: KeyboardEvent) => e.key === 'Escape' && zavriet()
    window.addEventListener('keydown', klaves)
    return () => window.removeEventListener('keydown', klaves)
  }, [zavriet])
  return (
    <div className="prekryv" onClick={(e) => e.target === e.currentTarget && zavriet()}>
      <div className="dialog maly" role="dialog" aria-modal="true" aria-label={nadpis}>
        <h2>{nadpis}</h2>
        <div className="pristup-qr">
          <QrKod cesta={cesta} />
          <div className="pristup-qr-text">{children}</div>
        </div>
        <div className="riadok-akcii">
          <button onClick={zavriet}>Zavrieť</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Časť Nastavení: návod na Tailscale, zapnutie jedným tlačidlom a QR kód,
 * ktorým sa appka otvorí v telefóne bez prepisovania dlhej adresy.
 */
export function PristupZTelefonu() {
  const [stav, setStav, nacitaj] = usePristup()
  const [pracuje, setPracuje] = useState(false)
  const [chyba, setChyba] = useState('')
  const [povolit, setPovolit] = useState('')

  async function zapni() {
    setPracuje(true)
    setChyba('')
    try {
      const r = await api.post<StavPristupu & { ok: boolean; povolit?: string }>('/pristup/zapnut')
      setStav({ ...stav!, ...r })
      if (r.povolit) setPovolit(r.povolit)
      else {
        setPovolit('')
        oznam('Prístup z telefónu je zapnutý.')
      }
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setPracuje(false)
    }
  }

  async function vypni() {
    const ano = await potvrd({
      nadpis: 'Vypnúť prístup z telefónu?',
      text: 'Appka pôjde otvoriť len na tomto počítači. Zapnúť ju pre telefón môžeš znova kedykoľvek.',
      potvrdit: 'Vypnúť',
    })
    if (!ano) return
    setPracuje(true)
    setChyba('')
    try {
      setStav(await api.post<StavPristupu>('/pristup/vypnut'))
      oznam('Prístup z telefónu je vypnutý.')
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setPracuje(false)
    }
  }

  async function skontroluj() {
    setPracuje(true)
    const predtym = stav?.tailscale
    try {
      const novy = await api.get<StavPristupu>('/pristup')
      setStav(novy)
      // Keď sa nič nezmenilo, aspoň to povieme – inak to vyzerá, že tlačidlo nefunguje.
      if (novy.tailscale === predtym && !novy.zapnute) {
        oznam(
          novy.tailscale === 'neprihlaseny'
            ? 'Počítač ešte nie je prihlásený do Tailscale.'
            : novy.tailscale === 'nenainstalovany'
              ? 'Tailscale v počítači zatiaľ nie je.'
              : 'Tailscale beží – môžeš zapnúť prístup.',
        )
      }
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setPracuje(false)
    }
  }

  const znova = (
    <button onClick={skontroluj} disabled={pracuje}>
      {pracuje ? 'Zisťujem…' : 'Skontrolovať znova'}
    </button>
  )

  let obsah: ReactNode
  if (!stav) {
    obsah = <div className="nacitava">Zisťujem…</div>
  } else if (!stav.z_pocitaca) {
    obsah = (
      <p style={{ margin: 0 }}>
        Appku práve používaš cez telefón. Zapína a vypína sa pri počítači.
        <br />
        <span className="tlmene" style={{ fontSize: 13.5 }}>
          Tip: v menu prehliadača vyber „Pridať na plochu" – appka bude mať v telefóne vlastnú ikonu.
        </span>
      </p>
    )
  } else if (stav.verejne) {
    obsah = (
      <>
        <div className="chyba" style={{ marginTop: 0 }}>
          Appka je cez Tailscale Funnel vystavená na internet, kde by ju mohol otvoriť ktokoľvek. Prístup z telefónu je
          preto zablokovaný. Vypni ho a zapni znova – appka Funnel nikdy nepoužíva.
        </div>
        <div className="riadok-akcii zlava">
          <button className="nebezpecne" onClick={vypni} disabled={pracuje}>
            Vypnúť prístup
          </button>
        </div>
      </>
    )
  } else if (stav.zapnute && stav.adresa) {
    obsah = (
      <>
        <div className="pristup-qr">
          <QrKod />
          <div className="pristup-qr-text">
            <strong>Naskenuj kód fotoaparátom telefónu.</strong>
            <div className="pristup-adresa">{stav.adresa}</div>
            <ul className="kroky-postupu">
              <li>V telefóne musí byť zapnutý Tailscale.</li>
              <li>V menu prehliadača vyber „Pridať na plochu" – appka bude mať vlastnú ikonu.</li>
              <li>Počítač musí byť zapnutý a appka spustená. Keď počítač zaspí, telefón sa nepripojí.</li>
            </ul>
          </div>
        </div>
        <div className="riadok-akcii zlava">
          <button onClick={vypni} disabled={pracuje}>
            Vypnúť prístup z telefónu
          </button>
        </div>
      </>
    )
  } else if (stav.tailscale === 'bezi') {
    obsah = (
      <>
        <p style={{ marginTop: 0 }}>
          Tailscale v počítači beží. Po zapnutí dostane appka adresu, ktorú otvoríš v telefóne.
        </p>
        {!stav.meno && (
          <div className="chyba">
            V Tailscale chýba meno počítača. Na stránke login.tailscale.com v časti DNS zapni MagicDNS a skús to znova.
          </div>
        )}
        {stav.obsadene && (
          <div className="chyba">
            Na adrese tohto počítača v Tailscale už beží iná služba. Appka ju neprepíše.
          </div>
        )}
        {povolit && (
          <div className="info-pruh">
            Tailscale potrebuje ešte jedno povolenie (zabezpečené spojenie HTTPS). Otvor{' '}
            <a href={povolit} target="_blank" rel="noreferrer">
              tento odkaz
            </a>
            , potvrď povolenie a potom znova klikni na Zapnúť.
          </div>
        )}
        <div className="riadok-akcii zlava">
          <button className="primar" onClick={zapni} disabled={pracuje || !stav.meno || stav.obsadene}>
            {pracuje ? 'Zapínam…' : 'Zapnúť prístup z telefónu'}
          </button>
        </div>
      </>
    )
  } else {
    obsah = (
      <>
        {stav.tailscale === 'neprihlaseny' ? (
          <>
            <p style={{ marginTop: 0 }}>
              Tailscale je v počítači nainštalovaný, ale <strong>počítač v ňom nie je prihlásený</strong>. Prihlásenie na
              webe Tailscale nestačí – prihlásiť sa musí aj tento počítač, tým istým účtom ako v telefóne.
            </p>
            {stav.prihlasenie ? (
              <div className="riadok-akcii zlava" style={{ marginTop: 0, marginBottom: 12 }}>
                <a className="tlacidlo primar" href={stav.prihlasenie} target="_blank" rel="noreferrer">
                  Prihlásiť počítač do Tailscale
                </a>
              </div>
            ) : (
              <p className="tlmene" style={{ fontSize: 13.5 }}>
                Klikni pravým tlačidlom na ikonu Tailscale pri hodinách vpravo dole a vyber Log in.
              </p>
            )}
            <p className="tlmene" style={{ fontSize: 13.5, marginTop: 0 }}>
              Po prihlásení klikni na Skontrolovať znova.
            </p>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              Appku môžeš používať aj v telefóne – kdekoľvek, aj na turnuse. Stačí na to bezplatný program Tailscale:
            </p>
            <ol className="kroky-postupu">
              <li>
                Do počítača nainštaluj Tailscale zo stránky{' '}
                <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">
                  tailscale.com/download
                </a>{' '}
                a prihlás sa (napríklad účtom Google).
              </li>
              <li>
                Do telefónu nainštaluj aplikáciu Tailscale (Google Play alebo App Store) a prihlás sa <strong>tým istým
                účtom</strong>.
              </li>
              <li>Vráť sa sem a klikni na Skontrolovať znova.</li>
            </ol>
          </>
        )}
        <div className="napoveda">
          Tailscale spojí tvoje zariadenia do súkromnej šifrovanej siete. Appka ostane pre internet neviditeľná – otvoriť
          ju pôjde len v zariadeniach prihlásených do tvojho účtu.
        </div>
        <div className="riadok-akcii zlava">{znova}</div>
      </>
    )
  }

  return (
    <div className="panel">
      <h2 className="nadpis-s-ikonou">
        <Ikona nazov="telefon" velkost={19} />
        Prístup z telefónu
      </h2>
      {chyba && <div className="chyba">{chyba}</div>}
      {obsah}
    </div>
  )
}
