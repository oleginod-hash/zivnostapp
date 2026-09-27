# Živnosťapp — prehľad projektu

Zhrnutie pre rozhovor o projekte (napr. v chate). Návod na používanie je v [README.md](README.md).

## Čo to je

Appka pre jedného živnostníka (SZČO), ktorý pracuje na zákazkách v zahraničí formou turnusov.
Nahrádza Excel a papiere: faktúry, turnusy, objednávky, zmluvy, výdavky, podklad pre účtovníčku.
Beží lokálne na jeho počítači, dáta zostávajú u neho. Celé rozhranie je po slovensky.

## Ako je to postavené

- **Server:** Node 22, Express 4, TypeScript (ESM). Spúšťa sa `npm start` z `dist-server`.
- **Databáza:** SQLite cez better-sqlite3 (WAL), migrácie v poli v `server/db.ts` (aktuálne 26).
- **Klient:** React 18 + Vite 6, react-router, recharts. Build ide do `dist`, server ho servíruje.
- **AI:** Anthropic API cez backend (kľúč je v `.env`, nikdy v kóde ani v repozitári).
- **Prístup:** bez prihlásenia, server počúva len na `localhost` a odmieta cudzí `Host`/`Origin`.
  Z telefónu cez Tailscale (`tailscale serve`, len súkromná sieť) – `server/lib/pristup.ts`.
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
    dph.ts              výpočet DPH na faktúre (zdieľa ho aj klient)
    pristup.ts          prístup z telefónu cez Tailscale (povolené adresy, zapnutie)
    kurzy.ts            kurzy ECB pre výdavky v cudzej mene
    efaktura.ts, xml.ts čítanie prijatej e-faktúry (UBL, CII)
    vykazHodin.ts       výkaz hodín pri turnuse a jeho PDF
    odhadKategorie.ts   kategória výdavku podľa príjemcu platby (výpis z banky)
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
- **Výpis z banky:** CSV z internet bankingu, platby sa párujú k faktúram podľa VS a sumy,
  odchádzajúce platby sa navrhnú ako výdavky alebo spárujú s už zapísanými.
- **Výdavky navyše:** cudzia mena s kurzom ECB, výdavok z e-faktúry (UBL/CII) aj s vloženým PDF.
- **Výkaz hodín pri turnuse:** hodiny po dňoch, faktúra za turnus, výkaz v PDF na podpis.
- **Platiteľ DPH:** sadzby pri položkách, rekapitulácia v PDF, prenesenie daňovej povinnosti,
  prehľad DPH po obdobiach, odpočet z výdavkov, termíny priznania.
- **Faktúra v PDF:** logo, tri vzhľady (klasický, úsporný, výrazný), časová os faktúry v appke,
  číslo objednávky odberateľa a úvodný text.
- **Rozloženie faktúr** podľa bežných fakturačných appiek (vzor KROS – len rozloženie, vzhľad vlastný):
  zoznam v troch riadkoch s ponukou ⋮, „Viac údajov", odberateľ a dodávateľ upraviteľní z faktúry.
- **Rezerva na dane a odvody:** percento z každej platby, odrátanie zaplatených daní a odvodov.
- **Termíny:** splatnosti, zmluvy, turnusy, odvody, daňové priznanie, súhrnný výkaz pri § 7a.
- **AI asistent:** jeden – číta a zapisuje dáta, číta fotky dokladov a odpovedá aj na dane,
  odvody a zmluvy. Mazať nevie; všetko, čo zapíše, sa dá vrátiť.
- **Prvé spustenie:** sprievodca s piatimi otázkami (údaje z registra podľa IČO), Nastavenia
  rozdelené na údaje na faktúru a zloženú časť pre účtovníčku.
- **Telefón:** pod 820 px spodná lišta, vysúvacie menu a tabuľky ako karty; prístup cez
  Tailscale s QR kódom, „Pridať na plochu" (manifest a ikony), odfotenie dokladu cez QR.
- **Drobnosti:** globálne hľadanie bez diakritiky, skrytie súm, denná záloha, kôš,
  „Vrátiť späť" po ručných akciách, tmavý režim.

## Plány

Cieľom je ponúkať appku ďalším živnostníkom. Cieľovka: remeselníci a živnostníci 35–55 rokov,
papiere riešia večer unavení, telefón je ich hlavný počítač, boja sa, že niečo pokazia.

### Hotové na skúšku (2026-09-26, dá sa vrátiť)

Prístup z telefónu (Tailscale), QR na odfotenie dokladu, cudzie meny, výdavok z e-faktúry,
výpis z banky pre výdavky, výkaz hodín, platiteľ DPH (jedno rozhranie pre všetkých – SZČO aj
prípadné s.r.o. sa líšia len voľbami v Nastaveniach), logo, vzhľady PDF a časová os faktúry.

### Rozrobené

- **Dizajn** – kritika obrazoviek, vlastný DESIGN.md (pravidlá vzhľadu) a podľa neho úprava ďalších
  obrazoviek. Vzor rozloženia: KROS, vzhľad vlastný.
- **Prehľad** – väčšie preusporiadanie až podľa testu s ľuďmi.

### Budúce kroky (ešte prebrať s používateľom)

- **Skutočná appka do telefónu** – inštalovateľná, bez `npm` a súboru `.env`; AI kľúč zadaný
  v appke alebo žiadny. Prístup cez Tailscale je zatiaľ medzikrok.
- **Viac používateľov** – vlastné dáta pre každého, prihlásenie, zálohy mimo počítača.
  E-maily s faktúrami: predvolene cez e-mailovú službu appky (napr. Postmark, Brevo) s odpoveďou
  na e-mail živnostníka, voliteľne z vlastnej schránky (SMTP zadané v Nastaveniach, heslo zašifrované).

### Nápady

1. **Vystavovanie e-faktúr (XML UBL) cez digitálneho poštára** – povinné od 1. 1. 2027 pre
   platiteľov DPH (tuzemské faktúry). Neplatiteľ e-faktúry len prijíma (to už appka vie načítať).
2. Pripomienka „vyber si digitálneho poštára do 31. 12. 2026" a krátky návod v appke.
3. Kostry pri načítaní, Ctrl+K aj na akcie („nová faktúra Dogma").
4. Výpis z banky priamo z banky cez API.
5. Balík pre účtovníčku (ZIP s dokladmi) – *zatiaľ nie*.
6. Šifrovaná záloha mimo počítača – *zatiaľ nie*.

### Známe nedostatky na opravu

1. Platiteľ DPH: zálohová faktúra nie je daňový doklad – daňový doklad k prijatej platbe
   (do 15 dní) appka zatiaľ nevystavuje; prehľad DPH zálohy nepočíta.
2. Platiteľ DPH: e-faktúru (XML) zatiaľ nevie vystaviť – pozri Nápady 1.

### Overenie s ľuďmi

5–8 ľudí (remeselníci na turnusoch, živnostníci doma, účtovníčka, partnerka, ktorá rieši
papiere), 45–60 minút na ich počítači. Úlohy: zapísať doklad, vystaviť faktúru, zistiť kto
dlhuje, poslať upomienku, zapísať čiastočnú platbu, pripraviť podklad pre účtovníčku,
vrátiť omylom zmazanú faktúru. K tomu dvojtýždňový denníček počas turnusu.
