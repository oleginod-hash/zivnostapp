# Živnosťapp – pravidlá vzhľadu

Podľa tohto súboru sa robí každá nová obrazovka aj úprava starej. Farby, písmo a rozostupy sú
premenné v [client/src/styles.css](client/src/styles.css) – tu je, **ako** ich používať.

## Pre koho

Remeselníci a živnostníci 35–55 rokov, papiere riešia večer unavení, telefón je ich hlavný
počítač. Preto: **pokojne, čitateľne, málo vecí naraz**. Každá obrazovka odpovedá na jednu otázku
(„kto mi dlhuje", „čo som minul") a hlavná akcia je vždy na očiach.

## Vzor rozloženia

**Rozloženie** berieme z bežných fakturačných appiek (vzor: KROS Fakturácia) – kompaktné zoznamy,
„Viac údajov", Uložiť dole. **Vzhľad** (farby, písmo, tvary) je vlastný a nemení sa.

## Obrazovka na telefóne (pod 820 px)

1. **Hlavička:** názov stránky vľavo, vpravo najviac **jedno** hlavné tlačidlo (napr. „+ Nová faktúra")
   alebo „Späť". Menej časté akcie idú do ponuky **⋮** (`MenuAkcii`).
2. **Záložky** (ak sú): mriežka po dve, počet vpravo (`.taby`).
3. **Hľadanie + tlačidlo Filter** v jednom riadku (`HladanieSFiltrom` v `components/Zoznam.tsx`).
   Ďalšie výbery (firma, turnus, rok, dátumy) sú schované pod Filtrom – zoznam musí začínať na prvej
   obrazovke.
4. **Súhrn** jedným riadkom nad zoznamom („4 faktúry · spolu 6 220 € · čaká 2 420 €").
5. **Zoznam** – pozri nižšie.
6. Dole je **spodná lišta** (5 položiek); vo formulári nad ňou **lepkavé Uložiť**.

## Zoznam záznamov

Každý záznam je **samostatná karta v troch riadkoch** – súčasť `ZaznamRiadok`
(`components/Zoznam.tsx`), použitá vo Faktúrach, Výdavkoch a Turnusoch:

| riadok | vľavo | vpravo |
|---|---|---|
| 1 | identifikátor (číslo, dátum) drobne | ponuka ⋮ |
| 2 | hlavný text tučne (odberateľ, popis výdavku, názov turnusu) | – |
| 3 | stav (štítok) a drobná doplnková informácia | suma tučne |

- Ťuknutie na kartu otvorí detail. Úpravy a mazanie sú v ⋮ – nie ako ikony v každej karte.
- Karta nemá popisy pri každej hodnote („Dátum: …") – poradie riadkov je vždy rovnaké.
- Tabuľky s popismi pri každej bunke (`table[data-karty]`) sú len náhradné riešenie pre zriedkavé
  zoznamy; nový zoznam robíme ako kartu v troch riadkoch.
- Súhrnné čísla (Príjmy, Výdavky, Čaká…) sú **zoznam riadkov** v jednom paneli – popis vľavo,
  suma vpravo (`.karty.kompaktne` na telefóne), nie mriežka dlaždíc.

## Formulár

Vzor: faktúra (`FakturaEdit`).

- Najprv polia, ktoré sa vypĺňajú vždy; krátke polia (dátumy, PSČ, IČO/DIČ) **po dve vedľa seba**.
- Zriedkavé polia pod **„Viac údajov"** (`details.viac-udajov`), rozbalí sa samo, keď je v nich
  niečo vyplnené.
- Zoznam vo formulári (položky) na telefóne ako riadky, ktoré sa otvárajú **po jednom** na úpravu.
- **Uložiť** je na telefóne lepkavé dole (`.lepkave-akcie`), cez celú šírku.
- Údaje z inej časti appky (odberateľ, moje údaje) sa upravujú v okne cez „Viac údajov",
  nie odchodom z formulára.

## Písmo

Telo **Manrope**, nadpisy **Barlow Condensed**. Používame len tieto veľkosti:

| použitie | veľkosť / hrúbka |
|---|---|
| nadpis stránky (h1) | 22 px / 600 (telefón), 24 px na počítači |
| nadpis panela (h2) | 17 px / 600 |
| hlavný text v karte, suma | 15–16 px / 700 |
| bežný text, polia formulára | 14 px (polia 16 px – inak iPhone stránku priblíži) |
| drobný text (dátum, popis) | 13 px / 500 |
| štítky, popisy polí | 12 px / 700 – menšie nikdy |

Sumy vždy `tabular-nums`, zarovnané vpravo, jednotka „€" za číslom.

## Farby

- **Modrá (akcent)** = akcia a výber: hlavné tlačidlo, aktívna záložka, odkaz. Nie pozadie informácií.
- **Zelená** = prišli peniaze, uhradené. **Červená** = dlh po splatnosti, mazanie.
  **Oranžová** = pozor, blíži sa termín. Farba vždy niečo znamená, nie je ozdoba.
- Kategórie a firmy majú tlmené tóny `.ton-*` – rovnaká vec má všade rovnakú farbu.
- Kontrast aspoň AA v svetlom aj tmavom režime (kontroluje `npm run overenie`).

## Ovládanie

- Dotykový cieľ na telefóne aspoň **44 × 44 px** (aj keď ikona je menšia – väčšia plocha okolo).
- Jeden štýl ikonových tlačidiel: bez rámčeka, sivá ikona, pri stlačení podklad `--soft`.
- Nevratná akcia sa pýta (`potvrd()`), vratná ponúkne **Vrátiť späť** (`oznam()`).
- Texty podľa [CLAUDE.md](CLAUDE.md) – formálnejšie tykanie, bez hovorových slov, rodovo neutrálne.

## Kontrola

Každú zmenu vzhľadu over `npm run overenie` (šírka 390 px aj 1275 × 748, oba režimy) a ukáž
obrázkom z telefónu v tmavom režime – tak appku používa Oleg.
