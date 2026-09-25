import { Fragment, useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Hladanie } from './components/Hladanie'
import { Ikona, type KlucIkony } from './components/Ikony'
import { PrepinacTemy } from './components/Tema'
import { PrepinacSum } from './components/SkryteSumy'
import { api, ApiChyba, sledujSkryteSumy, type Nastavenia as TNastavenia, type PolozkaKosa } from './api'
import { mozemOdist, suNeulozeneZmeny } from './neulozene'
import { Oznamenia } from './components/Oznamenia'
import { Prehlad } from './pages/Prehlad'
import { Faktury } from './pages/Faktury'
import { FakturaEdit } from './pages/FakturaEdit'
import { Firmy } from './pages/Firmy'
import { Zmluvy } from './pages/Zmluvy'
import { ZmluvaEdit } from './pages/ZmluvaEdit'
import { Turnusy } from './pages/Turnusy'
import { TurnusEdit } from './pages/TurnusEdit'
import { Objednavky } from './pages/Objednavky'
import { ObjednavkaEdit } from './pages/ObjednavkaEdit'
import { Financie } from './pages/Financie'
import { Vydavky } from './pages/Vydavky'
import { AsistentStranka } from './pages/Asistent'
import { Kos } from './pages/Kos'
import { DanovyPodklad } from './pages/DanovyPodklad'
import { Upomienky } from './pages/Upomienky'
import { Nastavenia } from './pages/Nastavenia'
import { Sprievodca } from './pages/Sprievodca'
import { Banka } from './pages/Banka'
import { Terminy } from './pages/Terminy'

type PolozkaMenu = { cesta: string; ikona: KlucIkony; text: string }

/**
 * Poradie je od toho, čo otváram najčastejšie, po to, do čoho zablúdim raz
 * za čas. Skupiny sú len nadpisy nad položkami – poradie nemenia.
 */
const MENU: { skupina: string; polozky: PolozkaMenu[] }[] = [
  {
    skupina: 'Prehľad',
    polozky: [
      { cesta: '/', ikona: 'prehlad', text: 'Prehľad' },
      { cesta: '/terminy', ikona: 'kalendar', text: 'Termíny' },
    ],
  },
  {
    skupina: 'Peniaze',
    polozky: [
      { cesta: '/faktury', ikona: 'faktury', text: 'Faktúry' },
      { cesta: '/financie', ikona: 'financie', text: 'Financie' },
      { cesta: '/vydavky', ikona: 'vydavky', text: 'Výdavky' },
      { cesta: '/banka', ikona: 'banka', text: 'Výpis z banky' },
    ],
  },
  {
    skupina: 'Zákazky',
    polozky: [
      { cesta: '/turnusy', ikona: 'turnusy', text: 'Turnusy' },
      { cesta: '/upomienky', ikona: 'upomienky', text: 'Upomienky' },
      { cesta: '/objednavky', ikona: 'objednavky', text: 'Objednávky' },
      { cesta: '/zmluvy', ikona: 'zmluvy', text: 'Zmluvy' },
      { cesta: '/firmy', ikona: 'firmy', text: 'Firmy' },
    ],
  },
  {
    skupina: 'Pomoc',
    polozky: [{ cesta: '/asistent', ikona: 'pomocnik', text: 'Asistent' }],
  },
]

const trieda = ({ isActive }: { isActive: boolean }) => (isActive ? 'aktivny' : '')

export function App() {
  // Sumy sa formátujú obyčajnou funkciou, takže pri ich skrytí treba appku
  // prekresliť. Stránky sa pritom znova nenačítavajú – len sa prekreslia.
  const [, prekresli] = useState(0)
  useEffect(() => sledujSkryteSumy(() => prekresli((n) => n + 1)), [])

  // Neuložené zmeny vo formulári: pred odchodom cez odkaz alebo zatvorením okna
  // sa spýtame. Odkaz chytáme ešte pred routerom (fáza zachytávania), takže
  // po „Zrušiť" sa nikam nepresunie.
  useEffect(() => {
    const klik = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const odkaz = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!odkaz || odkaz.target === '_blank' || odkaz.hasAttribute('download')) return
      if (odkaz.origin !== window.location.origin || odkaz.pathname.startsWith('/api/')) return
      if (!suNeulozeneZmeny()) return
      if (odchodPovoleny.current) return
      e.preventDefault()
      e.stopPropagation()
      // Otázka je vlastným oknom, takže odpoveď príde až neskôr – potom
      // klik zopakujeme a tentoraz ho pustíme ďalej.
      mozemOdist().then((ano) => {
        if (!ano) return
        odchodPovoleny.current = true
        odkaz.click()
        odchodPovoleny.current = false
      })
    }
    const zatvorenie = (e: BeforeUnloadEvent) => {
      if (!suNeulozeneZmeny()) return
      e.preventDefault()
      e.returnValue = ''
    }
    document.addEventListener('click', klik, true)
    window.addEventListener('beforeunload', zatvorenie)
    return () => {
      document.removeEventListener('click', klik, true)
      window.removeEventListener('beforeunload', zatvorenie)
    }
  }, [])

  // Upozornenie, že beží starý server (appka sa neodštartovala po aktualizácii).
  // Keď server novú kontrolu vôbec nepozná, je tiež starší než stránky.
  const [zastarana, setZastarana] = useState(false)
  useEffect(() => {
    const over = () =>
      api
        .get<{ zastarana: boolean }>('/verzia')
        .then((v) => setZastarana(v.zastarana))
        .catch((e) => {
          if (e instanceof ApiChyba && e.stav === 404) setZastarana(true)
        })
    over()
    const casovac = setInterval(over, 5 * 60 * 1000)
    window.addEventListener('focus', over)
    return () => {
      clearInterval(casovac)
      window.removeEventListener('focus', over)
    }
  }, [])

  // Počet položiek v koši pri odkaze – obnoví sa pri každom prechode medzi stránkami.
  const odchodPovoleny = useRef(false)
  const miesto = useLocation()
  const [vKosi, setVKosi] = useState(0)
  useEffect(() => {
    api.get<PolozkaKosa[]>('/kos').then((k) => setVKosi(k.length)).catch(() => {})
  }, [miesto.pathname])

  // Prvé spustenie: kým sprievodca nie je za nami, úvodná obrazovka ho ukáže
  // namiesto prázdneho Prehľadu. Priamy odkaz na inú stránku nepresmerúvame.
  // Z nastavení si berieme aj to, či pracuje v zahraničí – podľa toho je
  // v spodnej lište na telefóne Turnusy alebo Asistent.
  const presmeruj = useNavigate()
  const [pracaVZahranici, setPracaVZahranici] = useState(false)
  useEffect(() => {
    api
      .get<TNastavenia>('/nastavenia')
      .then((n) => {
        setPracaVZahranici(!!n.praca_v_zahranici)
        if (!n.sprievodca_hotovy && miesto.pathname === '/') presmeruj('/sprievodca', { replace: true })
      })
      .catch(() => {})
  }, [miesto.pathname, presmeruj])

  // Telefón: bočné menu sa vysúva cez „Viac" v spodnej lište a po výbere stránky sa zavrie.
  const [menuOtvorene, setMenuOtvorene] = useState(false)
  useEffect(() => setMenuOtvorene(false), [miesto.pathname])
  useEffect(() => {
    if (!menuOtvorene) return
    const klaves = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOtvorene(false)
    window.addEventListener('keydown', klaves)
    return () => window.removeEventListener('keydown', klaves)
  }, [menuOtvorene])

  // Na úzkej obrazovke sa riadky tabuliek zobrazia ako karty. Každá bunka dostane
  // popis zo záhlavia svojho stĺpca – naraz pre všetky tabuľky v appke, nech sa
  // nemusí dopĺňať ručne v každej stránke. Tabuľky s najviac tromi stĺpcami sa
  // zmestia aj na telefón, tie ostávajú tabuľkami.
  useEffect(() => {
    let caka = 0
    const oznac = () => {
      caka = 0
      for (const tabulka of document.querySelectorAll<HTMLTableElement>('main.obsah table')) {
        const zahlavie = [...tabulka.querySelectorAll(':scope > thead > tr:first-child > th')].map(
          (th) => th.textContent?.trim() ?? '',
        )
        tabulka.toggleAttribute('data-karty', zahlavie.length > 3)
        for (const riadok of tabulka.querySelectorAll(':scope > tbody > tr, :scope > tfoot > tr')) {
          let stlpec = 0
          for (const bunka of riadok.children as HTMLCollectionOf<HTMLTableCellElement>) {
            const popis = zahlavie[stlpec] ?? ''
            if (bunka.getAttribute('data-popis') !== popis) bunka.setAttribute('data-popis', popis)
            stlpec += bunka.colSpan || 1
          }
        }
      }
    }
    const pozorovatel = new MutationObserver(() => {
      if (!caka) caka = requestAnimationFrame(oznac)
    })
    pozorovatel.observe(document.body, { childList: true, subtree: true, characterData: true })
    oznac()
    return () => {
      pozorovatel.disconnect()
      cancelAnimationFrame(caka)
    }
  }, [])

  // Sprievodca je na celú obrazovku – bez menu, nech nič neodvádza pozornosť.
  if (miesto.pathname === '/sprievodca') {
    return (
      <main className="obsah sprievodca-plocha">
        <Sprievodca />
        <Oznamenia />
      </main>
    )
  }

  const spodneMenu: PolozkaMenu[] = [
    { cesta: '/', ikona: 'prehlad', text: 'Prehľad' },
    { cesta: '/faktury', ikona: 'faktury', text: 'Faktúry' },
    { cesta: '/vydavky', ikona: 'vydavky', text: 'Výdavky' },
    pracaVZahranici
      ? { cesta: '/turnusy', ikona: 'turnusy', text: 'Turnusy' }
      : { cesta: '/asistent', ikona: 'pomocnik', text: 'Asistent' },
  ]

  return (
    <div className={'layout' + (menuOtvorene ? ' menu-otvorene' : '')}>
      <nav className="sidebar" aria-label="Menu">
        <div className="logo">
          <span className="logo-dlazdica">
            <Ikona nazov="logo" velkost={15} hrubka={2.2} />
          </span>
          Živnosťapp
        </div>
        <Hladanie />

        <div className="sidebar-menu">
          {MENU.map((skupina) => (
            <Fragment key={skupina.skupina}>
              <div className="skupina-menu">{skupina.skupina}</div>
              {skupina.polozky.map((p) => (
                <NavLink key={p.cesta} to={p.cesta} end={p.cesta === '/'} className={trieda}>
                  <Ikona nazov={p.ikona} />
                  {p.text}
                </NavLink>
              ))}
            </Fragment>
          ))}
        </div>

        <div className="sidebar-spodok">
          <NavLink to="/danovy-podklad" className={trieda}>
            <Ikona nazov="podklad" velkost={16} />
            Daňový podklad
          </NavLink>
          <NavLink to="/nastavenia" className={trieda}>
            <Ikona nazov="nastavenia" velkost={16} />
            Nastavenia
          </NavLink>
          <NavLink to="/kos" className={trieda}>
            <Ikona nazov="kos" velkost={16} />
            Kôš
            {vKosi > 0 && <span className="menu-pocet">{vKosi}</span>}
          </NavLink>
          <div className="nastroje-panela">
            <PrepinacTemy />
            <PrepinacSum />
          </div>
        </div>
      </nav>

      <main className="obsah">
        {zastarana && (
          <div className="aktualizacia" role="status">
            <Ikona nazov="vratit" velkost={15} hrubka={2} />
            Appka bola aktualizovaná, ale stále beží predchádzajúca verzia. Zatvor jej čierne okno a spusti ju
            znova – dovtedy sa niektoré zmeny nemusia uložiť.
          </div>
        )}
        <Routes>
          <Route path="/" element={<Prehlad />} />
          <Route path="/terminy" element={<Terminy />} />
          <Route path="/faktury" element={<Faktury />} />
          <Route path="/faktury/nova" element={<FakturaEdit />} />
          <Route path="/faktury/:id" element={<FakturaEdit />} />
          <Route path="/turnusy" element={<Turnusy />} />
          <Route path="/turnusy/novy" element={<TurnusEdit />} />
          <Route path="/turnusy/:id" element={<TurnusEdit />} />
          <Route path="/objednavky" element={<Objednavky />} />
          <Route path="/objednavky/nova" element={<ObjednavkaEdit />} />
          <Route path="/objednavky/:id" element={<ObjednavkaEdit />} />
          <Route path="/financie" element={<Financie />} />
          <Route path="/vydavky" element={<Vydavky />} />
          <Route path="/banka" element={<Banka />} />
          <Route path="/zmluvy" element={<Zmluvy />} />
          <Route path="/zmluvy/nova" element={<ZmluvaEdit />} />
          <Route path="/zmluvy/:id" element={<ZmluvaEdit />} />
          <Route path="/firmy" element={<Firmy />} />
          <Route path="/asistent" element={<AsistentStranka />} />
          {/* Asistent býval rozdelený na troch – staré odkazy vedú na jedného. */}
          <Route path="/pomocnik" element={<Navigate to="/asistent" replace />} />
          <Route path="/uctovnik" element={<Navigate to="/asistent" replace />} />
          <Route path="/pravnik" element={<Navigate to="/asistent" replace />} />
          {/* Dlhy a zálohy sú teraz záložkami priamo vo faktúrach. */}
          <Route path="/dlhy" element={<Navigate to="/faktury?stav=nevyplatene" replace />} />
          <Route path="/upomienky" element={<Upomienky />} />
          <Route path="/danovy-podklad" element={<DanovyPodklad />} />
          <Route path="/kos" element={<Kos />} />
          <Route path="/nastavenia" element={<Nastavenia />} />
          <Route path="*" element={<div className="prazdne">Stránka neexistuje.</div>} />
        </Routes>
      </main>

      {/* Len na telefóne: zatemnenie pod vysunutým menu a spodná lišta. */}
      <div className="menu-zavoj" onClick={() => setMenuOtvorene(false)} aria-hidden="true" />
      <nav className="spodne-menu" aria-label="Hlavné stránky">
        {spodneMenu.map((p) => (
          <NavLink key={p.cesta} to={p.cesta} end={p.cesta === '/'} className={trieda}>
            <Ikona nazov={p.ikona} velkost={20} />
            {p.text}
          </NavLink>
        ))}
        <button
          type="button"
          className={menuOtvorene ? 'aktivny' : ''}
          aria-expanded={menuOtvorene}
          onClick={() => setMenuOtvorene(!menuOtvorene)}
        >
          <Ikona nazov="menu" velkost={20} />
          Viac
        </button>
      </nav>
      <Oznamenia />
    </div>
  )
}
