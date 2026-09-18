import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  api, dnesISO, pocet, skDatum, skSuma, turnusPreDatum, velkostSuboru,
  KATEGORIE_PRIJMOV, KATEGORIE_VYDAVKOV, NAZVY_PLATIEB,
  type DruhVydavku, type Platba, type Priloha, type SuhrnVydavkov, type Turnus, type Vydavok,
} from '../api'
import { Ikona } from '../components/Ikony'
import { FarebnyCip, tonKategorie } from '../components/Farby'
import { PrazdnyStav } from '../components/PrazdnyStav'
import { useNeulozeneZmeny } from '../neulozene'

type Formular = {
  id?: number
  datum: string; popis: string; kategoria: string; suma: number
  /** Súkromný príjem sa vedie tu, ale s podnikaním nemá nič spoločné. */
  druh: DruhVydavku
  /** Prázdne = appka priradí turnus podľa dátumu. `bezTurnusu` to vypne. */
  tour_id: string; bezTurnusu: boolean
  platba: Platba; odpocitat: boolean; poznamka: string
}

const PRAZDNY = (druh: DruhVydavku): Formular => ({
  datum: dnesISO(), popis: '', kategoria: '', suma: 0, druh,
  tour_id: '', bezTurnusu: druh === 'prijem', platba: druh === 'prijem' ? 'prevod' : 'karta',
  odpocitat: druh === 'vydavok', poznamka: '',
})

/**
 * Dve možnosti navyše v rozbaľovacom zozname kategórií. Nie sú to kategórie,
 * ale hľadá sa to na tom istom mieste — „ukáž mi všetko, čo ide do dane"
 * je otázka, ktorú si človek kladie častejšie než hľadanie jednej kategórie.
 */
const PODLA_DANE = { uznatelne: '__uznatelne', neuznatelne: '__neuznatelne' }

const ZALOZKY: { kluc: DruhVydavku; text: string }[] = [
  { kluc: 'vydavok', text: 'Výdavky' },
  { kluc: 'prijem', text: 'Súkromné príjmy' },
]

export function Vydavky() {
  const [druh, setDruh] = useState<DruhVydavku>('vydavok')
  const [vydavky, setVydavky] = useState<Vydavok[] | null>(null)
  const [suhrn, setSuhrn] = useState<SuhrnVydavkov | null>(null)
  const [turnusy, setTurnusy] = useState<Turnus[]>([])
  const [kategorie, setKategorie] = useState<string[]>(KATEGORIE_VYDAVKOV)
  const [uprava, setUprava] = useState<Formular | null>(null)
  const [prilohy, setPrilohy] = useState<Priloha[]>([])
  const [chyba, setChyba] = useState('')
  const [nahrava, setNahrava] = useState(false)
  const [cakajuceSubory, setCakajuceSubory] = useState<File[]>([])
  const [f, setF] = useState({ od: '', do: '', kategoria: '', turnus: '', hladat: '' })
  const vstupSuborov = useRef<HTMLInputElement>(null)
  const oznacUlozene = useNeulozeneZmeny(uprava, uprava?.id ?? 'novy')

  const prijem = druh === 'prijem'

  function nacitaj() {
    const q = new URLSearchParams({ druh })
    for (const [k, v] of Object.entries(f)) {
      if (!v) continue
      // Voľby „podľa dane" sedia v tom istom poli, ale posielajú sa inak.
      if (k === 'kategoria' && v === PODLA_DANE.uznatelne) q.set('uznatelne', '1')
      else if (k === 'kategoria' && v === PODLA_DANE.neuznatelne) q.set('uznatelne', '0')
      else q.set(k, v)
    }
    api.get<Vydavok[]>('/vydavky?' + q).then(setVydavky).catch((e) => setChyba(e.message))

    const obdobie = new URLSearchParams()
    if (f.od) obdobie.set('od', f.od)
    if (f.do) obdobie.set('do', f.do)
    api.get<SuhrnVydavkov>('/vydavky/suhrn?' + obdobie).then(setSuhrn).catch(() => {})

    const zaklad = prijem ? KATEGORIE_PRIJMOV : KATEGORIE_VYDAVKOV
    api
      .get<string[]>('/vydavky/kategorie?druh=' + druh)
      .then((k) => setKategorie([...new Set([...zaklad, ...k])].sort((a, b) => a.localeCompare(b, 'sk'))))
      .catch(() => setKategorie(zaklad))
  }

  useEffect(() => {
    api.get<Turnus[]>('/turnusy').then(setTurnusy).catch(() => {})
  }, [])

  // Z rýchlej akcie na Prehľade prichádzame s ?novy=1 – rovno otvoríme formulár.
  const [parametre, setParametre] = useSearchParams()
  useEffect(() => {
    if (parametre.get('novy') !== '1') return
    otvorNovy()
    setParametre({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parametre])

  useEffect(() => {
    const t = setTimeout(nacitaj, f.hladat ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, druh])

  function prepni(kluc: DruhVydavku) {
    setDruh(kluc)
    setUprava(null)
    setF({ ...f, kategoria: '', turnus: '' })
  }

  function otvorNovy() {
    setUprava(PRAZDNY(druh))
    setPrilohy([])
    setCakajuceSubory([])
    setChyba('')
  }

  async function otvorUpravu(v: Vydavok) {
    setChyba('')
    const detail = await api.get<Vydavok>('/vydavky/' + v.id)
    setCakajuceSubory([])
    setUprava({
      id: detail.id,
      datum: detail.datum,
      popis: detail.popis,
      kategoria: detail.kategoria,
      suma: detail.suma,
      druh: detail.druh ?? 'vydavok',
      tour_id: detail.tour_id ? String(detail.tour_id) : '',
      bezTurnusu: !detail.tour_id,
      platba: detail.platba,
      odpocitat: detail.odpocitat === 1,
      poznamka: detail.poznamka,
    })
    setPrilohy(detail.prilohy ?? [])
  }

  async function uloz(zavriet: boolean) {
    if (!uprava) return
    setChyba('')
    try {
      const telo = { ...uprava, tour_id: uprava.tour_id || null, bezTurnusu: uprava.bezTurnusu }
      if (uprava.id) {
        await api.put('/vydavky/' + uprava.id, telo)
        oznacUlozene()
        if (zavriet) setUprava(null)
      } else {
        const { id } = await api.post<{ id: number }>('/vydavky', telo)
        // ID si formulár pamätá hneď – keby zlyhalo nahratie dokladu, ďalšie
        // „Uložiť" už len upraví tento výdavok a nevytvorí druhý rovnaký.
        const ulozeny = { ...uprava, id }
        setUprava(zavriet ? null : ulozeny)
        oznacUlozene(ulozeny)
        if (cakajuceSubory.length) {
          const subory = cakajuceSubory
          setCakajuceSubory([])
          try {
            const data = new FormData()
            for (const su of subory) data.append('subory', su)
            const r = await api.upload<{ prilohy: Priloha[] }>(`/vydavky/${id}/subory`, data)
            setPrilohy(r.prilohy)
          } catch (e: any) {
            if (zavriet) setUprava(ulozeny)
            setChyba(`Výdavok je uložený, ale doklad sa nepodarilo nahrať: ${e.message} Skús ho pridať znova.`)
          }
        }
        // Po uložení bez zatvorenia ostávame vo formulári, aby sa dal hneď pripnúť ďalší bloček.
      }
      nacitaj()
    } catch (e: any) {
      setChyba(e.message)
    }
  }

  async function nahrajSubory(subory: FileList | null) {
    if (!subory?.length || !uprava?.id) return
    setNahrava(true)
    try {
      const data = new FormData()
      for (const s of Array.from(subory)) data.append('subory', s)
      const r = await api.upload<{ prilohy: Priloha[] }>(`/vydavky/${uprava.id}/subory`, data)
      setPrilohy(r.prilohy)
      nacitaj()
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setNahrava(false)
      if (vstupSuborov.current) vstupSuborov.current.value = ''
    }
  }

  async function zmaz(v: Vydavok) {
    const co = v.druh === 'prijem' ? 'súkromný príjem' : 'výdavok'
    if (!confirm(`Zmazať ${co} „${v.popis}"? Aj s dokladmi sa presunie do koša.`)) return
    await api.del('/vydavky/' + v.id)
    if (uprava?.id === v.id) setUprava(null)
    nacitaj()
  }

  const spolu = vydavky?.reduce((s, v) => s + v.suma, 0) ?? 0
  const uznatelneVZozname = vydavky?.reduce((s, v) => (v.odpocitat ? s + v.suma : s), 0) ?? 0

  // Keď používateľ turnus nevybral, ukážeme mu ten, ktorý sa priradí podľa dátumu.
  const navrhnutyTurnus =
    uprava && uprava.druh === 'vydavok' && !uprava.tour_id && !uprava.bezTurnusu
      ? turnusPreDatum(turnusy, uprava.datum)
      : null

  const upravujemPrijem = uprava?.druh === 'prijem'

  return (
    <>
      <div className="hlavicka">
        <h1>Výdavky</h1>
        <div className="akcie">
          <Link className="tlacidlo" to="/financie">
            Prehľad financií
          </Link>
          <button className="primar" onClick={otvorNovy}>
            {prijem ? '+ Nový súkromný príjem' : '+ Nový výdavok'}
          </button>
        </div>
      </div>

      <div className="taby">
        {ZALOZKY.map((z) => (
          <button key={z.kluc} className={druh === z.kluc ? 'aktivny' : ''} onClick={() => prepni(z.kluc)}>
            {z.text}
            {suhrn && (
              <span className="pocet">{z.kluc === 'prijem' ? suhrn.pocet_prijmov : suhrn.pocet_vydavkov}</span>
            )}
          </button>
        ))}
      </div>

      {chyba && <div className="chyba">{chyba}</div>}

      {prijem && (
        <div className="napoveda" style={{ marginTop: -8, marginBottom: 12 }}>
          Sem si zapíš peniaze, ktoré prišli na účet, ale nie sú príjmom z podnikania — vklad vlastných peňazí,
          prevod od rodiny, vrátku z e-shopu. Do daňového podkladu ani do zisku nevstupujú, evidujú sa len preto,
          aby ti sedel bankový výpis.
        </div>
      )}

      {uprava && (
        <div className="panel">
          <h2>
            {uprava.id
              ? upravujemPrijem
                ? 'Úprava súkromného príjmu'
                : 'Úprava výdavku'
              : upravujemPrijem
                ? 'Nový súkromný príjem'
                : 'Nový výdavok'}
          </h2>
          <div className="mriezka">
            <div>
              <label>Dátum *</label>
              <input
                type="date"
                value={uprava.datum}
                onChange={(e) => setUprava({ ...uprava, datum: e.target.value })}
              />
            </div>
            <div>
              <label>Suma (€) *</label>
              <input
                type="number"
                step="0.01"
                value={uprava.suma}
                onChange={(e) => setUprava({ ...uprava, suma: Number(e.target.value) })}
              />
            </div>
            <div>
              <label>Čo to je</label>
              <select
                value={uprava.druh}
                onChange={(e) => {
                  const d = e.target.value as DruhVydavku
                  setUprava({
                    ...uprava,
                    druh: d,
                    // Súkromný príjem nie je daňový výdavok a nepatrí k turnusu.
                    odpocitat: d === 'vydavok' ? uprava.odpocitat : false,
                    tour_id: d === 'prijem' ? '' : uprava.tour_id,
                    bezTurnusu: d === 'prijem' ? true : uprava.bezTurnusu,
                  })
                }}
              >
                <option value="vydavok">Výdavok</option>
                <option value="prijem">Súkromný príjem (mimo podnikania)</option>
              </select>
            </div>
            <div>
              <label>Kategória</label>
              <input
                list="kategorie-vydavkov"
                placeholder="vyber alebo napíš vlastnú"
                value={uprava.kategoria}
                onChange={(e) => setUprava({ ...uprava, kategoria: e.target.value })}
              />
              <datalist id="kategorie-vydavkov">
                {(upravujemPrijem ? KATEGORIE_PRIJMOV : kategorie).map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            <div className="pole-siroke">
              <label>Popis *</label>
              <input
                autoFocus
                placeholder={upravujemPrijem ? 'napr. Prevod od brata' : 'napr. Nafta – cesta do Mníchova'}
                value={uprava.popis}
                onChange={(e) => setUprava({ ...uprava, popis: e.target.value })}
              />
            </div>
            {!upravujemPrijem && (
              <div>
                <label>Turnus</label>
                <select
                  value={uprava.tour_id}
                  onChange={(e) =>
                    setUprava({ ...uprava, tour_id: e.target.value, bezTurnusu: e.target.value === '' })
                  }
                >
                  <option value="">
                    {navrhnutyTurnus ? `automaticky: ${navrhnutyTurnus.nazov}` : '— bez turnusu —'}
                  </option>
                  {turnusy.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nazov}
                    </option>
                  ))}
                </select>
                <div className="napoveda">
                  {navrhnutyTurnus
                    ? `${skDatum(uprava.datum)} spadá do turnusu ${navrhnutyTurnus.nazov} — priradí sa naň sám.`
                    : 'Vďaka priradeniu k turnusu appka spočíta jeho reálny zisk.'}
                </div>
              </div>
            )}
            <div>
              <label>Platba</label>
              <select value={uprava.platba} onChange={(e) => setUprava({ ...uprava, platba: e.target.value as Platba })}>
                {(Object.keys(NAZVY_PLATIEB) as Platba[]).map((p) => (
                  <option key={p} value={p}>
                    {NAZVY_PLATIEB[p]}
                  </option>
                ))}
              </select>
            </div>
            {!upravujemPrijem && (
              <div style={{ alignSelf: 'end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text)' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={uprava.odpocitat}
                    onChange={(e) => setUprava({ ...uprava, odpocitat: e.target.checked })}
                  />
                  Daňovo uznateľný
                </label>
              </div>
            )}
            <div className="pole-siroke">
              <label>Poznámka</label>
              <input value={uprava.poznamka} onChange={(e) => setUprava({ ...uprava, poznamka: e.target.value })} />
            </div>
          </div>

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--ciara)' }}>
            <label>{upravujemPrijem ? 'Doklady (napr. výpis z banky)' : 'Doklady a bločky'}</label>
            {!uprava.id ? (
              <>
                {cakajuceSubory.length > 0 && (
                  <div style={{ margin: '8px 0' }}>
                    {cakajuceSubory.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                        <span className="typ-s-ikonou"><Ikona nazov="subor" velkost={15} /> {f.name}</span>
                        <span className="tlmene" style={{ fontSize: 12.5 }}>{velkostSuboru(f.size)}</span>
                        <button
                          className="ikonove maly holy"
                          onClick={() => setCakajuceSubory(cakajuceSubory.filter((_, j) => j !== i))}
                        >
                          <Ikona nazov="zavriet" velkost={14} hrubka={2} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <input
                  ref={vstupSuborov}
                  type="file"
                  multiple
                  accept="image/*,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    // Výdavok ešte neexistuje – doklady si podržíme a nahráme po uložení.
                    setCakajuceSubory([...cakajuceSubory, ...Array.from(e.target.files ?? [])])
                    if (vstupSuborov.current) vstupSuborov.current.value = ''
                  }}
                />
                <button style={{ marginTop: 6 }} onClick={() => vstupSuborov.current?.click()}>
                  + Pridať doklad
                </button>
                <div className="napoveda">
                  {cakajuceSubory.length
                    ? 'Doklady sa pripoja hneď po uložení.'
                    : 'Odfoť bloček alebo vyber PDF — pripne sa po uložení.'}
                </div>
              </>
            ) : (
              <>
                {prilohy.length > 0 && (
                  <div style={{ margin: '8px 0' }}>
                    {prilohy.map((p) => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                        <a className="typ-s-ikonou" href={`/api/vydavky/subory/${p.id}`} target="_blank" rel="noreferrer">
                          <Ikona nazov="subor" velkost={15} />
                          {p.nazov}
                        </a>
                        <span className="tlmene" style={{ fontSize: 12.5 }}>
                          {velkostSuboru(p.velkost)}
                        </span>
                        <button
                          className="ikonove maly holy zmazat"
                          title="Zmazať doklad"
                          onClick={async () => {
                            await api.del('/vydavky/subory/' + p.id)
                            setPrilohy(prilohy.filter((x) => x.id !== p.id))
                            nacitaj()
                          }}
                        >
                          <Ikona nazov="zmazat" velkost={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <input
                  ref={vstupSuborov}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => nahrajSubory(e.target.files)}
                />
                <button style={{ marginTop: 6 }} onClick={() => vstupSuborov.current?.click()} disabled={nahrava}>
                  {nahrava ? 'Nahrávam…' : '+ Pridať doklad'}
                </button>
              </>
            )}
          </div>

          <div className="riadok-akcii">
            <button onClick={() => setUprava(null)}>Zavrieť</button>
            <button className="primar" onClick={() => uloz(true)} disabled={!uprava.popis.trim()}>
              {uprava.id ? 'Uložiť zmeny' : 'Uložiť'}
            </button>
          </div>
        </div>
      )}

      <div className="filtre">
        <div className="hladanie">
          <label>Hľadať</label>
          <input
            placeholder={prijem ? 'popis, kategória…' : 'popis, kategória, turnus…'}
            value={f.hladat}
            onChange={(e) => setF({ ...f, hladat: e.target.value })}
          />
        </div>
        <div>
          <label>Od</label>
          <input type="date" value={f.od} onChange={(e) => setF({ ...f, od: e.target.value })} />
        </div>
        <div>
          <label>Do</label>
          <input type="date" value={f.do} onChange={(e) => setF({ ...f, do: e.target.value })} />
        </div>
        <div>
          <label>Kategória</label>
          <select value={f.kategoria} onChange={(e) => setF({ ...f, kategoria: e.target.value })}>
            <option value="">Všetky</option>
            {!prijem && (
              <optgroup label="Podľa dane">
                <option value={PODLA_DANE.uznatelne}>Len daňovo uznateľné</option>
                <option value={PODLA_DANE.neuznatelne}>Len neuznateľné</option>
              </optgroup>
            )}
            <optgroup label="Kategórie">
              {kategorie.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        {!prijem && (
          <div>
            <label>Turnus</label>
            <select value={f.turnus} onChange={(e) => setF({ ...f, turnus: e.target.value })}>
              <option value="">Všetky</option>
              {turnusy.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nazov}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="panel tesny">
        {!vydavky ? (
          <div className="nacitava">Načítavam…</div>
        ) : vydavky.length === 0 ? (
          <PrazdnyStav
            ikona={prijem ? 'zaloha' : 'vydavky'}
            ton={prijem ? 'tyrkys' : 'akcent'}
            nadpis={
              prijem
                ? 'Zatiaľ žiadne súkromné príjmy'
                : f.kategoria === PODLA_DANE.uznatelne
                  ? 'Žiadny daňovo uznateľný výdavok'
                  : f.kategoria === PODLA_DANE.neuznatelne
                    ? 'Žiadny neuznateľný výdavok'
                    : 'Za vybrané obdobie tu nič nie je'
            }
            text={
              prijem
                ? 'Peniaze, ktoré prišli na účet, ale nie sú príjmom z podnikania. Evidujú sa len preto, aby ti sedel výpis z banky.'
                : 'Zapíš výdavok aj s fotkou bločku — z fotky ti ho vie vyplniť aj AI pomocník.'
            }
            akcia={
              <button className="primar" onClick={otvorNovy}>
                {prijem ? '+ Nový súkromný príjem' : '+ Nový výdavok'}
              </button>
            }
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Dátum</th>
                <th>Popis</th>
                <th>Kategória</th>
                {!prijem && <th>Turnus</th>}
                <th>Doklad</th>
                <th className="cislo">Suma</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {vydavky.map((v) => (
                <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => otvorUpravu(v)}>
                  <td>{skDatum(v.datum)}</td>
                  <td>
                    <strong>{v.popis}</strong>
                    {v.druh === 'vydavok' && v.odpocitat === 0 && (
                      <span className="stitok koncept" style={{ marginLeft: 8 }}>
                        neuznateľný
                      </span>
                    )}
                  </td>
                  <td>
                    {v.kategoria ? (
                      <FarebnyCip ton={tonKategorie(v.kategoria)}>{v.kategoria}</FarebnyCip>
                    ) : (
                      <span className="tlmene">—</span>
                    )}
                  </td>
                  {!prijem && <td className="tlmene">{v.turnus_nazov || '—'}</td>}
                  <td className="tlmene">{v.pocet_priloh ? (
                    <span className="typ-s-ikonou ma-prilohu">
                      <Ikona nazov="priloha" velkost={14} /> {v.pocet_priloh}
                    </span>
                  ) : (
                    '—'
                  )}</td>
                  <td className="cislo">
                    {v.druh === 'prijem' ? (
                      <strong className="prijem-suma">+ {skSuma(v.suma)}</strong>
                    ) : (
                      <strong>{skSuma(v.suma)}</strong>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="akcie-riadku">
                      <button className="ikonove maly" title="Upraviť" aria-label="Upraviť" onClick={() => otvorUpravu(v)}>
                        <Ikona nazov="upravit" velkost={15} />
                      </button>
                      <button className="ikonove maly holy zmazat" title="Presunúť do koša" aria-label="Presunúť do koša" onClick={() => zmaz(v)}>
                        <Ikona nazov="zmazat" velkost={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {vydavky && vydavky.length > 0 && (
        <div className="tlmene" style={{ fontSize: 13 }}>
          {prijem ? (
            <>
              Spolu {pocet(vydavky.length, ['súkromný príjem', 'súkromné príjmy', 'súkromných príjmov'])} ·{' '}
              <strong>{skSuma(spolu)}</strong> — do dane nevstupuje
            </>
          ) : (
            <>
              Spolu {pocet(vydavky.length, ['výdavok', 'výdavky', 'výdavkov'])} · <strong>{skSuma(spolu)}</strong>
              {uznatelneVZozname !== spolu && <> · z toho uznateľných {skSuma(uznatelneVZozname)}</>}
            </>
          )}
        </div>
      )}
    </>
  )
}
