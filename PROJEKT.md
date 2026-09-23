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
- **AI asistenti:** Pomocník (číta a zapisuje dáta, číta fotky bločkov), Účtovník, Právnik.
- **Drobnosti:** globálne hľadanie bez diakritiky, skrytie súm, denná záloha, kôš, tmavý režim.

## Stav a čo je rozrobené

Appka je v každodennom používaní. Otvorené veci, o ktorých sa vieme baviť:

1. Denná záloha sa robí len pri spustení appky a zálohy narastajú (kopírujú všetky prílohy).
2. Predvolený priečinok dát je v kóde zapísaný chybne (bez `.env` skončí v priečinku appky).
3. Číslo zmazanej faktúry sa použije znova — účtovne to nie je správne.
4. Fotky nad ~5 MB odmietne AI API.
5. Čas na serveri sa ráta v UTC, nie v slovenskom čase.
6. PDF faktúra nepozná platiteľa DPH (vždy tlačí „Nie je platiteľ DPH").
7. Pre viacerých používateľov by sa hodilo krátke uvítanie s otázkami (DPH, zahraničie, typ výdavkov),
   z ktorých sa nastavia asistenti aj faktúra.
