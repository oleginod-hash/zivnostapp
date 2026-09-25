import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ibanJePlatny, type Nastavenia } from '../api'
import { Ikona, type KlucIkony } from '../components/Ikony'

/**
 * Sprievodca prvým spustením. Namiesto dlhých Nastavení sa spýta na päť vecí,
 * bez ktorých sa nedá vystaviť správna faktúra. Údaje pre účtovníčku počkajú.
 *
 * Každý krok sa hneď uloží, takže zavretie okna uprostred nič nepokazí.
 * Sprievodca sa dá spustiť aj znova z Nastavení – začína vždy s tým, čo už je
 * uložené, takže nič neprepíše, kým používateľ sám nezmení pole.
 */

type Udaje = Pick<
  Nastavenia,
  | 'meno' | 'ico' | 'dic' | 'urad_zr' | 'cislo_zr' | 'datum_vzniku'
  | 'adresa' | 'psc_mesto' | 'krajina' | 'iban' | 'email'
  | 'praca_v_zahranici' | 'dph_rezim' | 'ic_dph' | 'splatnost_dni' | 'splatnost_pracovne'
>

/** Čo vráti verejný register podľa IČO (server/routes/registry.ts). */
type ZRegistra = {
  nazov: string; adresa: string; psc_mesto: string; krajina: string
  register: string; urad: string; cislo_registra: string; vznik: string
}

const POCET_KROKOV = 5
const BEZNE_SPLATNOSTI = [7, 14, 30]

function vyber(n: Nastavenia): Udaje {
  return {
    meno: n.meno ?? '', ico: n.ico ?? '', dic: n.dic ?? '',
    urad_zr: n.urad_zr ?? '', cislo_zr: n.cislo_zr ?? '', datum_vzniku: n.datum_vzniku ?? '',
    adresa: n.adresa ?? '', psc_mesto: n.psc_mesto ?? '', krajina: n.krajina || 'Slovensko',
    iban: n.iban ?? '', email: n.email ?? '',
    praca_v_zahranici: n.praca_v_zahranici ?? 0,
    dph_rezim: n.dph_rezim ?? 'neplatitel', ic_dph: n.ic_dph ?? '',
    splatnost_dni: n.splatnost_dni ?? 14, splatnost_pracovne: n.splatnost_pracovne ?? 0,
  }
}

/** Veľká voľba s ikonou – jedna z dvoch možností. */
function Volba(p: { ikona: KlucIkony; nazov: string; popis: string; vybrana: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={p.vybrana}
      className={'volba' + (p.vybrana ? ' vybrana' : '')}
      onClick={p.onClick}
    >
      <span className="volba-ikona">
        <Ikona nazov={p.ikona} velkost={20} />
      </span>
      <span className="volba-text">
        <strong>{p.nazov}</strong>
        <span>{p.popis}</span>
      </span>
    </button>
  )
}

function Pole(p: { id: string; popis: string; napoveda?: ReactNode; children: ReactNode }) {
  return (
    <div className="sprievodca-pole">
      <label htmlFor={p.id}>{p.popis}</label>
      {p.children}
      {p.napoveda && <div className="napoveda">{p.napoveda}</div>}
    </div>
  )
}

export function Sprievodca() {
  const navigate = useNavigate()
  const [udaje, setUdaje] = useState<Udaje | null>(null)
  const [krok, setKrok] = useState(0)
  const [pracujem, setPracujem] = useState(false)
  const [chyba, setChyba] = useState('')
  const [hladam, setHladam] = useState(false)
  const [zRegistra, setZRegistra] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api
      .get<Nastavenia>('/nastavenia')
      .then((n) => setUdaje(vyber(n)))
      .catch((e) => setChyba(e.message))
  }, [])

  if (!udaje) {
    return (
      <div className="sprievodca">
        {chyba ? <div className="chyba">{chyba}</div> : <div className="nacitava">Načítavam…</div>}
      </div>
    )
  }

  const uprav = (z: Partial<Udaje>) => {
    setUdaje({ ...udaje, ...z })
    setChyba('')
  }

  // Posielame vždy všetky polia sprievodcu – Nastavenia sa ukladajú zlúčením,
  // takže čo používateľ nezmenil, ostane tak, ako bolo.
  async function uloz(navyse: Partial<Nastavenia> = {}): Promise<boolean> {
    setPracujem(true)
    setChyba('')
    try {
      await api.put('/nastavenia', { ...udaje, ...navyse })
      return true
    } catch (e: any) {
      setChyba(e.message)
      return false
    } finally {
      setPracujem(false)
    }
  }

  async function dalej(e: FormEvent) {
    e.preventDefault()
    if (krok === 0 && !udaje!.meno.trim()) {
      setChyba('Vyplň meno – bez neho sa faktúra vystaviť nedá.')
      return
    }
    const posledny = krok === POCET_KROKOV - 1
    if (await uloz(posledny ? { sprievodca_hotovy: 1 } : {})) setKrok(krok + 1)
  }

  async function preskoc() {
    if (await uloz({ sprievodca_hotovy: 1 })) navigate('/')
  }

  async function doplnZRegistra() {
    const ico = udaje!.ico.replace(/\s/g, '')
    if (!ico) return
    setHladam(true)
    setZRegistra(null)
    try {
      const r = await api.get<ZRegistra>('/register/ico/' + ico)
      // Živnostník je v registri so zápisom v živnostenskom registri – ten sa tlačí na faktúru.
      const zivnost = /živnost/i.test(r.register)
      setUdaje({
        ...udaje!,
        ico,
        meno: r.nazov || udaje!.meno,
        adresa: r.adresa || udaje!.adresa,
        psc_mesto: r.psc_mesto || udaje!.psc_mesto,
        krajina: /^sloven/i.test(r.krajina) ? udaje!.krajina : r.krajina || udaje!.krajina,
        ...(zivnost
          ? {
              urad_zr: r.urad.replace(/^okresný úrad\s+/i, '') || udaje!.urad_zr,
              cislo_zr: r.cislo_registra || udaje!.cislo_zr,
              datum_vzniku: r.vznik || udaje!.datum_vzniku,
            }
          : {}),
      })
      setZRegistra({
        ok: true,
        text: zivnost
          ? 'Z registra sú doplnené meno, adresa aj zápis v živnostenskom registri. Skontroluj ich.'
          : 'Z registra sú doplnené meno a adresa. Skontroluj ich.',
      })
    } catch (e: any) {
      setZRegistra({ ok: false, text: e.message })
    } finally {
      setHladam(false)
    }
  }

  const zapis =
    udaje.urad_zr || udaje.cislo_zr
      ? `Zapísaný v živnostenskom registri${udaje.urad_zr ? ` OÚ ${udaje.urad_zr}` : ''}${udaje.cislo_zr ? `, č. ${udaje.cislo_zr}` : ''}.`
      : ''

  const kroky: { otazka: string; uvod: string; obsah: ReactNode }[] = [
    {
      otazka: 'Ako sa voláš na faktúre?',
      uvod:
        'Tieto údaje budú na každej faktúre ako dodávateľ. Keď zadáš IČO, appka doplní meno, adresu ' +
        'aj zápis v živnostenskom registri z verejného registra.',
      obsah: (
        <>
          <Pole id="s-ico" popis="IČO">
            <div className="sprievodca-riadok">
              <input
                id="s-ico"
                inputMode="numeric"
                autoComplete="off"
                value={udaje.ico}
                placeholder="napr. 12345678"
                onChange={(e) => uprav({ ico: e.target.value })}
              />
              <button type="button" onClick={doplnZRegistra} disabled={hladam || !udaje.ico.trim()}>
                <Ikona nazov="hladat" velkost={15} />
                {hladam ? 'Hľadám…' : 'Doplniť z registra'}
              </button>
            </div>
            {zRegistra && <div className={'napoveda ' + (zRegistra.ok ? 'uspesna' : 'chybna')}>{zRegistra.text}</div>}
          </Pole>
          <Pole id="s-meno" popis="Meno a priezvisko alebo obchodné meno *">
            <input id="s-meno" value={udaje.meno} onChange={(e) => uprav({ meno: e.target.value })} />
          </Pole>
          <Pole id="s-dic" popis="DIČ" napoveda="Nepovinné. Nájdeš ho v potvrdení o registrácii z daňového úradu.">
            <input id="s-dic" value={udaje.dic} onChange={(e) => uprav({ dic: e.target.value })} />
          </Pole>
          {zapis && (
            <div className="napoveda">
              Na faktúre bude aj: <em>{zapis}</em>
            </div>
          )}
        </>
      ),
    },
    {
      otazka: 'Aká adresa má byť na faktúre?',
      uvod: 'Zvyčajne je to miesto podnikania uvedené v živnostenskom oprávnení.',
      obsah: (
        <>
          <Pole id="s-adresa" popis="Ulica a číslo">
            <input id="s-adresa" value={udaje.adresa} onChange={(e) => uprav({ adresa: e.target.value })} />
          </Pole>
          <div className="sprievodca-dva">
            <Pole id="s-psc" popis="PSČ a mesto">
              <input
                id="s-psc"
                value={udaje.psc_mesto}
                placeholder="napr. 089 01 Svidník"
                onChange={(e) => uprav({ psc_mesto: e.target.value })}
              />
            </Pole>
            <Pole id="s-krajina" popis="Krajina">
              <input id="s-krajina" value={udaje.krajina} onChange={(e) => uprav({ krajina: e.target.value })} />
            </Pole>
          </div>
        </>
      ),
    },
    {
      otazka: 'Kam ti majú zákazníci posielať peniaze?',
      uvod:
        'Číslo účtu v tvare IBAN. Appka z neho na každej faktúre vytvorí QR kód, ktorý zákazník ' +
        'naskenuje v mobilnej banke.',
      obsah: (
        <>
          <Pole
            id="s-iban"
            popis="IBAN"
            napoveda={
              udaje.iban.trim() && !ibanJePlatny(udaje.iban) ? (
                <span className="chybna">IBAN nevyzerá správne – skontroluj, či v ňom nechýba alebo nepribudla číslica.</span>
              ) : (
                'Nájdeš ho v internet bankingu alebo na zmluve s bankou.'
              )
            }
          >
            <input
              id="s-iban"
              autoComplete="off"
              value={udaje.iban}
              placeholder="SK00 0000 0000 0000 0000 0000"
              onChange={(e) => uprav({ iban: e.target.value })}
            />
          </Pole>
          <Pole id="s-email" popis="E-mail" napoveda="Nepovinné. Zobrazí sa na faktúre, aby ťa zákazník mohol kontaktovať.">
            <input id="s-email" type="email" value={udaje.email} onChange={(e) => uprav({ email: e.target.value })} />
          </Pole>
        </>
      ),
    },
    {
      otazka: 'Kde zvyčajne pracuješ?',
      uvod: 'Podľa toho appka prispôsobí asistenta a ponuku stravného. Zmeniť sa to dá kedykoľvek v Nastaveniach.',
      obsah: (
        <div className="volby" role="radiogroup" aria-label="Kde zvyčajne pracuješ">
          <Volba
            ikona="domov"
            nazov="Na Slovensku"
            popis="Bežné zákazky doma."
            vybrana={!udaje.praca_v_zahranici}
            onClick={() => uprav({ praca_v_zahranici: 0 })}
          />
          <Volba
            ikona="svet"
            nazov="Na turnusoch v zahraničí"
            popis="Asistent bude počítať so stravným, dňami v zahraničí, formulárom A1 a dvojitým zdanením."
            vybrana={!!udaje.praca_v_zahranici}
            onClick={() => uprav({ praca_v_zahranici: 1 })}
          />
        </div>
      ),
    },
    {
      otazka: 'DPH a splatnosť faktúr',
      uvod: 'Posledné dve veci, ktoré sa tlačia na faktúru.',
      obsah: (
        <>
          <div className="volby" role="radiogroup" aria-label="DPH">
            <Volba
              ikona="penazenka"
              nazov="Nie som platiteľ DPH"
              popis={'Najčastejší prípad živnostníka. Na faktúre bude veta „Nie je platiteľ DPH".'}
              vybrana={udaje.dph_rezim !== '7a'}
              onClick={() => uprav({ dph_rezim: 'neplatitel' })}
            />
            <Volba
              ikona="svet"
              nazov="Mám IČ DPH podľa § 7a"
              popis="Pri službách pre firmy z inej krajiny EÚ. Platiteľom nie si, ale IČ DPH sa uvádza na faktúre."
              vybrana={udaje.dph_rezim === '7a'}
              onClick={() => uprav({ dph_rezim: '7a' })}
            />
          </div>
          {udaje.dph_rezim === '7a' && (
            <Pole id="s-icdph" popis="IČ DPH">
              <input id="s-icdph" value={udaje.ic_dph} placeholder="napr. SK1234567890" onChange={(e) => uprav({ ic_dph: e.target.value })} />
            </Pole>
          )}
          <div className="napoveda">Ak si platiteľ DPH, appka ti zatiaľ nepostačí – faktúry s DPH nevie vystaviť.</div>

          <div className="sprievodca-pole" style={{ marginTop: 20 }}>
            <label htmlFor="s-splatnost">Za koľko dní ti majú zákazníci zaplatiť?</label>
            <div className="sprievodca-riadok">
              {BEZNE_SPLATNOSTI.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="tlacidlo-s-ikonou"
                  aria-pressed={udaje.splatnost_dni === d}
                  onClick={() => uprav({ splatnost_dni: d })}
                >
                  {d} dní
                </button>
              ))}
              <input
                id="s-splatnost"
                type="number"
                min={0}
                max={365}
                className="splatnost-vlastna"
                aria-label="Vlastný počet dní"
                value={udaje.splatnost_dni}
                onChange={(e) => uprav({ splatnost_dni: Number(e.target.value) })}
              />
            </div>
            <label className="zaskrtavacie">
              <input
                type="checkbox"
                checked={!!udaje.splatnost_pracovne}
                onChange={(e) => uprav({ splatnost_pracovne: e.target.checked ? 1 : 0 })}
              />
              Počítať len pracovné dni (bez víkendov a sviatkov)
            </label>
          </div>
        </>
      ),
    },
  ]

  const hotovo = krok >= POCET_KROKOV
  const aktualny = kroky[Math.min(krok, POCET_KROKOV - 1)]

  return (
    <div className="sprievodca">
      <div className="sprievodca-hlava">
        <span className="sprievodca-logo">
          <span className="logo-dlazdica">
            <Ikona nazov="logo" velkost={15} hrubka={2.2} />
          </span>
          Živnosťapp
        </span>
        {!hotovo && (
          <button type="button" className="holy" onClick={preskoc} disabled={pracujem}>
            Preskočiť, vyplním neskôr
          </button>
        )}
      </div>

      {hotovo ? (
        <div className="sprievodca-karta sprievodca-koniec">
          <span className="sprievodca-hotovo-ikona">
            <Ikona nazov="hotovo" velkost={30} hrubka={2} />
          </span>
          <h1>Hotovo, môžeš začať</h1>
          <p className="sprievodca-text">
            Základné údaje sú uložené. Ostatné – napríklad predmety podnikania alebo zdravotnú poisťovňu pre
            účtovníčku – doplníš kedykoľvek v Nastaveniach.
          </p>
          <div className="info-pruh">
            Ak už máš tento rok vystavené faktúry z iného programu, pri prvej faktúre prepíš jej číslo.
            Ďalšie budú pokračovať v poradí.
          </div>
          <div className="sprievodca-akcie">
            <Link className="tlacidlo" to="/">
              Prejsť na Prehľad
            </Link>
            <Link className="tlacidlo primar" to="/faktury/nova">
              <Ikona nazov="plus" velkost={16} hrubka={2.2} />
              Vystaviť prvú faktúru
            </Link>
          </div>
        </div>
      ) : (
        <form className="sprievodca-karta" onSubmit={dalej} noValidate>
          <div className="sprievodca-postup" aria-hidden="true">
            {kroky.map((_, i) => (
              <span key={i} className={i < krok ? 'hotovy' : i === krok ? 'aktualny' : ''} />
            ))}
          </div>
          <div className="sprievodca-krok">
            Krok {krok + 1} z {POCET_KROKOV}
          </div>
          <h1>{aktualny.otazka}</h1>
          <p className="sprievodca-text">{aktualny.uvod}</p>

          {aktualny.obsah}

          {chyba && <div className="chyba">{chyba}</div>}

          <div className="sprievodca-akcie">
            {krok > 0 && (
              <button type="button" onClick={() => setKrok(krok - 1)} disabled={pracujem}>
                Späť
              </button>
            )}
            <button type="submit" className="primar" disabled={pracujem}>
              {krok === POCET_KROKOV - 1 ? 'Dokončiť' : 'Ďalej'}
              <Ikona nazov="vpravo" velkost={16} hrubka={2.2} />
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
