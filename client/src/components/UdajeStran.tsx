import { useState, type ReactNode } from 'react'
import { api, type Firma, type Nastavenia } from '../api'
import { Okno } from './Okno'

/**
 * Údaje odberateľa a dodávateľa priamo z faktúry – ako „Viac údajov"
 * v bežných fakturačných appkách. Netreba kvôli preklepu v adrese odchádzať
 * z rozpísanej faktúry do Firiem či Nastavení.
 */

function Pole({ id, popis, children, siroke = false }: { id: string; popis: string; children: ReactNode; siroke?: boolean }) {
  return (
    <div className={siroke ? 'pole-siroke' : undefined}>
      <label htmlFor={id}>{popis}</label>
      {children}
    </div>
  )
}

type UdajeFirmy = Pick<Firma, 'nazov' | 'kontaktna_osoba' | 'adresa' | 'psc_mesto' | 'krajina' | 'ico' | 'dic' | 'ic_dph' | 'email' | 'telefon'>
const PRAZDNA_FIRMA: UdajeFirmy = {
  nazov: '', kontaktna_osoba: '', adresa: '', psc_mesto: '', krajina: 'Slovensko', ico: '', dic: '', ic_dph: '', email: '', telefon: '',
}

/** Odberateľ: úprava vybranej firmy, alebo nová firma rovno z faktúry. */
export function OknoOdberatela({
  firma,
  zavriet,
  ulozene,
}: {
  firma: Firma | null
  zavriet: () => void
  ulozene: (f: Firma) => void
}) {
  const [u, setU] = useState<UdajeFirmy>(() => (firma ? { ...PRAZDNA_FIRMA, ...firma } : { ...PRAZDNA_FIRMA }))
  const [chyba, setChyba] = useState('')
  const [sprava, setSprava] = useState('')
  const [pracuje, setPracuje] = useState(false)
  const pole = (k: keyof UdajeFirmy) => ({
    id: `odberatel-${k}`,
    value: u[k] ?? '',
    onChange: (e: { target: { value: string } }) => setU({ ...u, [k]: e.target.value }),
  })

  async function zRegistra() {
    setChyba('')
    setPracuje(true)
    try {
      const n = await api.get<Partial<Firma> & { chyba_v_registri?: string[] }>('/register/ico/' + u.ico.replace(/\s/g, ''))
      // Len prázdne polia – čo človek napísal sám, neprepíšeme.
      setU({
        ...u,
        nazov: u.nazov || n.nazov || '',
        adresa: u.adresa || n.adresa || '',
        psc_mesto: u.psc_mesto || n.psc_mesto || '',
        krajina: u.krajina || n.krajina || '',
      })
      setSprava('Doplnené z registra.')
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setPracuje(false)
    }
  }

  async function uloz() {
    setChyba('')
    setPracuje(true)
    try {
      const f = firma ? await api.put<Firma>('/firmy/' + firma.id, u) : await api.post<Firma>('/firmy', u)
      ulozene(f)
    } catch (e: any) {
      setChyba(e.message)
      setPracuje(false)
    }
  }

  return (
    <Okno nadpis={firma ? 'Odberateľ' : 'Nový odberateľ'} zavriet={zavriet}>
      {chyba && <div className="chyba">{chyba}</div>}
      {sprava && <div className="uspech">{sprava}</div>}
      <div className="mriezka mriezka-udajov">
        <Pole id="odberatel-nazov" popis="Názov firmy *" siroke>
          <input {...pole('nazov')} autoFocus={!firma} />
        </Pole>
        <Pole id="odberatel-ico" popis="IČO" siroke>
          <div className="pole-s-tlacidlom">
            <input {...pole('ico')} inputMode="numeric" />
            <button type="button" onClick={zRegistra} disabled={pracuje || !/^\d{6,8}$/.test(u.ico.replace(/\s/g, ''))}>
              Načítať z registra
            </button>
          </div>
        </Pole>
        <Pole id="odberatel-dic" popis="DIČ">
          <input {...pole('dic')} />
        </Pole>
        <Pole id="odberatel-ic_dph" popis="IČ DPH">
          <input {...pole('ic_dph')} placeholder="napr. DE123456789" />
        </Pole>
        <Pole id="odberatel-adresa" popis="Ulica a číslo" siroke>
          <input {...pole('adresa')} />
        </Pole>
        <Pole id="odberatel-psc_mesto" popis="PSČ a mesto">
          <input {...pole('psc_mesto')} />
        </Pole>
        <Pole id="odberatel-krajina" popis="Krajina">
          <input {...pole('krajina')} />
        </Pole>
        <h3 className="pole-siroke podnadpis-okna">Kontakt</h3>
        <Pole id="odberatel-kontaktna_osoba" popis="Kontaktná osoba" siroke>
          <input {...pole('kontaktna_osoba')} />
        </Pole>
        <Pole id="odberatel-email" popis="E-mail" siroke>
          <input {...pole('email')} type="email" inputMode="email" />
        </Pole>
        <Pole id="odberatel-telefon" popis="Telefón" siroke>
          <input {...pole('telefon')} type="tel" />
        </Pole>
      </div>
      <p className="napoveda">
        {firma
          ? 'Zmena sa uloží k firme – prejaví sa na všetkých jej faktúrach.'
          : 'Firma sa uloží do zoznamu Firiem a hneď sa vyberie na túto faktúru.'}
      </p>
      <div className="riadok-akcii">
        <button type="button" onClick={zavriet}>
          Zrušiť
        </button>
        <button type="button" className="primar" onClick={uloz} disabled={pracuje || !u.nazov.trim()}>
          Uložiť
        </button>
      </div>
    </Okno>
  )
}

const POLIA_DODAVATELA = [
  'meno', 'adresa', 'psc_mesto', 'krajina', 'ico', 'dic', 'ic_dph', 'dph_rezim',
  'urad_zr', 'cislo_zr', 'iban', 'swift', 'banka', 'telefon', 'email', 'web',
] as const
type UdajeDodavatela = Pick<Nastavenia, (typeof POLIA_DODAVATELA)[number]>

/** Dodávateľ (moja firma): údaje z Nastavení, ktoré sa tlačia na každú faktúru. */
export function OknoDodavatela({
  nastavenia,
  zavriet,
  ulozene,
}: {
  nastavenia: Nastavenia
  zavriet: () => void
  ulozene: (n: Nastavenia) => void
}) {
  const [u, setU] = useState<UdajeDodavatela>(
    () => Object.fromEntries(POLIA_DODAVATELA.map((k) => [k, nastavenia[k] ?? ''])) as UdajeDodavatela,
  )
  const [chyba, setChyba] = useState('')
  const [pracuje, setPracuje] = useState(false)
  const pole = (k: Exclude<keyof UdajeDodavatela, 'dph_rezim'>) => ({
    id: `dodavatel-${k}`,
    value: (u[k] as string) ?? '',
    onChange: (e: { target: { value: string } }) => setU({ ...u, [k]: e.target.value }),
  })

  async function uloz() {
    setChyba('')
    setPracuje(true)
    try {
      ulozene(await api.put<Nastavenia>('/nastavenia', u))
    } catch (e: any) {
      setChyba(e.message)
      setPracuje(false)
    }
  }

  return (
    <Okno nadpis="Moja firma (dodávateľ)" zavriet={zavriet}>
      {chyba && <div className="chyba">{chyba}</div>}
      <div className="mriezka mriezka-udajov">
        <Pole id="dodavatel-meno" popis="Meno a priezvisko alebo názov *" siroke>
          <input {...pole('meno')} />
        </Pole>
        <Pole id="dodavatel-adresa" popis="Ulica a číslo" siroke>
          <input {...pole('adresa')} />
        </Pole>
        <Pole id="dodavatel-psc_mesto" popis="PSČ a mesto">
          <input {...pole('psc_mesto')} />
        </Pole>
        <Pole id="dodavatel-krajina" popis="Krajina">
          <input {...pole('krajina')} />
        </Pole>
        <Pole id="dodavatel-ico" popis="IČO">
          <input {...pole('ico')} inputMode="numeric" />
        </Pole>
        <Pole id="dodavatel-dic" popis="DIČ">
          <input {...pole('dic')} inputMode="numeric" />
        </Pole>
        <Pole id="dodavatel-dph_rezim" popis="DPH">
          <select
            id="dodavatel-dph_rezim"
            value={u.dph_rezim ?? 'neplatitel'}
            onChange={(e) => setU({ ...u, dph_rezim: e.target.value as Nastavenia['dph_rezim'] })}
          >
            <option value="neplatitel">Nie som platiteľ DPH</option>
            <option value="7a">Registrácia podľa § 7a</option>
            <option value="platitel">Som platiteľ DPH</option>
          </select>
        </Pole>
        {u.dph_rezim !== 'neplatitel' && (
          <Pole id="dodavatel-ic_dph" popis="IČ DPH">
            <input {...pole('ic_dph')} placeholder="napr. SK1234567890" />
          </Pole>
        )}
        <h3 className="pole-siroke podnadpis-okna">Zápis v registri</h3>
        <Pole id="dodavatel-urad_zr" popis="Okresný úrad">
          <input {...pole('urad_zr')} placeholder="napr. Svidník" />
        </Pole>
        <Pole id="dodavatel-cislo_zr" popis="Číslo živnostenského registra">
          <input {...pole('cislo_zr')} />
        </Pole>
        <h3 className="pole-siroke podnadpis-okna">Platobné údaje</h3>
        <Pole id="dodavatel-iban" popis="IBAN" siroke>
          <input {...pole('iban')} />
        </Pole>
        <Pole id="dodavatel-swift" popis="SWIFT">
          <input {...pole('swift')} />
        </Pole>
        <Pole id="dodavatel-banka" popis="Banka">
          <input {...pole('banka')} />
        </Pole>
        <h3 className="pole-siroke podnadpis-okna">Kontakt</h3>
        <Pole id="dodavatel-telefon" popis="Telefón">
          <input {...pole('telefon')} type="tel" />
        </Pole>
        <Pole id="dodavatel-web" popis="Web">
          <input {...pole('web')} />
        </Pole>
        <Pole id="dodavatel-email" popis="E-mail" siroke>
          <input {...pole('email')} type="email" inputMode="email" />
        </Pole>
      </div>
      <p className="napoveda">Údaje sa uložia do Nastavení a tlačia sa na každú faktúru.</p>
      <div className="riadok-akcii">
        <button type="button" onClick={zavriet}>
          Zrušiť
        </button>
        <button type="button" className="primar" onClick={uloz} disabled={pracuje || !String(u.meno ?? '').trim()}>
          Uložiť
        </button>
      </div>
    </Okno>
  )
}
