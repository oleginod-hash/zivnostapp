import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { OdoslatMail } from '../components/OdoslatMail'
import { api, pocet, skDatum, skSuma, type PoSplatnosti, type StavMailu } from '../api'
import { Ikona } from '../components/Ikony'
import { FirmaSAvatarom, Karticka } from '../components/Farby'
import { oznam } from '../components/Oznamenia'
import { PrazdnyStav } from '../components/PrazdnyStav'

export function Upomienky() {
  const [faktury, setFaktury] = useState<PoSplatnosti[] | null>(null)
  const [stavMailu, setStavMailu] = useState<StavMailu | null>(null)
  const [posielam, setPosielam] = useState<number | null>(null)
  const [chyba, setChyba] = useState('')

  function nacitaj() {
    api.get<PoSplatnosti[]>('/mail/po-splatnosti').then(setFaktury).catch((e) => setChyba(e.message))
  }

  useEffect(() => {
    nacitaj()
    api.get<StavMailu>('/mail/stav').then(setStavMailu).catch(() => {})
  }, [])

  async function oznacZaplatenu(f: PoSplatnosti) {
    const r = await api.post<{ platba_id: number | null }>(`/faktury/${f.id}/stav`, { stav: 'zaplatena' })
    nacitaj()
    oznam(
      `Faktúra ${f.cislo}: zapísaná platba ${skSuma(f.otvoreny_zostatok)}.`,
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

  const spolu = faktury?.reduce((s, f) => s + f.otvoreny_zostatok, 0) ?? 0

  return (
    <>
      <div className="hlavicka">
        <h1>Upomienky</h1>
      </div>

      {chyba && <div className="chyba">{chyba}</div>}

      {stavMailu && !stavMailu.nastavene && (
        <div className="info-pruh">
          Odosielanie mailov ešte nie je nastavené — texty upomienok si zatiaľ vieš aspoň skopírovať.
          Na priame odosielanie doplň SMTP údaje do súboru <code>.env</code>.
        </div>
      )}

      {faktury && faktury.length > 0 && (
        <div className="karty kompaktne">
          <Karticka
            ikona="pozor"
            ton="neg"
            farebnaHodnota
            popis={`Po splatnosti spolu · ${pocet(faktury.length, ['faktúra', 'faktúry', 'faktúr'])}`}
            hodnota={skSuma(spolu)}
          />
          <Karticka
            ikona="hodiny"
            ton="warn"
            popis="Najdlhšie čaká"
            hodnota={pocet(Math.max(...faktury.map((f) => f.dni_po_splatnosti)), ['deň', 'dni', 'dní'])}
          />
        </div>
      )}

      <div className="panel tesny">
        {!faktury ? (
          <div className="nacitava">Načítavam…</div>
        ) : faktury.length === 0 ? (
          <PrazdnyStav
            ikona="zaplatena"
            ton="pos"
            nadpis="Nikto ti nedlhuje"
            text="Všetky faktúry sú uhradené včas. Keď sa niektorá dostane po splatnosti, objaví sa tu aj s textom upomienky."
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Faktúra</th>
                <th>Odberateľ</th>
                <th>Splatnosť</th>
                <th className="cislo">Suma</th>
                <th style={{ width: 260 }}></th>
              </tr>
            </thead>
            <tbody>
              {faktury.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link to={'/faktury/' + f.id}>
                      <strong>{f.cislo}</strong>
                    </Link>
                  </td>
                  <td>
                    <FirmaSAvatarom
                      nazov={f.firma_nazov}
                      pod={!f.firma_email && <span className="tlmene">bez e-mailu</span>}
                    />
                  </td>
                  <td>
                    {skDatum(f.datum_splat)}
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--cervena)' }}>
                      {pocet(f.dni_po_splatnosti, ['deň', 'dni', 'dní'])} po termíne
                    </div>
                  </td>
                  <td className="cislo">
                    <strong>{skSuma(f.otvoreny_zostatok)}</strong>
                    {f.otvoreny_zostatok < f.suma - 0.005 && (
                      <div className="tlmene" style={{ fontSize: 12.5 }}>
                        z {skSuma(f.suma)}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="maly primar" onClick={() => setPosielam(f.id)}>
                      Poslať upomienku
                    </button>{' '}
                    <button className="maly" onClick={() => oznacZaplatenu(f)}>
                      <Ikona nazov="zaplatena" velkost={14} hrubka={2.2} />
                      Zaplatená
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {posielam !== null && (
        <OdoslatMail
          invoiceId={posielam}
          typ="upomienka"
          zavriet={() => setPosielam(null)}
          poOdoslani={nacitaj}
        />
      )}
    </>
  )
}
