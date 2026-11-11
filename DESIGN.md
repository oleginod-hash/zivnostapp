# Živnosťapp – pravidlá vzhľadu

Podľa tohto súboru sa robí každá nová obrazovka aj úprava starej. Farby, písmo a rozostupy sú
premenné v [client/src/styles.css](client/src/styles.css) – tu je, **ako** ich používať.

## Pre koho

Remeselníci a živnostníci 35–55 rokov, papiere riešia večer unavení, telefón je ich hlavný
počítač. Preto: **pokojne, čitateľne, málo vecí naraz**. Každá obrazovka odpovedá na jednu otázku
(„kto mi dlhuje", „čo som minul") a hlavná akcia je vždy na očiach.

## Vzor rozloženia

**Rozloženie** berieme z bežných fakturačných appiek (vzor: KROS Fakturácia) – kompaktné zoznamy,
„Viac údajov", Uložiť dole. **Vzhľad** je moderný podľa bankových a platobných appiek, ktoré si
používateľ vybral ako vzor (november 2026): pokojný svetlosivý podklad, biele karty s veľkým
zaoblením bez rámčeka a tieňa, tlačidlá a štítky ako pilulky, veľké čísla, navrchu jemný farebný
opar. Tieň má len to, čo sa vznáša nad stránkou (spodná lišta, ponuka ⋮, okno, oznámenie).

## Obrazovka na telefóne (pod 820 px)

1. **Hlavička:** názov stránky vľavo, vpravo najviac **jedno** hlavné tlačidlo (napr. „+ Nová faktúra")
   alebo „Späť". Menej časté akcie idú do ponuky **⋮** (`MenuAkcii`). Detail záznamu (turnus,
   objednávka, faktúra) má na telefóne „Späť" a ⋮ s akciami ako *Vystaviť faktúru*.
2. **Záložky** (ak sú): mriežka po dve, počet vpravo (`.taby`).
3. **Hľadanie + tlačidlo Filter** v jednom riadku (`HladanieSFiltrom` v `components/Zoznam.tsx`).
   Ďalšie výbery (firma, turnus, rok, dátumy) sú schované pod Filtrom – zoznam musí začínať na prvej
   obrazovke.
4. **Súhrn** jedným riadkom nad zoznamom („4 faktúry · spolu 6 220 € · čaká 2 420 €").
5. **Zoznam** – pozri nižšie.
6. Dole je **plávajúca spodná lišta** (5 položiek, pilulka nad obsahom); vo formulári nad ňou
   **lepkavé Uložiť**.

**Prehľad na telefóne** ukazuje len dve veci: navrchu **Rýchle akcie** (tri dlaždice vedľa seba)
a pod nimi **Finančný prehľad**. Ostatné časti Prehľadu (faktúry, termíny, turnus, asistent) sú len
na počítači – rozhodnutie používateľa (november 2026).

## Zoznam záznamov

Každý záznam má **tri riadky** – súčasť `ZaznamRiadok` (`components/Zoznam.tsx`), použitá vo
Faktúrach, Výdavkoch a Turnusoch. Záznamy jedného zoznamu sú spolu **v jednej bielej karte**
a oddeľuje ich len tenká linka (nie samostatné karty s medzerami):

| riadok | vľavo | vpravo |
|---|---|---|
| 1 | identifikátor (číslo, dátum) drobne | ponuka ⋮ |
| 2 | hlavný text tučne (odberateľ, popis výdavku, názov turnusu) | – |
| 3 | stav (štítok) a drobná doplnková informácia | suma tučne |

- Ťuknutie na kartu otvorí detail. Úpravy a mazanie sú v ⋮ – nie ako ikony v každej karte.
- Hlavná akcia obrazovky (Poslať upomienku, Vrátiť späť z koša, Vystaviť faktúru zo šablóny) môže byť
  tlačidlom v päte karty (`pata`) cez celú šírku.
- Spoločné karty: `FakturaKarta` (faktúry, Prehľad), `FakturaVZozname` (pri turnuse a objednávke),
  `ObjednavkaKarta`.
- Karta nemá popisy pri každej hodnote („Dátum: …") – poradie riadkov je vždy rovnaké.
- Tabuľky s popismi pri každej bunke (`table[data-karty]`) sú len náhradné riešenie pre zriedkavé
  zoznamy; nový zoznam robíme ako kartu v troch riadkoch.
- Súhrnné čísla (Príjmy, Výdavky, Čaká…) sú **zoznam riadkov** v jednom paneli – popis vľavo,
  suma vpravo (`.karty.kompaktne` na telefóne), nie mriežka dlaždíc. Výnimka: štyri hlavné čísla
  na Prehľade ostávajú v mriežke 2 × 2 (rozhodnutie používateľa, 1. 10. 2026).
- Súhrn nad zoznamom faktúr je **jeden riadok** v celých eurách („spolu · uhradené · čaká") –
  rovnaký na telefóne aj na počítači, zmestia sa aj päťciferné sumy.

## Formulár

Vzor: faktúra (`FakturaEdit`).

- Najprv polia, ktoré sa vypĺňajú vždy; krátke polia (dátumy, PSČ, IČO/DIČ) **po dve vedľa seba**.
- Zriedkavé polia pod **„Viac údajov"** (`details.viac-udajov`), rozbalí sa samo, keď je v nich
  niečo vyplnené.
- Zoznam vo formulári (položky) na telefóne ako riadky, ktoré sa otvárajú **po jednom** na úpravu.
- **Uložiť** je na telefóne lepkavé dole (`.lepkave-akcie`), cez celú šírku, bez čiary – obsah sa
  nad ním stráca do podkladu a za spodnou lištou neprebleskuje. Vo formulári v paneli (výdavok,
  firma, turnus) je lišta vnútri panela – drží sa dole, kým je panel na obrazovke.
- Číselné polia cez `CisloPole` – dajú sa celé vymazať (obyčajné pole by v nich nechalo „0").
  Prázdne číslo sa ukazuje ako prázdne pole s nápovedou „0,00", nie ako nula.
- Na telefóne sa formulár neotvára s klávesnicou (`autoFocus` len na počítači).
- Rady tlačidiel (`.riadok-akcii`) sa na telefóne zalamujú a tlačidlá vyplnia šírku – nič nesmie
  vyliezť zo strany (`npm run overenie` kontroluje aj prvky mimo obrazovky vľavo).
- Údaje z inej časti appky (odberateľ, moje údaje) sa upravujú v okne cez „Viac údajov",
  nie odchodom z formulára.

## Písmo

Jedno písmo na všetko: **Instrument Sans** (400–700, pribalené v appke cez `@fontsource`, nič sa
nesťahuje z internetu). Používame len tieto veľkosti:

| použitie | veľkosť / hrúbka |
|---|---|
| nadpis stránky (h1) | 26 px / 700 (telefón), 30 px na počítači |
| nadpis panela (h2) | 18 px / 700 |
| hlavný text v karte, suma | 15–16 px / 700 |
| bežný text, polia formulára | 14–15 px (polia na telefóne 16 px – inak iPhone stránku priblíži) |
| drobný text (dátum, popis) | 13 px / 500 |
| štítky, popisy polí | 12 px / 600 – menšie nikdy |
| veľké sumy na Prehľade | 32 px / 700 (telefón 25 px), centy drobnejšie (`VelkaSuma`, `.centy`) |

Polovičné veľkosti (12,5 px, 13,5 px…) nepoužívame – zaokrúhľujú sa nahor.

Sumy vždy `tabular-nums`, zarovnané vpravo, jednotka „€" za číslom.

## Farby

Každá farba má jednu úlohu – farba vždy niečo znamená, nie je ozdoba:

- **Čierna pilulka** (v tmavom režime biela, `--primar`) = hlavná akcia obrazovky. Jedna na obrazovku.
- **Limetková** (`--accent`) = „kde práve si": aktívna položka v menu a v spodnej lište, počet pri
  vybranej záložke, zvýraznený výsledok hľadania, otvorená konverzácia, riadok pod kurzorom.
  K tomu pár drobných iskier, aby značkovú farbu bolo vidno na každej obrazovke (želanie používateľa,
  november 2026): znak „+" a ikona na čiernej pilulke (`.plus-znak`, len svetlý režim – na bielej
  pilulke tmavého režimu by sa nedala čítať), krátke bliknutie pri stlačení hlavného tlačidla,
  zaškrtnuté políčko, označený text, krúžok pri prázdnom zozname. Jediná **limetková plocha** je
  dlaždica **Zostatok** na Prehľade (`.kpi-bunka.hlavna`) – text na nej je tmavý (`--naAkcente`,
  `--naAkcenteJemne`). Nie ďalšie plochy, nie tlačidlá, nie text na svetlom podklade.
- **Biela pilulka na sivej dráhe** (`--vyber` na `--track`) = vybraná možnosť: záložky, prepínač
  obdobia, prepínač režimu.
- **Zelená** = prišli peniaze, uhradené. **Červená** = dlh po splatnosti, mazanie.
  **Oranžová** = pozor, blíži sa termín.
- Kategórie a firmy sú sivé štítky s malou farebnou bodkou (`.ton-*`, `FarebnyCip`) – rovnaká vec
  má všade rovnakú bodku.
- **Grafy:** hlavný rad vo farbe `--graf` (tmavá vo svetlom režime, limetková v tmavom), druhý rad
  sivý `--grafDruhy`. Porovnanie kategórií je zoradený zoznam s pruhom, nie koláčový graf –
  kategórie tak nepotrebujú desať rôznych farieb.
- Kontrast aspoň AA v svetlom aj tmavom režime (kontroluje `npm run overenie`).

## Ovládanie

- Dotykový cieľ na telefóne aspoň **44 × 44 px** (aj keď ikona je menšia – väčšia plocha okolo).
  Odkaz mimo vety (Zobraziť všetky →) má neviditeľnú plochu navyše cez záporný okraj. Kontroluje
  to `npm run overenie` na každej obrazovke. Naoko menšie tlačidlo (prepínač obdobia, prepínač
  „pracovné" pri splatnosti) má neviditeľnú plochu 44 px okolo (`plocha-44` alebo vlastné `::after`)
  a test ho preto neráta medzi malé.
- Jeden štýl ikonových tlačidiel: bez rámčeka, sivá ikona, pri stlačení podklad `--soft`.
- Nevratná akcia sa pýta (`potvrd()`), vratná ponúkne **Vrátiť späť** (`oznam()`).
- Texty podľa [CLAUDE.md](CLAUDE.md) – formálnejšie tykanie, bez hovorových slov, rodovo neutrálne.

## Kontrola

Každú zmenu vzhľadu over `npm run overenie` (šírka 390 px aj 1275 × 748, oba režimy) a ukáž
obrázkom z telefónu v tmavom režime – tak appku používa Oleg.
