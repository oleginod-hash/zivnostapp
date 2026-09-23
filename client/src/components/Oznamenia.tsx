import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Ikona } from './Ikony'

/**
 * Potvrdzovacie okná a oznámenia v spodnej časti obrazovky.
 *
 * Nahrádzajú systémové okná prehliadača: tie vyzerajú ako chyba appky
 * a nedá sa v nich nič vysvetliť. Oznámenie navyše vie ponúknuť
 * „Vrátiť späť", takže po omyle netreba nič hľadať.
 */

export type Potvrdenie = {
  nadpis: string
  text?: ReactNode
  /** Text potvrdzovacieho tlačidla, napr. „Vysypať kôš". */
  potvrdit?: string
  zrusit?: string
  /** Červené tlačidlo – pri akcii, ktorá sa nedá vrátiť. */
  nebezpecne?: boolean
}

type Akcia = { text: string; sprav: () => void | Promise<void> }
type Oznam = { id: number; text: string; akcia?: Akcia; chyba?: boolean }

let ukazDialog: ((d: (Potvrdenie & { odpoved: (ano: boolean) => void }) | null) => void) | null = null
let upravOznamy: ((f: (o: Oznam[]) => Oznam[]) => void) | null = null
let dalsieId = 1

/** Spýta sa a vráti true, keď človek potvrdil. */
export function potvrd(vstup: string | Potvrdenie): Promise<boolean> {
  const p = typeof vstup === 'string' ? { nadpis: vstup } : vstup
  // Poistka, keby sa vrstva oznámení ešte nestihla pripojiť.
  if (!ukazDialog) return Promise.resolve(window.confirm(p.nadpis))
  return new Promise((odpoved) => ukazDialog!({ ...p, odpoved }))
}

/** Krátke oznámenie dole; s akciou sa z neho dá vrátiť, čo sa práve stalo. */
export function oznam(text: string, akcia?: Akcia) {
  upravOznamy?.((o) => [...o, { id: dalsieId++, text, akcia }])
}

/** Oznámenie o chybe – ostáva dlhšie a je červené. */
export function oznamChybu(text: string) {
  upravOznamy?.((o) => [...o, { id: dalsieId++, text, chyba: true }])
}

export function Oznamenia() {
  const [dialog, setDialog] = useState<(Potvrdenie & { odpoved: (ano: boolean) => void }) | null>(null)
  const [oznamy, setOznamy] = useState<Oznam[]>([])
  const potvrdit = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    ukazDialog = setDialog
    upravOznamy = setOznamy
    return () => {
      ukazDialog = null
      upravOznamy = null
    }
  }, [])

  // Každé oznámenie samo zmizne; s ponukou vrátenia trochu neskôr.
  useEffect(() => {
    if (!oznamy.length) return
    const posledny = oznamy[oznamy.length - 1]
    const cas = posledny.chyba ? 9000 : posledny.akcia ? 8000 : 4000
    const t = setTimeout(() => setOznamy((o) => o.filter((x) => x.id !== posledny.id)), cas)
    return () => clearTimeout(t)
  }, [oznamy])

  useEffect(() => {
    if (!dialog) return
    potvrdit.current?.focus()
    const klaves = (e: KeyboardEvent) => {
      if (e.key === 'Escape') odpovedz(false)
    }
    window.addEventListener('keydown', klaves)
    return () => window.removeEventListener('keydown', klaves)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog])

  function odpovedz(ano: boolean) {
    dialog?.odpoved(ano)
    setDialog(null)
  }

  async function spustiAkciu(o: Oznam) {
    setOznamy((x) => x.filter((y) => y.id !== o.id))
    try {
      await o.akcia?.sprav()
    } catch (e: any) {
      oznamChybu(e?.message || 'Nepodarilo sa to vrátiť.')
    }
  }

  return (
    <>
      {dialog && (
        <div className="prekryv" onClick={(e) => e.target === e.currentTarget && odpovedz(false)}>
          <div className="dialog maly" role="alertdialog" aria-modal="true">
            <h2>{dialog.nadpis}</h2>
            {dialog.text && <p className="dialog-text">{dialog.text}</p>}
            <div className="riadok-akcii">
              <button onClick={() => odpovedz(false)}>{dialog.zrusit ?? 'Zrušiť'}</button>
              <button
                ref={potvrdit}
                className={dialog.nebezpecne ? 'nebezpecne' : 'primar'}
                onClick={() => odpovedz(true)}
              >
                {dialog.potvrdit ?? 'Potvrdiť'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="oznamy" role="status" aria-live="polite">
        {oznamy.map((o) => (
          <div key={o.id} className={'oznam' + (o.chyba ? ' chybny' : '')}>
            <Ikona nazov={o.chyba ? 'pozor' : 'zaplatena'} velkost={15} hrubka={2.2} />
            <span className="oznam-text">{o.text}</span>
            {o.akcia && (
              <button className="oznam-akcia" onClick={() => spustiAkciu(o)}>
                {o.akcia.text}
              </button>
            )}
            <button
              className="ikonove maly holy"
              title="Zavrieť"
              aria-label="Zavrieť"
              onClick={() => setOznamy((x) => x.filter((y) => y.id !== o.id))}
            >
              <Ikona nazov="zavriet" velkost={14} hrubka={2} />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
