import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  api, pocet, skDatum, vratZKosa, NAZVY_STAVOV_ZMLUV, type Firma, type SuhrnZmluv, type Zmluva,
} from '../api'
import { Ikona } from '../components/Ikony'
import { FarebnyCip, FirmaSAvatarom, tonPreText } from '../components/Farby'
import { oznam } from '../components/Oznamenia'
import { PrazdnyStav } from '../components/PrazdnyStav'
import { FiltreZoznamu, HladanieSFiltrom, ZaznamRiadok } from '../components/Zoznam'
import { useMaleOkno } from '../maleOkno'

/** Štítok stavu zmluvy – vypršaná má prednosť pred uloženým stavom. */
function StitokZmluvy({ z }: { z: Zmluva }) {
  const trieda =
    z.expiracia === 'po_expiracii'
      ? 'po_splatnosti'
      : z.stav === 'aktivna'
        ? 'zaplatena'
        : z.stav === 'navrh'
          ? 'vystavena'
          : 'koncept'
  return <span className={'stitok ' + trieda}>{z.expiracia === 'po_expiracii' ? 'Vypršala' : NAZVY_STAVOV_ZMLUV[z.stav]}</span>
}

/** Krátko, koľko zostáva do konca platnosti (alebo odkedy vypršala). */
function DoKonca({ z }: { z: Zmluva }) {
  const d = z.dni_do_konca
  if (z.expiracia === 'po_expiracii') return <span className="chyba-text">vypršala {d !== null ? `pred ${Math.abs(d)} dňami` : ''}</span>
  if (z.expiracia === 'coskoro') return <span className="chyba-fakturacie">{d === 0 ? 'končí dnes' : `končí o ${d} dní`}</span>
  return null
}

/** Textový popis toho, ako blízko je koniec platnosti. */
function Platnost({ z }: { z: Zmluva }) {
  if (!z.platnost_do) return <span className="tlmene">na neurčito</span>
  const d = z.dni_do_konca
  return (
    <>
      {skDatum(z.platnost_do)}
      {z.expiracia === 'po_expiracii' && (
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cervena)' }}>
          vypršala {d !== null ? `pred ${Math.abs(d)} dňami` : ''}
        </div>
      )}
      {z.expiracia === 'coskoro' && (
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--oranzova)' }}>
          {d === 0 ? 'končí dnes' : `o ${d} dní`}
        </div>
      )}
    </>
  )
}

export function Zmluvy() {
  const navigate = useNavigate()
  const [zmluvy, setZmluvy] = useState<Zmluva[] | null>(null)
  const [firmy, setFirmy] = useState<Firma[]>([])
  const [suhrn, setSuhrn] = useState<SuhrnZmluv | null>(null)
  const [chyba, setChyba] = useState('')
  const [f, setF] = useState({ stav: '', firma: '', kategoria: '', hladat: '' })
  const male = useMaleOkno()
  /** Na telefóne sú výbery stavu, kategórie a firmy schované pod tlačidlom Filter. */
  const [filtreOtvorene, setFiltreOtvorene] = useState(false)
  const aktivnychFiltrov = [f.stav, f.kategoria, f.firma].filter(Boolean).length

  function nacitaj() {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v)
    api.get<Zmluva[]>('/zmluvy?' + q).then(setZmluvy).catch((e) => setChyba(e.message))
    api.get<SuhrnZmluv>('/zmluvy/suhrn').then(setSuhrn).catch(() => {})
  }

  useEffect(() => {
    api.get<Firma[]>('/firmy').then(setFirmy).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(nacitaj, f.hladat ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f])

  async function zmaz(z: Zmluva) {
    await api.del('/zmluvy/' + z.id)
    nacitaj()
    oznam(`Zmluva „${z.nazov}" je v koši aj s prílohami.`, {
      text: 'Vrátiť späť',
      sprav: async () => {
        await vratZKosa('contracts', z.id)
        nacitaj()
      },
    })
  }

  return (
    <>
      <div className="hlavicka">
        <h1>Zmluvy</h1>
        <div className="akcie">
          <Link className="tlacidlo primar" to="/zmluvy/nova">
            + Nová zmluva
          </Link>
        </div>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}

      {suhrn && (suhrn.po_expiracii > 0 || suhrn.coskoro > 0) && (
        <div className="info-pruh">
          {suhrn.po_expiracii > 0 && (
            <strong>
              {pocet(suhrn.po_expiracii, ['zmluve', 'zmluvám', 'zmluvám'])} vypršala platnosť.{' '}
            </strong>
          )}
          {suhrn.coskoro > 0 && <>Ďalším {suhrn.coskoro} sa blíži koniec platnosti.</>}
        </div>
      )}

      <FiltreZoznamu
        male={male}
        otvorene={filtreOtvorene}
        hladanie={
          <HladanieSFiltrom
            id="hladat-zmluvy"
            hodnota={f.hladat}
            zmen={(hladat) => setF({ ...f, hladat })}
            placeholder="názov, číslo zmluvy, firma, poznámka…"
            male={male}
            aktivnych={aktivnychFiltrov}
            otvorene={filtreOtvorene}
            prepni={() => setFiltreOtvorene(!filtreOtvorene)}
          />
        }
      >
        <div>
          <label>Stav</label>
          <select value={f.stav} onChange={(e) => setF({ ...f, stav: e.target.value })}>
            <option value="">Všetky</option>
            <option value="navrh">Návrh</option>
            <option value="aktivna">Aktívna</option>
            <option value="ukoncena">Ukončená</option>
          </select>
        </div>
        <div>
          <label>Kategória</label>
          <select value={f.kategoria} onChange={(e) => setF({ ...f, kategoria: e.target.value })}>
            <option value="">Všetky</option>
            {suhrn?.kategorie.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
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
      </FiltreZoznamu>

      <div className={male && zmluvy?.length ? 'zoznam-zaznamov' : 'panel tesny'}>
        {!zmluvy ? (
          <div className="nacitava">Načítavam…</div>
        ) : zmluvy.length === 0 ? (
          <PrazdnyStav
            ikona="zmluvy"
            ton="fialova"
            nadpis="Zatiaľ žiadne zmluvy"
            text="Ulož sem zmluvy aj s ich skenmi. Appka ťa upozorní, keď sa bude blížiť koniec platnosti."
            akcia={
              <Link className="tlacidlo primar" to="/zmluvy/nova">
                + Pridať prvú zmluvu
              </Link>
            }
          />
        ) : male ? (
          zmluvy.map((z) => (
            <ZaznamRiadok
              key={z.id}
              className="zmluva-riadok"
              tlmeny={z.stav === 'ukoncena'}
              otvor={() => navigate('/zmluvy/' + z.id)}
              hore={
                <>
                  <span className="zaznam-datum">{z.platnost_do ? `platí do ${skDatum(z.platnost_do)}` : 'na neurčito'}</span>
                  {z.cislo_zmluvy && <span className="zaznam-id">č. {z.cislo_zmluvy}</span>}
                </>
              }
              popisAkcii={`Akcie zmluvy ${z.nazov}`}
              akcie={[{ text: 'Presunúť do koša', ikona: 'zmazat', nebezpecne: true, sprav: () => zmaz(z) }]}
              hlavny={
                <>
                  {z.nazov}
                  {z.firma_nazov && <span className="pod-textom">{z.firma_nazov}</span>}
                </>
              }
              dole={
                <>
                  <StitokZmluvy z={z} />
                  <DoKonca z={z} />
                  {z.kategoria && <FarebnyCip ton={tonPreText(z.kategoria)}>{z.kategoria}</FarebnyCip>}
                  {!!z.pocet_priloh && (
                    <span className="typ-s-ikonou" aria-label={pocet(z.pocet_priloh, ['príloha', 'prílohy', 'príloh'])}>
                      <Ikona nazov="priloha" velkost={14} /> {z.pocet_priloh}
                    </span>
                  )}
                </>
              }
            />
          ))
        ) : (
          <table>
            <thead>
              <tr>
                <th>Názov</th>
                <th>Firma</th>
                <th>Kategória</th>
                <th>Platnosť do</th>
                <th>Prílohy</th>
                <th>Stav</th>
                <th style={{ width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {zmluvy.map((z) => (
                <tr
                  key={z.id}
                  style={{ cursor: 'pointer', opacity: z.stav === 'ukoncena' ? 0.55 : 1 }}
                  onClick={() => navigate('/zmluvy/' + z.id)}
                >
                  <td>
                    <strong>{z.nazov}</strong>
                    {z.cislo_zmluvy && <div className="tlmene" style={{ fontSize: 13 }}>č. {z.cislo_zmluvy}</div>}
                  </td>
                  <td>
                    <FirmaSAvatarom nazov={z.firma_nazov} />
                  </td>
                  <td>
                    {z.kategoria ? (
                      <FarebnyCip ton={tonPreText(z.kategoria)}>{z.kategoria}</FarebnyCip>
                    ) : (
                      <span className="tlmene">—</span>
                    )}
                  </td>
                  <td>
                    <Platnost z={z} />
                  </td>
                  <td className="tlmene">{z.pocet_priloh ? (
                    <span className="typ-s-ikonou">
                      <Ikona nazov="priloha" velkost={14} /> {z.pocet_priloh}
                    </span>
                  ) : (
                    '—'
                  )}</td>
                  <td>
                    <StitokZmluvy z={z} />
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                    <button className="ikonove maly holy zmazat" title="Zmazať" onClick={() => zmaz(z)}>
                      <Ikona nazov="zmazat" velkost={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
