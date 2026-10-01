import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, pocet, skSuma, type Sablona } from '../api'
import { Okno } from './Okno'
import { oznam, oznamChybu, zadajText } from './Oznamenia'
import { PrazdnyStav } from './PrazdnyStav'
import { ZaznamRiadok } from './Zoznam'

/**
 * Všetky uložené šablóny faktúr na jednom mieste: z každej sa dá rovno vystaviť
 * faktúra, premenovať ju alebo zmazať (s „Vrátiť späť" – do koša šablóny nechodia).
 */
export function OknoSablon({ zavriet }: { zavriet: () => void }) {
  const navigate = useNavigate()
  const [sablony, setSablony] = useState<Sablona[] | null>(null)

  function nacitaj() {
    api.get<Sablona[]>('/sablony').then(setSablony).catch((e) => oznamChybu(e.message))
  }
  useEffect(nacitaj, [])

  async function premenuj(s: Sablona) {
    const nazov = await zadajText({
      nadpis: 'Premenovať šablónu',
      pole: { popis: 'Názov šablóny', hodnota: s.nazov },
      potvrdit: 'Uložiť',
    })
    if (!nazov || nazov === s.nazov) return
    try {
      await api.put('/sablony/' + s.id, { ...s, nazov })
      nacitaj()
    } catch (e: any) {
      oznamChybu(e.message)
    }
  }

  async function zmaz(s: Sablona) {
    try {
      await api.del('/sablony/' + s.id)
      nacitaj()
      oznam(`Šablóna „${s.nazov}" je zmazaná.`, {
        text: 'Vrátiť späť',
        sprav: async () => {
          await api.post('/sablony', s)
          nacitaj()
        },
      })
    } catch (e: any) {
      oznamChybu(e.message)
    }
  }

  return (
    <Okno nadpis="Šablóny faktúr" zavriet={zavriet} trieda="okno-udajov okno-sablon">
      <p className="dialog-text">
        Šablóna si pamätá odberateľa, položky a poznámku – dátumy a číslo dostane nová faktúra vždy nanovo.
        Novú šablónu uložíš z otvorenej faktúry cez „Uložiť ako šablónu".
      </p>
      {!sablony ? (
        <div className="nacitava">Načítavam…</div>
      ) : sablony.length === 0 ? (
        <PrazdnyStav
          ikona="faktury"
          nadpis="Zatiaľ žiadne šablóny"
          text={'Otvor faktúru, ktorú vystavuješ pravidelne, a v ponuke zvoľ „Uložiť ako šablónu".'}
        />
      ) : (
        <div className="zoznam-zaznamov zoznam-sablon">
          {sablony.map((s) => {
            const spolu = s.polozky.reduce((a, p) => a + (Number(p.mnozstvo) || 0) * (Number(p.cena) || 0), 0)
            return (
              <ZaznamRiadok
                key={s.id}
                className="sablona-riadok"
                hore={<span className="zaznam-datum">{pocet(s.polozky.length, ['položka', 'položky', 'položiek'])}</span>}
                popisAkcii={`Akcie šablóny ${s.nazov}`}
                akcie={[
                  { text: 'Premenovať', ikona: 'upravit', sprav: () => premenuj(s) },
                  { text: 'Zmazať šablónu', ikona: 'zmazat', nebezpecne: true, sprav: () => zmaz(s) },
                ]}
                hlavny={
                  <>
                    {s.nazov}
                    {s.firma_nazov && <span className="pod-textom">{s.firma_nazov}</span>}
                  </>
                }
                suma={spolu > 0 ? <strong>{skSuma(spolu)}</strong> : undefined}
                pata={
                  <button
                    className="primar"
                    onClick={() => {
                      zavriet()
                      navigate('/faktury/nova?sablona=' + s.id)
                    }}
                  >
                    Vystaviť faktúru
                  </button>
                }
              />
            )
          })}
        </div>
      )}
      <div className="riadok-akcii">
        <button onClick={zavriet}>Zavrieť</button>
      </div>
    </Okno>
  )
}
