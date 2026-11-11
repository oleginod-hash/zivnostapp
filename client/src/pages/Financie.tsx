import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSkryteSumy } from '../components/SkryteSumy'
import { FarebnyCip, Karticka, tonKategorie } from '../components/Farby'
import { RezervaNaDane } from '../components/Rezerva'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  api, pocet, skDatum, skSuma, suSumySkryte, SKRYTA_SUMA,
  type DniVKrajine, type KategoriaVydavkov, type MesacneFinancie, type PrehladFinancii, type ZiskTurnusu,
} from '../api'

const eur = (n: unknown) => skSuma(Number(n) || 0)
const kratkeEur = (n: number) =>
  suSumySkryte() ? SKRYTA_SUMA : new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 0 }).format(n) + ' €'

export function Financie() {
  // Recharts si popisy osí pamätá, takže pri skrytí/zobrazení súm grafy
  // prekreslíme načisto – kľúč sa zmení a graf sa vykreslí odznova.
  const [skryte] = useSkryteSumy()
  const [roky, setRoky] = useState<string[]>([])
  const [rok, setRok] = useState(String(new Date().getFullYear()))
  const [prehlad, setPrehlad] = useState<PrehladFinancii | null>(null)
  const [mesacne, setMesacne] = useState<MesacneFinancie[]>([])
  const [kategorie, setKategorie] = useState<KategoriaVydavkov[]>([])
  const [turnusy, setTurnusy] = useState<ZiskTurnusu[]>([])
  const [dni, setDni] = useState<DniVKrajine | null>(null)

  useEffect(() => {
    api.get<string[]>('/financie/roky').then(setRoky).catch(() => {})
  }, [])

  useEffect(() => {
    api.get<PrehladFinancii>('/financie/prehlad?rok=' + rok).then(setPrehlad).catch(() => {})
    api.get<MesacneFinancie[]>('/financie/mesacne?rok=' + rok).then(setMesacne).catch(() => {})
    api.get<KategoriaVydavkov[]>('/financie/kategorie?rok=' + rok).then(setKategorie).catch(() => {})
    api.get<ZiskTurnusu[]>('/financie/turnusy?rok=' + rok).then(setTurnusy).catch(() => {})
    api.get<DniVKrajine>('/stravne/dni?rok=' + rok).then(setDni).catch(() => {})
  }, [rok])

  const najvacsiaKategoria = Math.max(0, ...kategorie.map((k) => k.suma))
  const maDataMesacne = mesacne.some((m) => m.prijmy > 0 || m.vydavky > 0)

  return (
    <>
      <div className="hlavicka">
        <h1>Financie</h1>
        <div className="akcie">
          <select value={rok} onChange={(e) => setRok(e.target.value)} style={{ width: 'auto' }}>
            {roky.map((r) => (
              <option key={r} value={r}>
                Rok {r}
              </option>
            ))}
          </select>
          <Link className="tlacidlo primar" to="/vydavky">
            Výdavky
          </Link>
        </div>
      </div>

      {prehlad && (
        <div className="karty kompaktne">
          <Karticka
            ikona="hore"
            ton="pos"
            farebnaHodnota
            popis="Príjmy"
            hodnota={skSuma(prehlad.prijmy)}
            pod={pocet(prehlad.pocet_faktur, ['faktúra', 'faktúry', 'faktúr'])}
          />
          <Karticka
            ikona="dole"
            ton="warn"
            popis="Výdavky"
            hodnota={skSuma(prehlad.vydavky)}
            pod={`uznateľné ${skSuma(prehlad.vydavky_odpocitatelne)}`}
          />
          <Karticka
            ikona="penazenka"
            ton={prehlad.zisk >= 0 ? 'pos' : 'neg'}
            farebnaHodnota
            popis="Zisk"
            hodnota={skSuma(prehlad.zisk)}
          />
          <Karticka
            ikona="hodiny"
            ton="akcent"
            popis="Čaká na zaplatenie"
            hodnota={skSuma(prehlad.caka_na_zaplatenie)}
          />
          {prehlad.sukromne_prijmy > 0 && (
            <Karticka
              ikona="zaloha"
              ton="tyrkys"
              popis="Súkromné príjmy"
              hodnota={skSuma(prehlad.sukromne_prijmy)}
              pod="mimo podnikania"
            />
          )}
        </div>
      )}

      <RezervaNaDane rok={rok} />

      {dni && dni.krajiny.length > 0 && (
        <div className="panel">
          <h2>Dni strávené v zahraničí ({dni.dni_v_zahranici} spolu)</h2>
          <table>
            <tbody>
              {dni.krajiny.map((k) => (
                <tr key={k.krajina}>
                  <td>
                    <strong>{k.krajina}</strong>
                  </td>
                  <td className="cislo" style={{ width: 100 }}>
                    {k.dni} dní
                  </td>
                  <td style={{ width: 340 }}>
                    <div className="pruh">
                      <div
                        className={
                          'pruh-vypln' +
                          (k.prekrocena_hranica ? ' cervena' : k.blizi_sa_hranica ? ' oranzova' : '')
                        }
                        style={{ width: Math.min(100, (k.dni / dni.hranica) * 100) + '%' }}
                      />
                    </div>
                  </td>
                  <td className="tlmene" style={{ width: 190 }}>
                    {k.prekrocena_hranica ? (
                      <span style={{ color: 'var(--cervena)', fontWeight: 600 }}>
                        prekročených {dni.hranica} dní
                      </span>
                    ) : k.blizi_sa_hranica ? (
                      <span style={{ color: 'var(--oranzova)', fontWeight: 600 }}>
                        zostáva {k.zostava_do_hranice} dní
                      </span>
                    ) : (
                      `zostáva ${k.zostava_do_hranice} dní`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="napoveda" style={{ marginTop: 10 }}>
            Hranica {dni.hranica} dní je orientačná – po jej prekročení sa v mnohých krajinách rieši daňová
            rezidencia. Appka to nevyhodnocuje, len počíta dni z tvojich turnusov. Posúdenie patrí účtovníčke.
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Príjmy a výdavky po mesiacoch</h2>
        {!maDataMesacne ? (
          <div className="prazdne">Za rok {rok} zatiaľ nie sú žiadne dáta.</div>
        ) : (
          <ResponsiveContainer key={skryte ? "skryte" : "viditelne"} width="100%" height={300}>
            <BarChart data={mesacne} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={2}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="mesiac" tick={{ fontSize: 13 }} axisLine={false} tickLine={false} tickMargin={8} />
              <YAxis tickFormatter={kratkeEur} tick={{ fontSize: 13 }} axisLine={false} tickLine={false} width={70} />
              <Tooltip
                formatter={((v: unknown, n: unknown) => [eur(v), n === 'prijmy' ? 'Príjmy' : 'Výdavky']) as never}
                labelFormatter={(l) => `${l} ${rok}`}
                contentStyle={{ fontSize: 13 }}
              />
              <Legend formatter={(v) => (v === 'prijmy' ? 'Príjmy' : 'Výdavky')} />
              {/* Príjmy vo farbe grafov appky, výdavky sivé – zelená v appke znamená „prišli peniaze". */}
              <Bar dataKey="prijmy" fill="var(--graf)" radius={[4, 4, 0, 0]} maxBarSize={30} />
              <Bar dataKey="vydavky" fill="var(--grafDruhy)" radius={[4, 4, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Kategórie zoradené od najväčšej – pruh ukazuje pomer k najväčšej, rovnako ako na Prehľade.
          (Koláčový graf pri viacerých podobných kategóriách zle ukazoval rozdiely a potreboval desať farieb.) */}
      <div className="panel tesny">
        <div className="hlavicka-karty">
          <h2 className="nadpis-karty">Výdavky podľa kategórií</h2>
        </div>
        {kategorie.length === 0 ? (
          <div className="prazdne">
            Za rok {rok} nemáš zapísané žiadne výdavky. <Link to="/vydavky">Pridaj prvý</Link>.
          </div>
        ) : (
          <table className="dlazdica-tabulka kategorie-vydavkov">
            <tbody>
              {kategorie.map((k) => (
                <tr key={k.kategoria}>
                  <td className="dl-hlavne" style={{ width: 230 }}>
                    <FarebnyCip ton={tonKategorie(k.kategoria)}>{k.kategoria}</FarebnyCip>
                  </td>
                  <td className="dl-cela">
                    <div className="pruh">
                      <div
                        className="pruh-vypln"
                        style={{ width: (najvacsiaKategoria ? (k.suma / najvacsiaKategoria) * 100 : 0) + '%' }}
                      />
                    </div>
                  </td>
                  <td className="cislo dl-pravo" style={{ width: 130 }}>
                    <strong>{skSuma(k.suma)}</strong>
                  </td>
                  <td className="cislo tlmene dl-skryt" style={{ width: 60, fontWeight: 500 }}>
                    {k.pocet}×
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel tesny">
        <div style={{ padding: '16px 20px 0' }}>
          <h2 style={{ margin: 0 }}>Zisk podľa turnusov</h2>
          <div className="napoveda" style={{ marginTop: 4 }}>
            Vyfakturovaná suma mínus výdavky priradené k turnusu.
          </div>
        </div>
        {turnusy.length === 0 ? (
          <div className="prazdne">Za rok {rok} nemáš žiadne turnusy.</div>
        ) : (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Turnus</th>
                <th>Obdobie</th>
                <th className="cislo">Vyfakturované</th>
                <th className="cislo">Uhradené</th>
                <th className="cislo">Výdavky</th>
                <th className="cislo">Zisk</th>
              </tr>
            </thead>
            <tbody>
              {turnusy.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={'/turnusy/' + t.id}>
                      <strong>{t.nazov}</strong>
                    </Link>
                    {t.firma_nazov && (
                      <div className="tlmene" style={{ fontSize: 13 }}>
                        {t.firma_nazov}
                      </div>
                    )}
                  </td>
                  <td className="tlmene">
                    {skDatum(t.datum_od)} – {skDatum(t.datum_do)}
                  </td>
                  <td className="cislo">{skSuma(t.vyfakturovane)}</td>
                  <td className="cislo">{skSuma(t.zaplatene)}</td>
                  <td className="cislo">{t.vydavky ? skSuma(t.vydavky) : <span className="tlmene">—</span>}</td>
                  <td className="cislo">
                    <strong style={{ color: t.zisk >= 0 ? 'var(--zelena)' : 'var(--cervena)' }}>
                      {skSuma(t.zisk)}
                    </strong>
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
