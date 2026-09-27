import { useEffect, useRef, useState } from 'react'
import { api, pocet, skDatum, skSuma, vetaORezerve, KATEGORIE_VYDAVKOV } from '../api'
import { Ikona } from '../components/Ikony'
import { oznam } from '../components/Oznamenia'

/**
 * Import výpisu z banky. Nahrá sa CSV z internet bankingu, appka navrhne,
 * ku ktorej faktúre ktorá prichádzajúca platba patrí a ktoré odchádzajúce
 * platby sú výdavky, a zapíše len to, čo používateľ potvrdí. Celý import
 * sa dá hneď vrátiť.
 */

type Dovod = 'vs' | 'suma' | 'uz_zapisane' | 'uz_uhradena' | 'ina_mena' | 'nenajdene'
type DovodVydaja = 'uz_zapisane' | 'ina_mena' | 'nenajdene' | 'vydavok_vs' | 'vydavok_suma' | 'kategoria'
type ZakladPohybu = {
  riadok: number; datum: string; suma: number; mena: string; vs: string; protistrana: string; sprava: string
  odtlacok: string; uz_zapisane: boolean
}
type Pohyb = ZakladPohybu & {
  navrh: { akcia: 'platba' | 'prijem' | 'preskocit'; dovod: Dovod; faktura_id: number | null; faktura_cislo: string | null }
}
/** Odchádzajúca platba – nový výdavok, alebo platba k výdavku, ktorý už je zapísaný. */
type Vydaj = ZakladPohybu & {
  navrh: {
    akcia: 'vydavok' | 'sparovane' | 'preskocit'; dovod: DovodVydaja; kategoria: string
    vydavok_id: number | null; vydavok_popis: string | null
  }
}
type OtvorenaFaktura = { id: number; cislo: string; firma_nazov: string | null; otvoreny_zostatok: number }
type Nahlad = {
  hlavicka: string[]
  stlpce_nenajdene: boolean
  pohyby: Pohyb[]
  vydaje?: Vydaj[]
  odchadzajuce: number
  necitatelne: number
  otvorene_faktury?: OtvorenaFaktura[]
}
type Import = {
  id: number; nazov_suboru: string; created_at: string; platby: number; prijmy: number; vydavky: number
  suma: number; suma_vydavkov: number
}

const DOVODY: Record<Dovod, string> = {
  vs: 'návrh podľa variabilného symbolu',
  suma: 'návrh podľa sumy – skontroluj',
  uz_zapisane: 'už je zapísaná',
  uz_uhradena: 'faktúra s týmto VS je už uhradená',
  ina_mena: 'platba nie je v eurách',
  nenajdene: 'faktúra sa nenašla',
}

const DOVODY_VYDAJOV: Record<DovodVydaja, string> = {
  uz_zapisane: 'už je zapísaná',
  ina_mena: 'platba nie je v eurách',
  nenajdene: 'vyber, či je to výdavok',
  vydavok_vs: 'výdavok s týmto VS už je zapísaný',
  vydavok_suma: 'výdavok s touto sumou už je zapísaný – skontroluj',
  kategoria: 'kategória podľa príjemcu',
}

/** Ručné priradenie stĺpcov, keď ich appka vo výpise nenájde sama. */
const POLIA_MAPOVANIA: { kluc: string; nazov: string; povinne?: boolean }[] = [
  { kluc: 'datum', nazov: 'Dátum', povinne: true },
  { kluc: 'suma', nazov: 'Suma', povinne: true },
  { kluc: 'vs', nazov: 'Variabilný symbol' },
  { kluc: 'protistrana', nazov: 'Od koho' },
  { kluc: 'sprava', nazov: 'Správa' },
]

export function Banka() {
  const vstup = useRef<HTMLInputElement>(null)
  const [subor, setSubor] = useState<File | null>(null)
  const [nahlad, setNahlad] = useState<Nahlad | null>(null)
  const [volby, setVolby] = useState<Record<string, string>>({})
  /** Pri odchádzajúcej platbe: 'preskocit', 'vydavok' alebo `v:<id výdavku>`. */
  const [volbyVydajov, setVolbyVydajov] = useState<Record<string, string>>({})
  const [kategorie, setKategorie] = useState<Record<string, string>>({})
  const [mapovanie, setMapovanie] = useState<Record<string, string>>({})
  const [pracujem, setPracujem] = useState(false)
  const [chyba, setChyba] = useState('')
  const [importy, setImporty] = useState<Import[]>([])

  const nacitajImporty = () => api.get<Import[]>('/banka/importy').then(setImporty).catch(() => {})
  useEffect(() => {
    nacitajImporty()
  }, [])

  async function precitaj(s: File, rucne?: Record<string, string>) {
    setChyba('')
    setPracujem(true)
    try {
      const data = new FormData()
      data.append('subor', s)
      if (rucne) {
        const cisla = Object.fromEntries(Object.entries(rucne).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]))
        data.append('mapovanie', JSON.stringify(cisla))
      }
      const n = await api.upload<Nahlad>('/banka/nahlad', data)
      setSubor(s)
      setNahlad(n)
      setVolby(
        Object.fromEntries(
          n.pohyby.map((p) => [p.odtlacok, p.navrh.akcia === 'platba' && p.navrh.faktura_id ? `f:${p.navrh.faktura_id}` : 'preskocit']),
        ),
      )
      const vydaje = n.vydaje ?? []
      setVolbyVydajov(
        Object.fromEntries(
          vydaje.map((p) => [
            p.odtlacok,
            p.navrh.akcia === 'sparovane' && p.navrh.vydavok_id ? `v:${p.navrh.vydavok_id}` : p.navrh.akcia,
          ]),
        ),
      )
      setKategorie(Object.fromEntries(vydaje.map((p) => [p.odtlacok, p.navrh.kategoria])))
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setPracujem(false)
      if (vstup.current) vstup.current.value = ''
    }
  }

  async function zapis() {
    if (!nahlad || !subor) return
    const vybrane = [
      ...naZapis.map((p) => {
        const volba = volby[p.odtlacok]
        return {
          ...p,
          akcia: volba === 'prijem' ? 'prijem' : 'platba',
          faktura_id: volba.startsWith('f:') ? Number(volba.slice(2)) : null,
        }
      }),
      ...vydajeNaZapis.map((p) => {
        const volba = volbyVydajov[p.odtlacok]
        return {
          ...p,
          akcia: volba === 'vydavok' ? 'vydavok' : 'sparovane',
          vydavok_id: volba.startsWith('v:') ? Number(volba.slice(2)) : null,
          kategoria: kategorie[p.odtlacok] ?? '',
        }
      }),
    ]
    setPracujem(true)
    setChyba('')
    try {
      const r = await api.post<{
        import_id: number | null; platby: number; prijmy: number; vydavky: number; sparovane: number
        suma_platieb: number; odlozit: number
      }>('/banka/zapisat', { nazov_suboru: subor.name, pohyby: vybrane })
      const casti = [
        r.platby ? `${pocet(r.platby, ['platba', 'platby', 'platieb'])} k faktúram (${skSuma(r.suma_platieb)})` : '',
        r.prijmy ? pocet(r.prijmy, ['súkromný príjem', 'súkromné príjmy', 'súkromných príjmov']) : '',
        r.vydavky ? pocet(r.vydavky, ['nový výdavok', 'nové výdavky', 'nových výdavkov']) : '',
        r.sparovane ? `${pocet(r.sparovane, ['platba', 'platby', 'platieb'])} k zapísaným výdavkom` : '',
      ].filter(Boolean)
      const importId = r.import_id
      oznam(
        casti.length
          ? `Zapísané: ${casti.join(' a ')}.${vetaORezerve(r.odlozit, 'z týchto platieb')}`
          : 'Nič nové na zapísanie – všetko už bolo zapísané.',
        importId
          ? {
              text: 'Vrátiť späť',
              sprav: async () => {
                await api.del(`/banka/importy/${importId}`)
                await precitaj(subor)
                nacitajImporty()
              },
            }
          : undefined,
      )
      await precitaj(subor)
      nacitajImporty()
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setPracujem(false)
    }
  }

  const naZapis = nahlad?.pohyby.filter((p) => !p.uz_zapisane && volby[p.odtlacok] && volby[p.odtlacok] !== 'preskocit') ?? []
  const vydajeNaZapis =
    nahlad?.vydaje?.filter((p) => !p.uz_zapisane && volbyVydajov[p.odtlacok] && volbyVydajov[p.odtlacok] !== 'preskocit') ?? []
  const spoluNaZapis = naZapis.length + vydajeNaZapis.length
  const uzZapisane = nahlad?.pohyby.filter((p) => p.uz_zapisane).length ?? 0

  /** Faktúry na výber: otvorené a k tomu tá, ktorú appka navrhla (aj keď je už uhradená). */
  function moznosti(p: Pohyb): OtvorenaFaktura[] {
    const otvorene = nahlad?.otvorene_faktury ?? []
    if (p.navrh.faktura_id && !otvorene.some((f) => f.id === p.navrh.faktura_id)) {
      return [{ id: p.navrh.faktura_id, cislo: p.navrh.faktura_cislo ?? '', firma_nazov: null, otvoreny_zostatok: 0 }, ...otvorene]
    }
    return otvorene
  }

  return (
    <>
      <div className="hlavicka">
        <h1>Výpis z banky</h1>
        <div className="akcie">
          <input
            ref={vstup}
            type="file"
            accept=".csv,.txt,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && precitaj(e.target.files[0])}
          />
          <button className="primar" onClick={() => vstup.current?.click()} disabled={pracujem}>
            <Ikona nazov="subor" velkost={16} />
            {nahlad ? 'Nahrať iný výpis' : 'Nahrať výpis (CSV)'}
          </button>
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}

      {!nahlad && (
        <div className="panel">
          <h2>Ako na to</h2>
          <ol className="kroky-postupu">
            <li>V internet bankingu si stiahni výpis z podnikateľského účtu vo formáte <strong>CSV</strong>.</li>
            <li>Nahraj ho sem tlačidlom <strong>Nahrať výpis</strong>.</li>
            <li>
              Appka nájde platby k tvojim faktúram podľa variabilného symbolu alebo sumy a odchádzajúce platby navrhne ako
              výdavky. Návrhy skontroluj a klikni <strong>Zapísať</strong>.
            </li>
          </ol>
          <p className="tlmene" style={{ margin: 0, fontSize: 13.5 }}>
            Výpis sa spracuje len v tejto appke. Ten istý výpis môžeš nahrať aj viackrát – čo už je zapísané,
            druhýkrát sa nezapíše.
          </p>
        </div>
      )}

      {nahlad?.stlpce_nenajdene && (
        <div className="panel">
          <h2>Priraď stĺpce</h2>
          <p className="tlmene" style={{ marginTop: 0, fontSize: 13.5 }}>
            Vo výpise sa nepodarilo nájsť stĺpec s dátumom alebo sumou. Vyber, ktorý stĺpec je ktorý.
          </p>
          <div className="mriezka">
            {POLIA_MAPOVANIA.map((pole) => (
              <div key={pole.kluc}>
                <label>
                  {pole.nazov}
                  {pole.povinne ? ' *' : ''}
                </label>
                <select
                  value={mapovanie[pole.kluc] ?? ''}
                  onChange={(e) => setMapovanie({ ...mapovanie, [pole.kluc]: e.target.value })}
                >
                  <option value="">— nevybraný —</option>
                  {nahlad.hlavicka.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Stĺpec ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="riadok-akcii">
            <button
              className="primar"
              disabled={!mapovanie.datum || !mapovanie.suma || pracujem || !subor}
              onClick={() => subor && precitaj(subor, mapovanie)}
            >
              Použiť
            </button>
          </div>
        </div>
      )}

      {nahlad && !nahlad.stlpce_nenajdene && (
        <>
          <div className="info-pruh">
            Vo výpise {subor ? <strong>{subor.name}</strong> : null}{' '}
            {nahlad.pohyby.length >= 2 && nahlad.pohyby.length <= 4 ? 'sú' : 'je'}{' '}
            {pocet(nahlad.pohyby.length, ['prichádzajúca platba', 'prichádzajúce platby', 'prichádzajúcich platieb'])}
            {uzZapisane ? `, z toho ${uzZapisane} už zapísaných` : ''}
            {nahlad.odchadzajuce > 0 &&
              ` a ${pocet(nahlad.odchadzajuce, ['odchádzajúca platba', 'odchádzajúce platby', 'odchádzajúcich platieb'])}`}
            .
          </div>

          {nahlad.pohyby.length === 0 ? (
            <div className="panel">
              <p className="tlmene" style={{ margin: 0 }}>Vo výpise nie sú žiadne prichádzajúce platby.</p>
            </div>
          ) : (
            <div className="panel tesny">
              <div className="tabulka-obal">
                <table>
                  <thead>
                    <tr>
                      <th>Dátum</th>
                      <th>Od koho</th>
                      <th>Správa</th>
                      <th className="cislo">Suma</th>
                      <th style={{ minWidth: 260 }}>Zapísať ako</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nahlad.pohyby.map((p) => (
                      <tr key={p.odtlacok} className={p.uz_zapisane ? 'tlmeny-riadok' : undefined}>
                        <td style={{ whiteSpace: 'nowrap' }}>{skDatum(p.datum)}</td>
                        <td>
                          <strong>{p.protistrana || '—'}</strong>
                        </td>
                        <td>
                          {p.sprava || <span className="tlmene">—</span>}
                          {p.vs && <span className="pod-textom">VS {p.vs}</span>}
                        </td>
                        <td className="cislo" style={{ whiteSpace: 'nowrap' }}>
                          <span className="prijem-suma">{skSuma(p.suma)}</span>
                          {p.mena && p.mena !== 'EUR' && <span className="pod-textom">{p.mena}</span>}
                        </td>
                        <td>
                          {p.uz_zapisane ? (
                            <span className="stitok zaplatena">už zapísaná</span>
                          ) : (
                            <>
                              <select
                                aria-label={`Zapísať platbu ${skSuma(p.suma)} ako`}
                                value={volby[p.odtlacok] ?? 'preskocit'}
                                onChange={(e) => setVolby({ ...volby, [p.odtlacok]: e.target.value })}
                              >
                                <option value="preskocit">Nezapisovať</option>
                                <option value="prijem">Súkromný príjem</option>
                                {moznosti(p).map((f) => (
                                  <option key={f.id} value={`f:${f.id}`}>
                                    Faktúra {f.cislo}
                                    {f.firma_nazov ? ` · ${f.firma_nazov}` : ''}
                                    {f.otvoreny_zostatok > 0.005 ? ` · zostáva ${skSuma(f.otvoreny_zostatok)}` : ' · už uhradená'}
                                  </option>
                                ))}
                              </select>
                              <span className="pod-textom">{DOVODY[p.navrh.dovod]}</span>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!!nahlad.vydaje?.length && (
            <div className="panel tesny">
              <h2 className="nadpis-tabulky">Odchádzajúce platby</h2>
              <div className="tabulka-obal">
                <table className="tabulka-vydajov">
                  <thead>
                    <tr>
                      <th>Dátum</th>
                      <th>Komu</th>
                      <th>Správa</th>
                      <th className="cislo">Suma</th>
                      <th style={{ minWidth: 260 }}>Zapísať ako</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nahlad.vydaje.map((p) => {
                      const volba = volbyVydajov[p.odtlacok] ?? 'preskocit'
                      return (
                        <tr key={p.odtlacok} className={p.uz_zapisane ? 'tlmeny-riadok' : undefined}>
                          <td style={{ whiteSpace: 'nowrap' }}>{skDatum(p.datum)}</td>
                          <td className="hlavna-bunka">
                            <strong>{p.protistrana || '—'}</strong>
                          </td>
                          <td>
                            {p.sprava || <span className="tlmene">—</span>}
                            {p.vs && <span className="pod-textom">VS {p.vs}</span>}
                          </td>
                          <td className="cislo" style={{ whiteSpace: 'nowrap' }}>
                            <strong>{skSuma(Math.abs(p.suma))}</strong>
                            {p.mena && p.mena !== 'EUR' && <span className="pod-textom">{p.mena}</span>}
                          </td>
                          <td>
                            {p.uz_zapisane ? (
                              <span className="stitok zaplatena">už zapísaná</span>
                            ) : (
                              <>
                                <select
                                  aria-label={`Zapísať platbu ${skSuma(Math.abs(p.suma))} ako`}
                                  value={volba}
                                  onChange={(e) => setVolbyVydajov({ ...volbyVydajov, [p.odtlacok]: e.target.value })}
                                >
                                  <option value="preskocit">Nezapisovať (súkromná platba)</option>
                                  <option value="vydavok">Nový výdavok</option>
                                  {p.navrh.vydavok_id && (
                                    <option value={`v:${p.navrh.vydavok_id}`}>Už zapísaný: {p.navrh.vydavok_popis}</option>
                                  )}
                                </select>
                                {volba === 'vydavok' && (
                                  <input
                                    className="kategoria-vydaja"
                                    list="kategorie-z-vypisu"
                                    aria-label="Kategória výdavku"
                                    placeholder="kategória"
                                    value={kategorie[p.odtlacok] ?? ''}
                                    onChange={(e) => setKategorie({ ...kategorie, [p.odtlacok]: e.target.value })}
                                  />
                                )}
                                <span className="pod-textom">{DOVODY_VYDAJOV[p.navrh.dovod]}</span>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <datalist id="kategorie-z-vypisu">
                  {KATEGORIE_VYDAVKOV.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              </div>
            </div>
          )}

          <div className="riadok-akcii">
            <button className="primar" onClick={zapis} disabled={pracujem || spoluNaZapis === 0}>
              {spoluNaZapis ? `Zapísať vybrané (${spoluNaZapis})` : 'Nie je čo zapísať'}
            </button>
          </div>
        </>
      )}

      {importy.length > 0 && (
        <div className="panel" style={{ marginTop: 20 }}>
          <h2>Posledné importy</h2>
          <ul className="zoznam-importov">
            {importy.map((i) => (
              <li key={i.id}>
                <span>{skDatum(i.created_at.slice(0, 10))}</span>
                <strong>{i.nazov_suboru || 'výpis'}</strong>
                <span className="tlmene">
                  {[
                    i.platby ? pocet(i.platby, ['platba', 'platby', 'platieb']) : '',
                    i.prijmy ? pocet(i.prijmy, ['súkromný príjem', 'súkromné príjmy', 'súkromných príjmov']) : '',
                    i.vydavky ? pocet(i.vydavky, ['výdavok', 'výdavky', 'výdavkov']) : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  {i.suma > 0 && ` · prijaté ${skSuma(i.suma)}`}
                  {i.suma_vydavkov > 0 && ` · zaplatené ${skSuma(i.suma_vydavkov)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
