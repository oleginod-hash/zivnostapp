# Živnosťapp — prehľad projektu

Zhrnutie pre rozhovor o projekte (napr. v chate). Návod na používanie je v [README.md](README.md).

## Čo to je

Appka pre jedného živnostníka (SZČO), ktorý pracuje na zákazkách v zahraničí formou turnusov.
Nahrádza Excel a papiere: faktúry, turnusy, objednávky, zmluvy, výdavky, podklad pre účtovníčku.
Beží lokálne na jeho počítači, dáta zostávajú u neho. Celé rozhranie je po slovensky.

## Ako je to postavené

- **Server:** Node 22, Express 4, TypeScript (ESM). Spúšťa sa `npm start` z `dist-server`.
- **Databáza:** SQLite cez better-sqlite3 (WAL), migrácie v poli v `server/db.ts` (aktuálne 14).
- **Klient:** React 18 + Vite 6, react-router, recharts. Build ide do `dist`, server ho servíruje.
- **AI:** Anthropic API cez backend (kľúč je v `.env`, nikdy v kóde ani v repozitári).
- **Prístup:** bez prihlásenia, server počúva len na `localhost` a odmieta cudzí `Host`/`Origin`.
- **Dáta mimo projektu:** databáza a prílohy v priečinku z `DATA_DIR` (predvolene `C:\ZivnostAppData`).

## Pravidlá, na ktorých appka stojí

- **Stav sa neukladá, odvodzuje sa.** Zaplatenosť faktúry vyplýva zo súčtu platieb, stav turnusu
  z dátumov, vyfakturovanosť objednávky zo súčtu faktúr. Nedá sa to rozsynchronizovať.
- **Príjem patrí do dňa, keď peniaze prišli,** nie keď bola faktúra vystavená (daňové pravidlo SZČO).
- **Zálohová faktúra môže kryť starší dlh** (`kryje_id`). Jej platby umorujú pôvodnú faktúru a do
  tržby sa nerátajú druhýkrát.
- **Súkromné príjmy** sa vedú pri výdavkoch (`expenses.druh = 'prijem'`), do podnikania nevstupujú.
- **Mazanie = kôš na 30 dní.** Faktúra sa vráti aj s platbami, výdavok a zmluva aj s prílohami.
- **AI pomocník nemaže nič.** Nemá mazací nástroj a vrstva, cez ktorú volá API, odmieta DELETE.
  Všetko, čo zapíše, sa dá vrátiť cez „vráť späť".

## Kde je čo

```
server/
  index.ts              spustenie, kontrola Host/Origin, servírovanie klienta
  db.ts                 pripojenie k SQLite + migrácie (jediné miesto na zmenu schémy)
  routes/               API: invoices, expenses, tours, orders, contracts, companies,
                        finance, taxreport, mail, allowance, search, trash, settings, ai
  lib/
    platby.ts           SQL na úhrady, otvorený zostatok a stav faktúry
    kos.ts              kôš (snapshot záznamu aj s väzbami)
    historiaZmien.ts    história zmien od AI + vrátenie späť
    invoicePdf.ts       PDF faktúry (pdfkit, PAY by square QR)
    podkladXlsx.ts      Excel pre účtovníčku (vlastný zápis XLSX, bez knižnice)
    aiNastroje.ts       nástroje pre AI pomocníka (volá vlastné API, nie databázu)
    aiPrompty.ts        systémové prompty asistentov (podľa Nastavení)
    pracovneDni.ts      slovenské sviatky a splatnosť v pracovných dňoch
client/src/
  pages/                obrazovky (Prehľad, Faktúry, Výdavky, Turnusy, …)
  components/           spoločné prvky (ikony, farby, štítky, prázdne stavy)
  styles.css            celý vzhľad: farebné premenné, svetlý/tmavý režim
```

## Čo appka vie

- **Faktúry:** zálohové aj bežné, čiastočné platby, krytie starého dlhu zálohou, PDF s QR kódom,
  odoslanie mailom, šablóny, splatnosť v kalendárnych alebo pracovných dňoch.
- **Turnusy:** obdobie práce u firmy, naviazané objednávky, faktúry a výdavky, stravné, dni v krajine.
- **Výdavky:** kategórie, daňová uznateľnosť, doklady (fotky/PDF), súkromné príjmy oddelene.
- **Financie a daňový podklad:** príjmy podľa platieb, výdavky, zisk, Excel a CSV pre účtovníčku.
- **AI asistent:** jeden – číta a zapisuje dáta, číta fotky dokladov a odpovedá aj na dane,
  odvody a zmluvy. Mazať nevie; všetko, čo zapíše, sa dá vrátiť.
- **Drobnosti:** globálne hľadanie bez diakritiky, skrytie súm, denná záloha, kôš,
  „Vrátiť späť" po ručných akciách, tmavý režim.

## Plány

Cieľom je ponúkať appku ďalším živnostníkom. Cieľovka: remeselníci a živnostníci 35–55 rokov,
papiere riešia večer unavení, telefón je ich hlavný počítač, boja sa, že niečo pokazia.

### Schválené a rozrobené

- **Tón textov** – celé rozhranie do formálnejšieho tykania, bez hovorových slov.
- **Sprievodca pri prvom spustení** – päť otázok namiesto 29 polí; Nastavenia rozdelené na
  „potrebné hneď" a „pre účtovníčku".
- **Mobilné rozloženie** – tabuľky ako karty, menu dole. Appka je teraz dostupná len
  z localhostu, prístup z telefónu treba vyriešiť zvlášť.
- **Prehľad** – väčšie preusporiadanie až podľa testu s ľuďmi.

### Neskôr (smer)

- **Skutočná appka do telefónu** – inštalovateľná, bez `npm` a súboru `.env`; AI kľúč zadaný
  v appke alebo žiadny.
- **Viac používateľov** – vlastné dáta pre každého, prihlásenie, zálohy mimo počítača.

### Nápady na funkcie (zatiaľ neschválené)

1. Import bankového výpisu (CSV) s automatickým párovaním platieb podľa VS a sumy; zvyšok ako
   súkromný príjem.
2. Rezerva na dane a odvody – „z každej platby si odlož X €"; evidencia zaplatených odvodov.
3. Kalendár termínov – daňové priznanie, preddavky, ročné zúčtovanie ZP, koniec zmlúv, splatnosti.
4. Cudzie meny vo výdavkoch (CZK, NOK, CHF) s kurzom k dátumu dokladu.
5. Výkaz hodín pri turnuse → faktúra na jeden klik, výkaz ako príloha PDF.
6. Balík pre účtovníčku – ZIP s Excelom a všetkými dokladmi po mesiacoch.
7. Šifrovaná záloha mimo počítača (OneDrive, Google Drive).
8. Fotka dokladu z telefónu cez QR kód, kým nie je appka do telefónu.
9. Časová os na faktúre (vystavená → odoslaná → upomienka → zaplatená), kostry pri načítaní,
   Ctrl+K aj na akcie („nová faktúra Dogma"), logo a šablóny PDF faktúry.
10. Povinná elektronická fakturácia – overiť, či a odkedy sa týka neplatiteľov DPH.

### Známe nedostatky na opravu

1. Číslo zmazanej faktúry sa použije znova — účtovne to nie je správne.
2. Fotky nad ~5 MB odmietne AI API.
3. PDF faktúra nepozná platiteľa DPH (vždy tlačí „Nie je platiteľ DPH").

### Overenie s ľuďmi

5–8 ľudí (remeselníci na turnusoch, živnostníci doma, účtovníčka, partnerka, ktorá rieši
papiere), 45–60 minút na ich počítači. Úlohy: zapísať doklad, vystaviť faktúru, zistiť kto
dlhuje, poslať upomienku, zapísať čiastočnú platbu, pripraviť podklad pre účtovníčku,
vrátiť omylom zmazanú faktúru. K tomu dvojtýždňový denníček počas turnusu.
