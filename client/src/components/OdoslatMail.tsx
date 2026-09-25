import { useEffect, useState } from 'react'
import { api, type NavrhMailu, type StavMailu } from '../api'
import { potvrd } from './Oznamenia'

type Props = {
  invoiceId: number
  typ: 'faktura' | 'upomienka'
  zavriet: () => void
  poOdoslani?: () => void
}

const JAZYKY = [
  { kod: 'sk', nazov: 'Slovensky' },
  { kod: 'en', nazov: 'English' },
  { kod: 'de', nazov: 'Deutsch' },
]

/** Okno na odoslanie faktúry alebo upomienky – text sa dá pred odoslaním upraviť. */
export function OdoslatMail({ invoiceId, typ, zavriet, poOdoslani }: Props) {
  const [stav, setStav] = useState<StavMailu | null>(null)
  const [jazyk, setJazyk] = useState('sk')
  const [navrh, setNavrh] = useState<NavrhMailu | null>(null)
  const [komu, setKomu] = useState('')
  const [predmet, setPredmet] = useState('')
  const [text, setText] = useState('')
  const [chyba, setChyba] = useState('')
  const [odosiela, setOdosiela] = useState(false)
  const [hotovo, setHotovo] = useState('')

  useEffect(() => {
    api.get<StavMailu>('/mail/stav').then(setStav).catch(() => {})
  }, [])

  useEffect(() => {
    api
      .get<NavrhMailu>(`/mail/navrh/${invoiceId}?typ=${typ}&jazyk=${jazyk}`)
      .then((n) => {
        setNavrh(n)
        setKomu((k) => k || n.komu)
        setPredmet(n.predmet)
        setText(n.text)
      })
      .catch((e) => setChyba(e.message))
  }, [invoiceId, typ, jazyk])

  /**
   * Iný jazyk = nový predpripravený text. Keď si ho už človek upravil,
   * najprv sa spýtame – inak by jeho úpravy potichu zmizli.
   */
  async function zmenJazyk(novy: string) {
    const upraveny = navrh && (predmet !== navrh.predmet || text !== navrh.text)
    if (upraveny) {
      const ano = await potvrd({
        nadpis: 'Nahradiť upravený text?',
        text: 'Upravený text sa nahradí predpripraveným textom v inom jazyku.',
        potvrdit: 'Nahradiť',
      })
      if (!ano) return
    }
    setJazyk(novy)
  }

  async function odosli() {
    setChyba('')
    setOdosiela(true)
    try {
      const r = await api.post<{ sprava: string }>(`/mail/odoslat/${invoiceId}`, { komu, predmet, text })
      setHotovo(r.sprava)
      poOdoslani?.()
      setTimeout(zavriet, 1800)
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setOdosiela(false)
    }
  }

  return (
    <div className="prekryv" onClick={(e) => e.target === e.currentTarget && zavriet()}>
      <div className="dialog">
        <h2>{typ === 'upomienka' ? 'Poslať upomienku' : 'Poslať faktúru e-mailom'}</h2>

        {stav && !stav.nastavene && (
          <div className="chyba">
            Odosielanie e-mailov nie je nastavené. Doplň <code>SMTP_HOST</code>, <code>SMTP_USER</code> a{' '}
            <code>SMTP_PASS</code> do súboru <code>.env</code> a reštartuj appku.
          </div>
        )}
        {chyba && <div className="chyba">{chyba}</div>}
        {hotovo && <div className="uspech">{hotovo}</div>}

        <div className="mriezka">
          <div>
            <label>Komu</label>
            <input value={komu} placeholder="email@firma.sk" onChange={(e) => setKomu(e.target.value)} />
            {navrh && !navrh.komu && (
              <div className="napoveda">Firma nemá uložený e-mail – doplň ho tu alebo v karte firmy.</div>
            )}
          </div>
          <div>
            <label>Jazyk</label>
            <select value={jazyk} onChange={(e) => zmenJazyk(e.target.value)}>
              {JAZYKY.map((j) => (
                <option key={j.kod} value={j.kod}>
                  {j.nazov}
                </option>
              ))}
            </select>
          </div>
          <div className="pole-siroke">
            <label>Predmet</label>
            <input value={predmet} onChange={(e) => setPredmet(e.target.value)} />
          </div>
          <div className="pole-siroke">
            <label>Text správy</label>
            <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>

        <div className="napoveda" style={{ marginTop: 10 }}>
          Faktúra sa priloží ako PDF automaticky.
          {stav?.odosielatel && ` Odosiela sa z ${stav.odosielatel}.`}
        </div>

        <div className="riadok-akcii">
          <button onClick={zavriet}>Zrušiť</button>
          <button
            className="primar"
            onClick={odosli}
            disabled={odosiela || !komu.trim() || !stav?.nastavene || !!hotovo}
          >
            {odosiela ? 'Odosielam…' : 'Odoslať'}
          </button>
        </div>
      </div>
    </div>
  )
}
