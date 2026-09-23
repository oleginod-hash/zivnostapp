import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSkryteSumy } from '../components/SkryteSumy'
import { Karticka } from '../components/Farby'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  api, pocet, skDatum, skSuma, suSumySkryte, SKRYTA_SUMA,
  type DniVKrajine, type KategoriaVydavkov, type MesacneFinancie, type PrehladFinancii, type ZiskTurnusu,
} from '../api'

/** Farby kategórií – od akcentu appky cez tlmené odtiene, čitateľné v oboch témach. */
const FARBY = ['#3a60dd', '#2f9e8f', '#8b6fd6', '#d08a3e', '#4ea56f', '#d0605a', '#5b8fd9', '#8a94a6', '#c26aa0', '#6aa84f']

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
            popis="Príjmy (zaplatené faktúry)"
            hodnota={skSuma(prehlad.prijmy)}
            pod={pocet(prehlad.pocet_faktur, ['faktúra', 'faktúry', 'faktúr'])}
          />
          <Karticka
            ikona="dole"
            ton="warn"
            popis="Výdavky"
            hodnota={skSuma(prehlad.vydavky)}
            pod={`z toho uznateľné ${skSuma(prehlad.vydavky_odpocitatelne)}`}
          />
          <Karticka
            ikona="penazenka"
            ton={prehlad.zisk >= 0 ? 'pos' : 'neg'}
            farebnaHodnota
            popis="Zostalo (príjmy − výdavky)"
            hodnota={skSuma(prehlad.zisk)}
          />
          <Karticka
            ikona="hodiny"
            ton="akcent"
            popis="Ešte čaká na zaplatenie"
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

      <div className="info-pruh">
        Príjem sa počíta ku dňu, keď ti faktúru <strong>zaplatili</strong> — nie keď si ju vystavil. Nezaplatené
        faktúry sa do príjmov nerátajú, nájdeš ich v poslednej kartičke.
      </div>

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
            Hranica {dni.hranica} dní je orientačná — po jej prekročení sa v mnohých krajinách rieši daňová
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
            <BarChart data={mesacne} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="mesiac" tick={{ fontSize: 12.5 }} axisLine={false} tickLine={false} tickMargin={8} />
              <YAxis tickFormatter={kratkeEur} tick={{ fontSize: 12.5 }} axisLine={false} tickLine={false} width={70} />
              <Tooltip
                formatter={((v: unknown, n: unknown) => [eur(v), n === 'prijmy' ? 'Príjmy' : 'Výdavky']) as never}
                labelFormatter={(l) => `${l} ${rok}`}
                contentStyle={{ fontSize: 12.5 }}
              />
              <Legend formatter={(v) => (v === 'prijmy' ? 'Príjmy' : 'Výdavky')} />
              <Bar dataKey="prijmy" fill="#3a60dd" radius={[5, 5, 0, 0]} />
              <Bar dataKey="vydavky" fill="#4ea56f" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="panel">
        <h2>Na čo idú peniaze</h2>
        {kategorie.length === 0 ? (
          <div className="prazdne">
            Za rok {rok} nemáš zapísané žiadne výdavky. <Link to="/vydavky">Pridaj prvý</Link>.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 300px', minWidth: 260 }}>
              <ResponsiveContainer key={skryte ? "skryte" : "viditelne"} width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={kategorie}
                    dataKey="suma"
                    nameKey="kategoria"
                    innerRadius={55}
                    outerRadius={100}
                    paddingAngle={2}
                  >
                    {kategorie.map((_, i) => (
                      <Cell key={i} fill={FARBY[i % FARBY.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={((v: unknown) => eur(v)) as never}
                    contentStyle={{ fontSize: 12.5 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: '1 1 320px' }}>
              <table>
                <tbody>
                  {kategorie.map((k, i) => (
                    <tr key={k.kategoria}>
                      <td style={{ width: 20 }}>
                        <span
                          style={{
                            display: 'inline-block', width: 11, height: 11, borderRadius: 3,
                            background: FARBY[i % FARBY.length],
                          }}
                        />
                      </td>
                      <td>{k.kategoria}</td>
                      <td className="tlmene" style={{ width: 70 }}>
                        {k.pocet}×
                      </td>
                      <td className="cislo">
                        <strong>{skSuma(k.suma)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="panel tesny">
        <div style={{ padding: '16px 20px 0' }}>
          <h2 style={{ margin: 0 }}>Zisk podľa turnusov</h2>
          <div className="napoveda" style={{ marginTop: 4 }}>
            Vyfakturované mínus výdavky, ktoré si k turnusu priradil.
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
                <th className="cislo">Zaplatené</th>
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
                      <div className="tlmene" style={{ fontSize: 12.5 }}>
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
