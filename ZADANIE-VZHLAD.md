# Zadanie: nový vzhľad Živnosťapp (skúška na vetve `dizajn-ramp`)

Pracuješ na **skúšobnej vetve `dizajn-ramp`**. Pôvodná appka (vetva `main`) ostáva nedotknutá –
do `main` nič nezlučuj a necommituj. Na konci práce commitni a pushni len do `dizajn-ramp`.

## Prečo

Appka funguje a rozloženie obrazoviek je hotové (karty v troch riadkoch, Filter, lepkavé Uložiť,
dotykové plochy 44 px – pozri [DESIGN.md](DESIGN.md)). Používateľovi sa však nepáči **vzhľad**:
pôsobí ako „typická appka od AI" – všade modrá, zaoblené karty s tieňom, farebný prúžok pri každom
nadpise, pestrofarebné bublinky. Chce pokojný, vecný vzhľad podľa vzoru **Ramp**
([podklady/ramp-DESIGN.md](podklady/ramp-DESIGN.md)).

## Najprv si prečítaj

1. [CLAUDE.md](CLAUDE.md) – pravidlá projektu (platia aj tu; texty v rozhraní nemeň).
2. [DESIGN.md](DESIGN.md) – rozloženie, ktoré ostáva.
3. [podklady/ramp-DESIGN.md](podklady/ramp-DESIGN.md) – vzor vzhľadu.
4. [client/src/styles.css](client/src/styles.css) – farby a písmo sú premenné navrchu (`:root` = svetlá
   téma, `[data-tema='tmavy']` = tmavá), komponenty pod nimi.

## Cieľový vzhľad (Ramp, prispôsobený pre túto appku)

Navrhni ucelený vzhľad ako dizajnér, nie ako prepis tabuľky farieb. Hodnoty z Rampu ber ako
východisko – keď treba niečo upraviť kvôli kontrastu, čitateľnosti alebo tmavej téme, uprav to
a v závere napíš prečo.

**Z Rampu prevezmi:**
- Teplý papierový podklad `#f4f2f0`, biele karty `#ffffff`, text takmer čierny `#0c0a08`, tlmený text `#6d6c6b`.
- **Žiadne tiene** na kartách a paneloch – len tenká linka `#e5e7eb`. Tieň ostáva len pri vyskakovacích
  oknách a ponuke ⋮.
- **Jeden výrazný akcent:** žltozelená `#e4f222` – len ako **výplň** hlavného tlačidla, aktívnej záložky
  a aktívneho stavu, vždy s tmavým textom `#0c0a08`. Nikdy nie ako farba textu na svetlom podklade
  (nedá sa čítať) a nikdy nie ako veľká plocha.
- Zaoblenie: tlačidlá a štítky 6 px, polia 10 px, karty a panely 12–16 px. Žiadne „pilulky".
- Preč: farebný prúžok pred nadpismi (`h2::before`), prechody (`--gradient-*`, `--sidebar`), modrá všade.

**Prispôsob pre túto appku (dôležité):**
- **Písmo:** jedno písmo **IBM Plex Sans** cez `@fontsource/ibm-plex-sans` (appka beží aj offline –
  žiadne Google Fonts ani iné CDN). Nahraď Manrope aj Barlow Condensed (`client/src/main.tsx`,
  `package.json`, `--font`, `--font-nadpis`). Hrúbky: 400 text, 500–600 popisy a nadpisy,
  **700 sumy a hlavné čísla** – na rozdiel od Rampu potrebujú sumy „vyskočiť" (používatelia sú
  unavení živnostníci 35–55 rokov, papiere riešia večer).
- **Farby stavov ostávajú, ale tlmené:** červená = dlh po splatnosti a mazanie, zelená = uhradené /
  prišli peniaze, oranžová = blíži sa termín. Bez nich appka nehovorí to podstatné.
- **Kategórie výdavkov a firmy** (`.ton-*`, `.farebny-cip`, avatary) sú dnes pestrofarebné – urob ich
  neutrálne (sivé), najviac s malou farebnou bodkou.
- **Odkazy** na svetlom podklade: tmavý text s podčiarknutím (nie žltozelená).
- **Tmavá téma** (`[data-tema='tmavy']`): podklad `#121212`–`#1a1919`, panely o odtieň svetlejšie,
  linky `#2a2a2a`, žltozelené tlačidlá s tmavým textom; tu môže byť žltozelená aj farbou aktívneho textu.
- `theme-color` v `client/index.html` a farby v `client/public/manifest.webmanifest` zlaď s novým vzhľadom.

**Nemeň:**
- Rozloženie obrazoviek, texty, logiku, server, databázu, PDF faktúry (`server/lib/invoicePdf.ts` má
  vlastné nastavenia vzhľadu).
- Pravidlá z DESIGN.md: písmo najmenej 12 px, dotykové plochy na telefóne aspoň 44 × 44 px,
  kontrast aspoň AA v oboch témach, sumy `tabular-nums`.

## Postup – dve fázy so zastávkou

Kredity sú obmedzené a používateľ chce výsledok vidieť skôr, než sa prerobí všetko.

**Fáza 1 – ukážka (potom sa zastav):**
- Premenné (farby, písmo, tieň, zaoblenie) v oboch témach a spoločné prvky (bod 1 nižšie).
- Skontroluj obrázkami tri obrazovky: **Prehľad, Faktúry, Nový výdavok** – telefón aj počítač,
  svetlá aj tmavá téma. Celé `npm run overenie` ešte nespúšťaj.
- Commitni, pushni do `dizajn-ramp` a napíš 3–5 viet po slovensky, čo si zmenil.
  Potom **počkaj na odpoveď** („pokračuj" alebo pripomienky). Obrázky pre používateľa spraví
  lokálna relácia z tvojej vetvy.

**Fáza 2 – po súhlase:** zvyšok obrazoviek (body 2–4), DESIGN.md a celé overenie nižšie.

### Kroky

1. Najprv **premenné** (farby, písmo, tieň, zaoblenie) v oboch témach, potom **spoločné prvky**:
   tlačidlá (`.primar`, `.holy`, `.ikonove`), panely a karty (`.panel`, `.zaznam`, `.karta`), štítky
   (`.stitok`, `.farebny-cip`), záložky (`.taby`), prepínač obdobia (`.segment`), polia, bočné menu
   (`.sidebar`), spodná lišta (`.spodne-menu`), oznámenia a okná.
2. Prejdi kľúčové obrazovky: **Prehľad, Faktúry, faktúra, Nový výdavok, Turnus, Nastavenia** – v telefóne
   (390 × 844) aj na počítači (1275 × 748), v svetlej aj tmavej téme. Obrázky si rob neviditeľne
   (headless Chrome – vzor je v `scripts/overenie/ui.mjs` a `spolocne.mjs`).
3. Potom ostatné obrazovky – nič nesmie ostať v starom modrom štýle.
4. Do DESIGN.md prepíš časti **Písmo** a **Farby** podľa nového vzhľadu (rozloženie nechaj).

## Overenie

- `npm run overenie` musí prejsť celé (svetlý aj tmavý režim). Kontroluje kontrast, veľkosť písma,
  dotykové plochy a to, či nič nevylieza z obrazovky.
- V cloude nemusí byť Chrome – vtedy sa testy obrazoviek preskočia. Nainštaluj Chromium a cestu
  daj do premennej `CHROME_PATH`, inak vzhľad nie je overený.
- Testy nemeň, aby prešli – oprav vzhľad. Výnimka: test, ktorý kontroluje starú farbu či triedu,
  ktorá zámerne zmizla.

## Výstup

- Commity na vetve `dizajn-ramp`, push na GitHub. Do `main` nič.
- V poslednej správe stručne po slovensky: čo sa zmenilo, čo si nestihol, čo odporúčaš skontrolovať.
  Obrázky „pred a po" pre používateľa spraví potom lokálna relácia.
- Pracuj úsporne: nečítaj celé veľké súbory, keď stačí časť; najprv premenné a spoločné prvky –
  to zmení väčšinu appky naraz.
