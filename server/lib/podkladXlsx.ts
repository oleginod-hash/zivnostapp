import type { Podklad } from '../routes/taxreport.js'
import { datum, eur, eurTucne, hlavicka, nadpis, tucne, vytvorZosit, type Bunka, type Harok } from './xlsx.js'

/**
 * Zošit pre účtovníčku. Každá oblasť má vlastný hárok, sumy sú skutočné
 * čísla (nie text), takže si ich vie zoradiť aj sčítať.
 *
 * Hlavná myšlienka: hárok „Platby" je zdroj pravdy o príjme – jeho súčet
 * musí sedieť s príjmom na hárku „Súhrn". Preto sa dá podklad odkontrolovať
 * bez toho, aby účtovníčka musela veriť tomu, čo appka vypočítala.
 */

const NAZVY_STAVOV: Record<string, string> = {
  koncept: 'Koncept',
  vystavena: 'Vystavená, ešte nezaplatená',
  zaplatena: 'Vyplatená',
  ciastocne: 'Čiastočne uhradená',
  po_splatnosti: 'Nezaplatená, po splatnosti',
  po_splatnosti_ciastocne: 'Čiastočne uhradená, po splatnosti',
}

const NAZVY_MESIACOV = [
  'Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún',
  'Júl', 'August', 'September', 'Október', 'November', 'December',
]

const NAZVY_PLATIEB: Record<string, string> = {
  karta: 'Kartou',
  hotovost: 'V hotovosti',
  prevod: 'Prevodom',
  ine: 'Inak',
}

function hlavicky(...texty: string[]): Bunka[] {
  return texty.map(hlavicka)
}

/** Slovenské skloňovanie po číslovke: 1 položka, 2–4 položky, 5+ položiek. */
function pocet(n: number, tvary: [string, string, string]): string {
  return `${n} ${n === 1 ? tvary[0] : n >= 2 && n <= 4 ? tvary[1] : tvary[2]}`
}

function harokSuhrn(d: Podklad): Harok {
  const r: Bunka[][] = [
    [nadpis(`Podklad pre daňové priznanie za rok ${d.rok}`)],
    [`Zostavené ${d.zostavene} z evidencie v Živnosťapp. Je to súhrn evidencie, nie vypočítané daňové priznanie.`],
    [],
    [tucne('Živnostník'), d.zivnostnik.meno],
    [tucne('IČO'), d.zivnostnik.ico],
    [tucne('DIČ'), d.zivnostnik.dic],
    [tucne('Adresa'), d.zivnostnik.adresa],
    [tucne('IBAN'), d.zivnostnik.iban],
    [],
    [nadpis('Hlavné čísla')],
    [
      'Príjmy – peniaze prijaté v roku ' + d.rok,
      eurTucne(d.prijmy.suma),
      pocet(d.prijmy.pocet_platieb, ['platba', 'platby', 'platieb']) +
        ' na ' +
        pocet(d.prijmy.pocet, ['faktúre', 'faktúrach', 'faktúrach']),
    ],
    [
      'Výdavky označené ako daňovo uznateľné',
      eurTucne(d.vydavky.uznatelne),
      pocet(d.vydavky.pocet, ['doklad', 'doklady', 'dokladov']),
    ],
    ['Rozdiel (príjmy − uznateľné výdavky)', eurTucne(d.zaklad_dane), 'pred paušálom, odvodmi a nezdaniteľnou časťou'],
    [],
    ['Výdavky označené ako neuznateľné', eur(d.vydavky.neuznatelne), 'do daňového základu nevstupujú'],
    [
      `Nezaplatené faktúry k 31. 12. ${d.rok}`,
      eur(d.nezaplatene.suma),
      pocet(d.nezaplatene.pocet, ['faktúra', 'faktúry', 'faktúr']) +
        ' – príjmom sa stanú až v roku, keď peniaze prídu',
    ],
    [
      'Súkromné príjmy vedené mimo podnikania',
      eur(d.sukromne_prijmy.suma),
      d.sukromne_prijmy.pocet
        ? pocet(d.sukromne_prijmy.pocet, ['položka', 'položky', 'položiek']) +
          ' – NIE sú príjmom z podnikania, sú tu len kvôli bankovému výpisu'
        : 'žiadne',
    ],
    [],
    ['Príjem sa počíta ku dňu prijatia platby, nie ku dňu vystavenia faktúry (§ 17 ods. 1 písm. a) ZDP – jednoduché účtovníctvo / daňová evidencia).'],
    ['Rozpis jednotlivých platieb, ktoré dávajú dokopy sumu príjmov, je na hárku „Platby".'],
    [],
    [nadpis('Príjmy po mesiacoch')],
    hlavicky('Mesiac', 'Prijaté', 'Počet platieb'),
  ]

  for (const m of d.platby_po_mesiacoch) {
    r.push([NAZVY_MESIACOV[Number(m.mesiac) - 1] ?? m.mesiac, eur(m.suma), m.pocet])
  }
  r.push([tucne('Spolu'), eurTucne(d.prijmy.suma), d.prijmy.pocet_platieb])

  r.push([], [nadpis('Výdavky podľa kategórií')], hlavicky('Kategória', 'Spolu', 'Z toho uznateľné', 'Počet'))
  for (const k of d.vydavky.podlaKategorii) {
    r.push([k.kategoria, eur(k.suma), eur(k.uznatelne), k.pocet])
  }
  r.push([
    tucne('Spolu'),
    eurTucne(d.vydavky.uznatelne + d.vydavky.neuznatelne),
    eurTucne(d.vydavky.uznatelne),
    d.vydavky.pocet,
  ])

  if (d.dni_v_krajinach.length) {
    r.push([], [nadpis('Dni strávené v zahraničí')], hlavicky('Krajina', 'Počet dní'))
    for (const k of d.dni_v_krajinach) r.push([k.krajina, k.dni])
  }

  return { nazov: 'Súhrn', sirky: [46, 16, 52], riadky: r }
}

function harokFaktury(d: Podklad): Harok {
  const r: Bunka[][] = [
    hlavicky(
      'Číslo', 'Typ', 'Odberateľ', 'Vystavená', 'Splatnosť', 'Fakturovaná suma',
      `Prijaté v roku ${d.rok}`, 'Dátum poslednej platby', 'Ešte neuhradené', 'Stav', 'Kryje faktúru', 'Poznámka',
    ),
  ]

  for (const f of d.faktury) {
    r.push([
      f.cislo,
      f.typ === 'zaloha' ? 'Zálohová' : 'Faktúra',
      f.firma ?? '',
      datum(f.datum_vystav),
      datum(f.datum_splat),
      eur(f.suma),
      eur(f.prijate_v_roku),
      datum(f.datum_uhrady),
      eur(f.otvoreny_zostatok > 0 ? f.otvoreny_zostatok : 0),
      NAZVY_STAVOV[f.stav_zobraz] ?? f.stav_zobraz,
      f.kryje_cislo ?? '',
      // Faktúra uhradená cez zálohy má nulu v „Prijaté v roku" – peniaze sú
      // v príjme pod číslami tých záloh. Bez tejto vety to vyzerá ako chyba.
      f.kryju_zalohy
        ? `uhradená cez zálohové faktúry ${f.kryju_zalohy}; tie sumy sú v príjme pod ich vlastnými číslami`
        : '',
    ])
  }

  const prijateSpolu = d.faktury.reduce((s, f) => s + (f.prijate_v_roku || 0), 0)
  r.push([
    tucne('Spolu'), null, null, null, null,
    eurTucne(d.faktury.reduce((s, f) => s + (f.suma || 0), 0)),
    eurTucne(prijateSpolu),
  ])
  r.push([])
  r.push([
    'Pozor: stĺpec „Fakturovaná suma" sa nesčítava do príjmu. Do príjmu ide stĺpec „Prijaté v roku".',
  ])
  r.push([
    'Zálohová faktúra s vyplneným stĺpcom „Kryje faktúru" je splátkou staršieho dlhu – ' +
      'jej suma sa neráta druhýkrát, len znižuje neuhradený zostatok tej pôvodnej faktúry.',
  ])

  return { nazov: 'Faktúry', sirky: [14, 11, 34, 12, 12, 16, 16, 20, 16, 30, 14, 62], riadky: r }
}

function harokPlatby(d: Podklad): Harok {
  const r: Bunka[][] = [
    hlavicky('Dátum platby', 'Faktúra', 'Typ', 'Odberateľ', 'Suma', 'Kryje faktúru', 'Poznámka'),
  ]
  for (const p of d.platby) {
    r.push([
      datum(p.datum),
      p.cislo,
      p.typ === 'zaloha' ? 'Zálohová' : 'Faktúra',
      p.firma ?? '',
      eur(p.suma),
      p.kryje_cislo ?? '',
      p.poznamka ?? '',
    ])
  }
  r.push([tucne('Spolu'), null, null, null, eurTucne(d.prijmy.suma)])
  r.push([])
  r.push(['Toto je zdrojový zoznam príjmov za rok ' + d.rok + '. Jeho súčet je príjem na hárku „Súhrn".'])
  return { nazov: 'Platby', sirky: [14, 14, 11, 34, 14, 14, 34], riadky: r }
}

function harokVydavky(d: Podklad): Harok {
  const r: Bunka[][] = [
    hlavicky('Dátum', 'Popis', 'Kategória', 'Suma', 'Daňovo uznateľný', 'Platba', 'Turnus', 'Doklad', 'Poznámka'),
  ]
  for (const v of d.vydavky.rozpis) {
    r.push([
      datum(v.datum),
      v.popis,
      v.kategoria,
      eur(v.suma),
      v.odpocitat ? 'áno' : 'nie',
      NAZVY_PLATIEB[v.platba] ?? v.platba,
      v.turnus ?? '',
      v.pocet_dokladov ? `${v.pocet_dokladov}× priložený` : 'chýba',
      v.poznamka ?? '',
    ])
  }
  r.push([
    tucne('Spolu'), null, null,
    eurTucne(d.vydavky.uznatelne + d.vydavky.neuznatelne),
  ])
  r.push([tucne('Z toho uznateľné'), null, null, eurTucne(d.vydavky.uznatelne)])
  return { nazov: 'Výdavky', sirky: [12, 40, 20, 13, 17, 13, 24, 16, 34], riadky: r }
}

function harokSukromne(d: Podklad): Harok {
  const r: Bunka[][] = [
    [nadpis('Súkromné príjmy – NIE sú príjmom z podnikania')],
    ['Evidované len preto, že prichádzajú na ten istý bankový výpis. Do daňového základu nevstupujú.'],
    [],
    hlavicky('Dátum', 'Popis', 'Kategória', 'Suma', 'Platba', 'Poznámka'),
  ]
  for (const p of d.sukromne_prijmy.polozky) {
    r.push([
      datum(p.datum),
      p.popis,
      p.kategoria || '',
      eur(p.suma),
      NAZVY_PLATIEB[p.platba] ?? p.platba,
      p.poznamka ?? '',
    ])
  }
  r.push([tucne('Spolu'), null, null, eurTucne(d.sukromne_prijmy.suma)])
  return { nazov: 'Súkromné príjmy', sirky: [12, 40, 20, 13, 13, 34], riadky: r }
}

function harokTurnusy(d: Podklad): Harok {
  const r: Bunka[][] = [hlavicky('Turnus', 'Firma', 'Miesto', 'Krajina', 'Od', 'Do', 'Dní v roku ' + d.rok)]
  for (const t of d.turnusy) {
    r.push([t.nazov, t.firma ?? '', t.miesto ?? '', t.krajina ?? '', datum(t.datum_od), datum(t.datum_do), t.dni])
  }
  r.push([tucne('Spolu dní'), null, null, null, null, null, d.turnusy.reduce((s, t) => s + (t.dni || 0), 0)])
  return { nazov: 'Turnusy', sirky: [28, 30, 20, 16, 12, 12, 16], riadky: r }
}

export function podkladXlsx(d: Podklad): Buffer {
  const harky: Harok[] = [harokSuhrn(d), harokFaktury(d), harokPlatby(d), harokVydavky(d)]
  // Hárok navyše len vtedy, keď je čo ukázať – prázdny hárok mätie.
  if (d.sukromne_prijmy.polozky.length) harky.push(harokSukromne(d))
  if (d.turnusy.length) harky.push(harokTurnusy(d))
  return vytvorZosit(harky)
}
