import { useEffect, useState } from 'react'
import {
  api, pocet, skDatum, skSuma, NAZVY_STAVOV, NAZVY_PLATIEB,
  type DanovyPodklad as TPodklad,
} from '../api'
import { StitokZalohy } from '../components/StitokStavu'
import { Karticka } from '../components/Farby'

const NAZVY_MESIACOV = [
  'Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún',
  'Júl', 'August', 'September', 'Október', 'November', 'December',
]

/** Číslo do CSV: slovenská desatinná čiarka, vždy dve miesta. */
function csvCislo(n: number): string {
  return (Math.round((n ?? 0) * 100) / 100).toFixed(2).replace('.', ',')
}

/** Dátum do CSV: slovenský formát, ktorý Excel rozpozná ako dátum. */
function csvDatum(iso: string | null | undefined): string {
  if (!iso) return ''
  const [r, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${r}`
}

/** Podklad pre účtovníčku – všetko za rok na jednom mieste, pripravené na tlač. */
export function DanovyPodklad() {
  const [roky, setRoky] = useState<string[]>([])
  const [rok, setRok] = useState(String(new Date().getFullYear() - 1))
  const [d, setD] = useState<TPodklad | null>(null)
  const [chyba, setChyba] = useState('')

  useEffect(() => {
    api
      .get<string[]>('/financie/roky')
      .then((r) => {
        setRoky(r)
        // Podklad sa robí spätne, takže predvolíme minulý rok, ak preň dáta sú.
        const minuly = String(new Date().getFullYear() - 1)
        setRok(r.includes(minuly) ? minuly : (r[0] ?? String(new Date().getFullYear())))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    api.get<TPodklad>('/danovy-podklad?rok=' + rok).then(setD).catch((e) => setChyba(e.message))
  }, [rok])

  function stiahnutCsv() {
    if (!d) return
    const riadky: string[][] = [
      ['PODKLAD PRE DAŇOVÉ PRIZNANIE', d.rok],
      ['Zostavené', csvDatum(d.zostavene)],
      [],
      ['Živnostník', d.zivnostnik.meno],
      ['IČO', d.zivnostnik.ico],
      ['DIČ', d.zivnostnik.dic],
      [],
      ['Príjmy (peniaze prijaté v roku)', csvCislo(d.prijmy.suma)],
      ['Uznateľné výdavky', csvCislo(d.vydavky.uznatelne)],
      ['Rozdiel (príjmy − uznateľné výdavky)', csvCislo(d.zaklad_dane)],
      ['Neuznateľné výdavky', csvCislo(d.vydavky.neuznatelne)],
      [`Nezaplatené faktúry k 31.12.${d.rok}`, csvCislo(d.nezaplatene.suma)],
      ['Súkromné príjmy (mimo podnikania, do dane nevstupujú)', csvCislo(d.sukromne_prijmy.suma)],
      [],
      ['PRÍJMY PO MESIACOCH'],
      ['Mesiac', 'Prijaté', 'Počet platieb'],
      ...d.platby_po_mesiacoch.map((m) => [
        NAZVY_MESIACOV[Number(m.mesiac) - 1] ?? m.mesiac,
        csvCislo(m.suma),
        String(m.pocet),
      ]),
      ['Spolu', csvCislo(d.prijmy.suma), String(d.prijmy.pocet_platieb)],
      [],
      ['VÝDAVKY PODĽA KATEGÓRIÍ'],
      ['Kategória', 'Spolu', 'Z toho uznateľné', 'Počet'],
      ...d.vydavky.podlaKategorii.map((k) => [
        k.kategoria,
        csvCislo(k.suma),
        csvCislo(k.uznatelne),
        String(k.pocet),
      ]),
      [],
      ['FAKTÚRY'],
      ['Číslo', 'Typ', 'Odberateľ', 'Vystavená', 'Splatnosť', 'Fakturovaná suma',
        `Prijaté v roku ${d.rok}`, 'Dátum poslednej platby', 'Ešte neuhradené', 'Stav', 'Kryje faktúru'],
      ...d.faktury.map((f) => [
        f.cislo,
        f.typ === 'zaloha' ? 'Zálohová' : 'Faktúra',
        f.firma ?? '',
        csvDatum(f.datum_vystav),
        csvDatum(f.datum_splat),
        csvCislo(f.suma),
        csvCislo(f.prijate_v_roku),
        csvDatum(f.datum_uhrady),
        csvCislo(Math.max(0, f.otvoreny_zostatok)),
        NAZVY_STAVOV[f.stav_zobraz] ?? f.stav_zobraz,
        f.kryje_cislo ?? '',
      ]),
      [],
      ['PLATBY (zdroj sumy príjmov)'],
      ['Dátum', 'Faktúra', 'Typ', 'Odberateľ', 'Suma', 'Kryje faktúru', 'Poznámka'],
      ...d.platby.map((p) => [
        csvDatum(p.datum),
        p.cislo,
        p.typ === 'zaloha' ? 'Zálohová' : 'Faktúra',
        p.firma ?? '',
        csvCislo(p.suma),
        p.kryje_cislo ?? '',
        p.poznamka ?? '',
      ]),
      ['Spolu', '', '', '', csvCislo(d.prijmy.suma)],
      [],
      ['VÝDAVKY – ROZPIS'],
      ['Dátum', 'Popis', 'Kategória', 'Suma', 'Daňovo uznateľný', 'Platba', 'Turnus', 'Doklad'],
      ...d.vydavky.rozpis.map((v) => [
        csvDatum(v.datum),
        v.popis,
        v.kategoria,
        csvCislo(v.suma),
        v.odpocitat ? 'áno' : 'nie',
        NAZVY_PLATIEB[v.platba] ?? v.platba,
        v.turnus ?? '',
        v.pocet_dokladov ? `${v.pocet_dokladov}× priložený` : 'chýba',
      ]),
      ...(d.sukromne_prijmy.polozky.length
        ? [
            [],
            ['SÚKROMNÉ PRÍJMY – NIE SÚ PRÍJMOM Z PODNIKANIA'],
            ['Dátum', 'Popis', 'Kategória', 'Suma', 'Platba'],
            ...d.sukromne_prijmy.polozky.map((p) => [
              csvDatum(p.datum),
              p.popis,
              p.kategoria,
              csvCislo(p.suma),
              NAZVY_PLATIEB[p.platba] ?? p.platba,
            ]),
          ]
        : []),
      [],
      ['TURNUSY'],
      ['Názov', 'Firma', 'Krajina', 'Od', 'Do', 'Dní'],
      ...d.turnusy.map((t) => [
        t.nazov,
        t.firma ?? '',
        t.krajina,
        csvDatum(t.datum_od),
        csvDatum(t.datum_do),
        String(t.dni),
      ]),
      [],
      ['DNI V KRAJINÁCH'],
      ...d.dni_v_krajinach.map((k) => [k.krajina, String(k.dni)]),
    ]

    // Bodkočiarka a BOM, aby to slovenský Excel otvoril správne.
    const csv = '﻿' + riadky.map((r) => r.map((b) => `"${String(b).replace(/"/g, '""')}"`).join(';')).join('\n')
    const odkaz = document.createElement('a')
    odkaz.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    odkaz.download = `Danovy-podklad-${d.rok}.csv`
    odkaz.click()
    URL.revokeObjectURL(odkaz.href)
  }

  if (chyba) return <div className="chyba">{chyba}</div>
  if (!d) return <div className="nacitava">Načítavam…</div>

  const prijateSpoluZFaktur = d.faktury.reduce((s, f) => s + f.prijate_v_roku, 0)

  return (
    <>
      <div className="hlavicka">
        <h1>Podklad pre daňové priznanie</h1>
        <div className="akcie">
          <select value={rok} onChange={(e) => setRok(e.target.value)} style={{ width: 'auto' }}>
            {roky.map((r) => (
              <option key={r} value={r}>
                Rok {r}
              </option>
            ))}
          </select>
          <a className="tlacidlo primar" href={`/api/danovy-podklad/xlsx?rok=${d.rok}`}>
            Stiahnuť Excel pre účtovníčku
          </a>
          <button onClick={stiahnutCsv}>CSV</button>
          <button onClick={() => window.print()}>Vytlačiť</button>
        </div>
      </div>

      <div className="info-pruh netlacit">
        Toto je súhrn tvojej evidencie, nie vypočítané daňové priznanie. Skutočný základ dane závisí od toho,
        či použiješ paušálne alebo skutočné výdavky, od odvodov a ďalších vecí, ktoré appka nepozná —
        to posúdi účtovníčka. Excel má samostatný hárok na súhrn, faktúry, platby, výdavky aj turnusy.
      </div>

      <div className="karty kompaktne">
        <Karticka
          ikona="hore"
          ton="pos"
          farebnaHodnota
          popis={`Príjmy (prijaté v roku ${d.rok})`}
          hodnota={skSuma(d.prijmy.suma)}
          pod={`${pocet(d.prijmy.pocet_platieb, ['platba', 'platby', 'platieb'])} na ${pocet(d.prijmy.pocet, ['faktúre', 'faktúrach', 'faktúrach'])}`}
        />
        <Karticka
          ikona="dole"
          ton="warn"
          popis="Uznateľné výdavky"
          hodnota={skSuma(d.vydavky.uznatelne)}
          pod={`neuznateľné ${skSuma(d.vydavky.neuznatelne)}`}
        />
        <Karticka
          ikona="penazenka"
          ton="akcent"
          popis="Rozdiel"
          hodnota={skSuma(d.zaklad_dane)}
          pod="pred paušálom a odvodmi"
        />
        <Karticka
          ikona="pozor"
          ton="neg"
          farebnaHodnota
          popis="Nezaplatené k 31.12."
          hodnota={skSuma(d.nezaplatene.suma)}
          pod="príjmom sa stanú, až keď peniaze prídu"
        />
      </div>

      {d.sukromne_prijmy.suma > 0 && (
        <div className="info-pruh">
          Súkromné príjmy za rok {d.rok}: <strong>{skSuma(d.sukromne_prijmy.suma)}</strong> v{' '}
          {pocet(d.sukromne_prijmy.pocet, ['položke', 'položkách', 'položkách'])}. Do príjmov z podnikania ani
          do základu dane sa nerátajú — v Exceli sú na vlastnom hárku, aby ich účtovníčka nezamenila s tržbou.
        </div>
      )}

      <div className="panel">
        <h2>Príjmy po mesiacoch</h2>
        {d.platby_po_mesiacoch.length === 0 ? (
          <p className="tlmene">Za rok {d.rok} neprišla žiadna platba.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Mesiac</th>
                <th className="cislo">Prijaté</th>
                <th className="cislo">Počet platieb</th>
              </tr>
            </thead>
            <tbody>
              {d.platby_po_mesiacoch.map((m) => (
                <tr key={m.mesiac}>
                  <td>{NAZVY_MESIACOV[Number(m.mesiac) - 1] ?? m.mesiac}</td>
                  <td className="cislo">{skSuma(m.suma)}</td>
                  <td className="cislo tlmene">{m.pocet}×</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Spolu</strong>
                </td>
                <td className="cislo">
                  <strong>{skSuma(d.prijmy.suma)}</strong>
                </td>
                <td className="cislo tlmene">{d.prijmy.pocet_platieb}×</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Kategórie výdavkov a dni v zahraničí patria vedľa seba – kategórie
          potrebujú štyri stĺpce, dni len dva, takže delíme nerovnomerne. */}
      <div className="dva-stlpce nerovnomerne">
        <div className="panel">
          <h2>Výdavky podľa kategórií</h2>
          <table>
            <thead>
              <tr>
                <th>Kategória</th>
                <th className="cislo">Spolu</th>
                <th className="cislo">Z toho uznateľné</th>
                <th className="cislo">Počet</th>
              </tr>
            </thead>
            <tbody>
              {d.vydavky.podlaKategorii.map((k) => (
                <tr key={k.kategoria}>
                  <td>{k.kategoria}</td>
                  <td className="cislo">{skSuma(k.suma)}</td>
                  <td className="cislo">{skSuma(k.uznatelne)}</td>
                  <td className="cislo tlmene">{k.pocet}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Dni strávené v zahraničí</h2>
          {d.dni_v_krajinach.length === 0 ? (
            <p className="tlmene">Za rok {d.rok} nemáš evidované turnusy.</p>
          ) : (
            <table>
              <tbody>
                {d.dni_v_krajinach.map((k) => (
                  <tr key={k.krajina}>
                    <td>{k.krajina}</td>
                    <td className="cislo">
                      <strong>{pocet(k.dni, ['deň', 'dni', 'dní'])}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="panel tesny">
        <div style={{ padding: '16px 20px 0' }}>
          <h2 style={{ margin: 0 }}>Faktúry ({d.faktury.length})</h2>
          <div className="napoveda" style={{ marginTop: 4 }}>
            Do príjmu ide stĺpec „Prijaté v roku", nie fakturovaná suma — peniaze mohli prísť aj v inom roku.
          </div>
        </div>
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Číslo</th>
              <th>Odberateľ</th>
              <th>Vystavená</th>
              <th className="cislo">Fakturované</th>
              <th className="cislo">Prijaté v roku {d.rok}</th>
              <th>Posledná platba</th>
              <th>Stav</th>
            </tr>
          </thead>
          <tbody>
            {d.faktury.map((f) => (
              <tr key={f.cislo}>
                <td>
                  <strong>{f.cislo}</strong>
                  {f.typ === 'zaloha' && (
                    <div>
                      <StitokZalohy />
                      {f.kryje_cislo && (
                        <span className="tlmene" style={{ fontSize: 12.5 }}> kryje {f.kryje_cislo}</span>
                      )}
                    </div>
                  )}
                </td>
                <td>{f.firma ?? '—'}</td>
                <td>{skDatum(f.datum_vystav)}</td>
                <td className="cislo">{skSuma(f.suma)}</td>
                <td className="cislo">
                  {f.prijate_v_roku > 0.005 ? (
                    <strong>{skSuma(f.prijate_v_roku)}</strong>
                  ) : (
                    <span className="tlmene">—</span>
                  )}
                </td>
                <td>{f.datum_uhrady ? skDatum(f.datum_uhrady) : <span className="tlmene">—</span>}</td>
                <td className="tlmene">{NAZVY_STAVOV[f.stav_zobraz] ?? f.stav_zobraz}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={4}>
                <strong>Prijaté spolu za rok {d.rok}</strong>
              </td>
              <td className="cislo">
                <strong>{skSuma(prijateSpoluZFaktur)}</strong>
              </td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="panel tesny">
        <div style={{ padding: '16px 20px 0' }}>
          <h2 style={{ margin: 0 }}>Turnusy ({d.turnusy.length})</h2>
        </div>
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Turnus</th>
              <th>Firma</th>
              <th>Miesto</th>
              <th>Obdobie</th>
              <th className="cislo">Dní</th>
            </tr>
          </thead>
          <tbody>
            {d.turnusy.map((t, i) => (
              <tr key={i}>
                <td>
                  <strong>{t.nazov}</strong>
                </td>
                <td>{t.firma ?? '—'}</td>
                <td className="tlmene">{[t.miesto, t.krajina].filter(Boolean).join(', ')}</td>
                <td>
                  {skDatum(t.datum_od)} – {skDatum(t.datum_do)}
                </td>
                <td className="cislo">{t.dni}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
