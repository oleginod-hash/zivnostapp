import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  api, dniDoSplatnosti, pocet, skDatum, skSuma, vetaORezerve, vratZKosa,
  type Faktura, type Firma, type PlatbaFaktury, type PoctyFaktur, type Suhrn, type Turnus,
} from '../api'
import { oznam, potvrd } from '../components/Oznamenia'
import { Ikona } from '../components/Ikony'
import { StitokStavu, StitokZalohy } from '../components/StitokStavu'
import { PrazdnyStav } from '../components/PrazdnyStav'

type Zalozka = '' | 'nevyplatene' | 'vyplatene' | 'zalohy'

const ZALOZKY: { kluc: Zalozka; text: string }[] = [
  { kluc: '', text: 'Všetky' },
  { kluc: 'nevyplatene', text: 'Neuhradené' },
  { kluc: 'vyplatene', text: 'Uhradené' },
  { kluc: 'zalohy', text: 'Zálohové faktúry' },
]

/**
 * Maličký odpočet vedľa splatnosti: koľko dní ešte zostáva, alebo o koľko
 * dní je faktúra po termíne. Pri už uhradených faktúrach nemá čo robiť –
 * tam už na termíne nezáleží.
 */
function Dni({ splatnost, otvorene }: { splatnost: string; otvorene: boolean }) {
  if (!otvorene) return null
  const d = dniDoSplatnosti(splatnost)
  if (d === null) return null
  if (d === 0) return <span className="dni dnes" title="Splatnosť je dnes">dnes</span>
  if (d > 0) {
    return (
      <span className="dni zostava" title={`Do splatnosti zostáva ${pocet(d, ['deň', 'dni', 'dní'])}`}>
        +{d} d
      </span>
    )
  }
  return (
    <span className="dni po" title={`Po splatnosti už ${pocet(-d, ['deň', 'dni', 'dní'])}`}>
      −{-d} d
    </span>
  )
}

export function Faktury() {
  const navigate = useNavigate()
  const [hladanieUrl, setHladanieUrl] = useSearchParams()
  const [faktury, setFaktury] = useState<Faktura[] | null>(null)
  const [pocty, setPocty] = useState<PoctyFaktur | null>(null)
  const [firmy, setFirmy] = useState<Firma[]>([])
  const [roky, setRoky] = useState<string[]>([])
  const [turnusy, setTurnusy] = useState<Turnus[]>([])
  const [chyba, setChyba] = useState('')
  const zalozka = (hladanieUrl.get('stav') ?? '') as Zalozka
  const [f, setF] = useState({ firma: '', turnus: '', rok: '', hladat: '' })

  function parametre(sKartou: boolean) {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v)
    if (sKartou && zalozka) q.set('stav', zalozka)
    return q
  }

  async function nacitaj() {
    try {
      setChyba('')
      const [zoznam, p] = await Promise.all([
        api.get<Faktura[]>('/faktury?' + parametre(true)),
        api.get<PoctyFaktur>('/faktury/pocty?' + parametre(false)),
      ])
      setFaktury(zoznam)
      setPocty(p)
    } catch (e: any) {
      setChyba(e.message)
    }
  }

  useEffect(() => {
    api.get<Firma[]>('/firmy').then(setFirmy).catch(() => {})
    api.get<Suhrn>('/faktury/suhrn').then((s) => setRoky(s.roky)).catch(() => {})
    api.get<Turnus[]>('/turnusy').then(setTurnusy).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(nacitaj, f.hladat ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, zalozka])

  // Záložka žije v adrese, aby sa dala poslať odkazom aj vrátiť cez „späť".
  function prepni(kluc: Zalozka) {
    if (kluc) setHladanieUrl({ stav: kluc })
    else setHladanieUrl({})
  }

  async function zmenStav(id: number, stav: string) {
    const fa = faktury?.find((x) => x.id === id)

    if (stav === 'vystavena') {
      const ano = await potvrd({
        nadpis: `Zrušiť úhradu faktúry ${fa?.cislo ?? ''}?`,
        text: 'Zapísané platby k nej sa odstránia. Hneď potom sa to ešte dá vrátiť.',
        potvrdit: 'Zrušiť úhradu',
        nebezpecne: true,
      })
      if (!ano) return
      // Platby si odložíme, aby sa dali vrátiť jedným kliknutím.
      const platby = await api.get<PlatbaFaktury[]>(`/faktury/${id}/platby`)
      await api.post(`/faktury/${id}/stav`, { stav })
      nacitaj()
      oznam(`Úhrada faktúry ${fa?.cislo ?? ''} je zrušená.`, {
        text: 'Vrátiť späť',
        sprav: async () => {
          for (const p of platby) await api.post(`/faktury/${id}/platby`, p)
          nacitaj()
        },
      })
      return
    }

    const r = await api.post<{ platba_id: number | null; odlozit?: number }>(`/faktury/${id}/stav`, { stav })
    nacitaj()
    if (stav === 'zaplatena') {
      oznam(
        `Faktúra ${fa?.cislo ?? ''} je označená ako uhradená.${vetaORezerve(r.odlozit)}`,
        r.platba_id
          ? {
              text: 'Vrátiť späť',
              sprav: async () => {
                await api.del(`/faktury/platby/${r.platba_id}`)
                nacitaj()
              },
            }
          : undefined,
      )
    }
  }

  async function zmaz(fa: Faktura) {
    // Bez otázky: faktúra ide do koša a dá sa hneď vrátiť.
    await api.del(`/faktury/${fa.id}`)
    nacitaj()
    oznam(`Faktúra ${fa.cislo} je v koši.`, {
      text: 'Vrátiť späť',
      sprav: async () => {
        await vratZKosa('invoices', fa.id)
        nacitaj()
      },
    })
  }

  // Súčty pod zoznamom. Koncept ešte nie je vyfakturovaný a zálohová faktúra
  // kryjúca starý dlh je len jeho splátkou – jej suma je už v pôvodnej faktúre.
  // V záložke zálohových faktúr sa naopak rátajú práve ony.
  const doSuctu =
    faktury?.filter((x) => x.stav !== 'koncept' && (zalozka === 'zalohy' || !x.kryje_id)) ?? []
  const fakturovanaSuma = doSuctu.reduce((s, x) => s + x.suma, 0)
  const dlznaSuma = doSuctu.reduce((s, x) => s + Math.max(0, x.otvoreny_zostatok), 0)

  return (
    <>
      <div className="hlavicka">
        <h1>Faktúry</h1>
        <div className="akcie">
          <Link className="tlacidlo primar" to="/faktury/nova">
            + Nová faktúra
          </Link>
        </div>
      </div>

      <div className="taby">
        {ZALOZKY.map((z) => (
          <button key={z.kluc} className={zalozka === z.kluc ? 'aktivny' : ''} onClick={() => prepni(z.kluc)}>
            {z.text}
            {pocty && <span className="pocet">{pocty[z.kluc || 'vsetky']}</span>}
          </button>
        ))}
      </div>

      {chyba && <div className="chyba">{chyba}</div>}

      <div className="filtre">
        <div className="hladanie">
          <label>Hľadať</label>
          <input
            placeholder="číslo faktúry, firma, poznámka…"
            value={f.hladat}
            onChange={(e) => setF({ ...f, hladat: e.target.value })}
          />
        </div>
        <div>
          <label>Firma</label>
          <select value={f.firma} onChange={(e) => setF({ ...f, firma: e.target.value })}>
            <option value="">Všetky</option>
            {firmy.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nazov}
              </option>
            ))}
          </select>
        </div>
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
        <div>
          <label>Rok vystavenia</label>
          <select value={f.rok} onChange={(e) => setF({ ...f, rok: e.target.value })}>
            <option value="">Všetky</option>
            {roky.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {zalozka === 'zalohy' && (
        <div className="napoveda" style={{ marginTop: -8, marginBottom: 12 }}>
          Zálohová faktúra s označením „splátka" spláca staršiu faktúru – jej suma sa do príjmov nepočíta
          druhýkrát, len znižuje dlh na pôvodnej faktúre.
        </div>
      )}

      <div className="panel tesny">
        {!faktury ? (
          <div className="nacitava">Načítavam…</div>
        ) : faktury.length === 0 ? (
          zalozka === 'nevyplatene' ? (
            <PrazdnyStav ikona="zaplatena" ton="pos" nadpis="Nikto ti nedlhuje" text="Všetky vystavené faktúry sú uhradené." />
          ) : zalozka === 'vyplatene' ? (
            <PrazdnyStav ikona="faktury" nadpis="Zatiaľ žiadna uhradená faktúra" text="Keď platba príde, faktúra sa presunie sem." />
          ) : zalozka === 'zalohy' ? (
            <PrazdnyStav
              ikona="zaloha"
              nadpis="Žiadne zálohové faktúry"
              text="Zálohovú faktúru vystavíš pri novej faktúre výberom typu dokladu. Môže slúžiť aj ako splátka staršej faktúry."
            />
          ) : (
            <PrazdnyStav
              ikona="faktury"
              ton="akcent"
              nadpis="Zatiaľ žiadne faktúry"
              text="Vystav prvú faktúru – číslo, dátumy aj splatnosť si appka doplní podľa Nastavení."
              akcia={
                <Link className="tlacidlo primar" to="/faktury/nova">
                  + Vystaviť prvú faktúru
                </Link>
              }
            />
          )
        ) : (
          // Tabuľka má veľa stĺpcov – keby sa na úzkom okne predsa nezmestila,
          // radšej sa posunie do strany, než by sa tlačidlá orezali.
          <div className="tabulka-obal">
            <table className="tabulka-faktur">
              <thead>
                <tr>
                  <th>Číslo</th>
                  <th>Odberateľ</th>
                  <th>Splatnosť</th>
                  <th className="cislo">Fakturované</th>
                  <th className="cislo">Prijaté</th>
                  <th className="cislo">Ešte dlhujú</th>
                  <th>Stav</th>
                  <th aria-label="Akcie"></th>
                </tr>
              </thead>
              <tbody>
                {faktury.map((fa) => {
                  const otvorene = fa.otvoreny_zostatok > 0.005
                  return (
                    <tr key={fa.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/faktury/${fa.id}`)}>
                      <td>
                        <span className="cislo-faktury">{fa.cislo}</span>
                        <span className="pod-textom">{skDatum(fa.datum_vystav)}</span>
                        {fa.typ === 'zaloha' && (
                          <>
                            <StitokZalohy />
                            {fa.kryje_cislo && <span className="pod-textom">splátka {fa.kryje_cislo}</span>}
                          </>
                        )}
                      </td>
                      <td className="odberatel">
                        <span className="odberatel-nazov">{fa.firma_nazov || <span className="tlmene">—</span>}</span>
                        {fa.turnus_nazov && <span className="pod-textom">{fa.turnus_nazov}</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {skDatum(fa.datum_splat)}
                        <Dni splatnost={fa.datum_splat} otvorene={otvorene && fa.stav !== 'koncept'} />
                      </td>
                      <td className="cislo">{skSuma(fa.suma)}</td>
                      <td className="cislo">
                        {fa.uhradene_spolu > 0.005 ? (
                          <span
                            className={fa.prijate_zalohami > 0.005 ? 'cez-zalohy' : undefined}
                            title={
                              fa.prijate_zalohami > 0.005
                                ? `Z toho ${skSuma(fa.prijate_zalohami)} prišlo cez zálohové faktúry`
                                : undefined
                            }
                          >
                            {skSuma(fa.uhradene_spolu)}
                          </span>
                        ) : (
                          <span className="tlmene">—</span>
                        )}
                      </td>
                      <td className="cislo">
                        {otvorene ? (
                          <span style={{ color: 'var(--neg)', fontWeight: 800 }}>{skSuma(fa.otvoreny_zostatok)}</span>
                        ) : fa.otvoreny_zostatok < -0.005 ? (
                          // Preplatok radšej ukážeme, než by mal ticho zapadnúť —
                          // buď ho treba vrátiť, alebo započítať na ďalšiu faktúru.
                          <span title="Prišlo viac, než bolo fakturované">
                            {skSuma(-fa.otvoreny_zostatok)}
                            <span className="pod-textom">preplatok</span>
                          </span>
                        ) : (
                          <span className="tlmene">—</span>
                        )}
                      </td>
                      <td>
                        <StitokStavu stav={fa.stav_zobraz} kratko />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="akcie-riadku">
                          {otvorene ? (
                            <button
                              className="maly vyplatit"
                              title={`Zapíše doplatok ${skSuma(fa.otvoreny_zostatok)} s dnešným dátumom`}
                              onClick={() => zmenStav(fa.id, 'zaplatena')}
                            >
                              Uhradená
                            </button>
                          ) : (
                            <button
                              className="ikonove maly holy"
                              title="Zrušiť úhradu – odstráni zapísané platby"
                              aria-label="Zrušiť úhradu"
                              onClick={() => zmenStav(fa.id, 'vystavena')}
                            >
                              <Ikona nazov="vratit" velkost={14} hrubka={2} />
                            </button>
                          )}
                          <a
                            className="tlacidlo ikonove maly"
                            href={`/api/faktury/${fa.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            title="Otvoriť PDF"
                            aria-label="Otvoriť PDF"
                          >
                            <Ikona nazov="pdf" velkost={15} />
                          </a>
                          <span className="oddelovac-akcii" aria-hidden="true" />
                          <button
                            className="ikonove maly holy zmazat"
                            title="Presunúť do koša"
                            aria-label="Presunúť do koša"
                            onClick={() => zmaz(fa)}
                          >
                            <Ikona nazov="zmazat" velkost={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {faktury && faktury.length > 0 && (
        <div className="tlmene" style={{ fontSize: 13 }}>
          {pocet(faktury.length, ['faktúra', 'faktúry', 'faktúr'])} ·{' '}
          fakturované {skSuma(fakturovanaSuma)}
          {dlznaSuma > 0.005 && (
            <>
              {' '}
              · ešte čaká <strong>{skSuma(dlznaSuma)}</strong>
            </>
          )}
        </div>
      )}
    </>
  )
}
