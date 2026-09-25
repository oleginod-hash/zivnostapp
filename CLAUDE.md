# Živnosťapp – pokyny pre Claude

Lokálna appka pre jedného živnostníka (SZČO), ktorý pracuje na turnusoch v zahraničí. Beží na jeho
počítači, rozhranie je po slovensky. Prehľad architektúry je v [PROJEKT.md](PROJEKT.md), návod
na používanie v [README.md](README.md).

## Kam projekt smeruje

- **Cieľ: ponúkať appku ďalším živnostníkom.** Každé rozhodnutie posudzuj aj očami nového
  používateľa, nielen Olega.
- **Nič osobné napevno v kóde** (meno, firmy, zahraničie, DPH). Všetko z Nastavení; texty
  a príklady sa riadia profilom (`settings.praca_v_zahranici`, `settings.dph_rezim`).
- **Cieľovka:** remeselníci a živnostníci 35–55 rokov, papiere riešia večer unavení, telefón je
  ich hlavný počítač. Z toho plynie: veľké písmo, jednoduchý jazyk, ochrana pred omylmi
  („Vrátiť späť"), žiadny účtovnícky pojem bez vysvetlenia.
- **Plán:** mobilné rozloženie → skutočná appka do telefónu → viac používateľov. Rozhodnutie,
  ktoré by niektorý krok zablokovalo (napr. natvrdo lokálne cesty), najprv konzultuj.
- Úplný zoznam plánov, nápadov a známych nedostatkov je v sekcii „Plány" v PROJEKT.md.

## Príkazy

- `npm run dev` – vývoj (API na :3000, Vite na :5173)
- `npm run build` – zostavenie klienta (Vite → `dist`) aj servera (tsc → `dist-server`)
- `npm start` – spustenie zostavenej appky na porte 3000
- `npx tsc -p tsconfig.json --noEmit` – typová kontrola klienta aj servera
- `npm run overenie` – zostaví appku a spustí testy v `scripts/overenie/` (logika servera na
  vymyslených údajoch, kópia skutočných dát, obrazovky v headless Chrome). Spusti pred každým
  commitom; pri novej funkcii pridaj kontrolu do `api.mjs` alebo `ui.mjs`.

## Nemenné pravidlá

1. **Produkčné dáta v `C:\ZivnostAppData` nikdy nemeniť.** Na testy skopíruj `app.db`, `app.db-wal`
   aj `app.db-shm` do scratchpadu a spusti `dist-server/index.js` s vlastným `DATA_DIR` a `PORT`
   (`npm run overenie` to robí samo).
2. **Bežiacu appku na porte 3000 nevypínaj.** Po zmene servera povedz používateľovi, nech ju zatvorí
   a spustí znova.
3. **Obrazovky over neviditeľne** cez headless Chrome (CDP) vo veľkosti jeho okna 1275 × 748.
   Browser pane nepoužívaj.
4. **Kľúče a heslá len v `.env`** (je v `.gitignore`). Nikdy do kódu ani do gitu.
5. **AI asistent nesmie mazať.** Nemá mazací nástroj a `server/lib/internyKlient.ts` odmieta DELETE.
6. **Commit a push len na výslovnú žiadosť** používateľa.
7. **Appka je bez PIN-u** – používateľ ho nechce. Chráni ju len to, že server počúva na
   localhost a odmieta cudzí `Host` aj `Origin`. Nikdy ju nesprístupni do siete bez inej ochrany.

## Doménové pravidlá – nerozbiť

- Stav faktúry sa neukladá, odvodzuje sa z platieb (`server/lib/platby.ts`: `UHRADENE_SQL`,
  `STAV_SQL`). V `invoices.stav` je len `koncept` alebo `vystavena`.
- Príjem patrí do dňa platby (`invoice_payments.datum`), nie do dňa vystavenia faktúry.
- Zálohová faktúra s `kryje_id` spláca staršiu faktúru. Do tržby ani do „vyfakturovaného" sa
  neráta druhýkrát (`VYFAKTUROVANE_SQL`).
- Súkromné príjmy sú v `expenses` s `druh = 'prijem'` – mimo všetkých podnikateľských súčtov a dane.
- Mazanie = kôš na 30 dní (`server/lib/kos.ts`), snapshot aj s platbami, krytím a prílohami.
- Úprava nastavení, firiem a faktúr je zlúčenie: pole, ktoré v požiadavke chýba, ostáva.
- Schéma databázy sa mení len novou migráciou na konci poľa v `server/db.ts`. Staré nikdy neupravuj.
- **Faktúra v PDF** obsahuje všetko, čo vzorová faktúra z KROS-u: dodávateľa so zápisom
  v registri, odberateľa s kontaktnou osobou, dátumy, platobné údaje s QR kódom PAY by square,
  položky a miesto na podpis. Nikdy nie pätičku „Doklad obsahuje ISDOC… www.kros.sk".
- Splatnosť v pracovných dňoch počíta so slovenskými sviatkami podľa zákona 261/2025
  (`server/lib/pracovneDni.ts`).
- Dnešný dátum v SQL je `dnes()` (časové pásmo appky, `CASOVE_PASMO`), nikdy `date('now')` –
  to je UTC a po polnoci by appka žila ešte vo včerajšku. V kóde servera `dnesISO()` z `lib/format.ts`.
- Číslo zmazanej faktúry sa pri novej faktúre **použije znova** – používateľ to tak chce
  (rozhodol 2026-09-24, pokus o opak vrátil). Nemeniť bez jeho súhlasu.
- Výpis z banky: každý zapísaný pohyb má odtlačok v `bankove_pohyby` – ten istý výpis sa nezapíše
  dvakrát, import sa dá vrátiť a zmazaním platby sa pohyb zabudne (ON DELETE CASCADE).
- Rezerva na dane a odvody je len percento z Nastavení – daň appka nepočíta. Zaplatené dane
  a odvody rozoznáva podľa kategórie výdavku (`server/lib/rezerva.ts`).
- Zákonné termíny (odvody do 8., daňové priznanie 31. 3., súhrnný výkaz do 25. pri § 7a) sú
  pripomienky s posunom na pracovný deň v `server/routes/terminy.ts` – pri zmene zákona uprav tam.
- Uložená príloha sa už nikdy nemení na mieste – automatická záloha na ňu robí pevný odkaz, takže
  prepísanie súboru by zmenilo aj všetky zálohy. Upravená príloha = nový súbor.

## Štýl

- **Texty v rozhraní:** slovenčina, formálnejšie tykanie, bez hovorových slov („spočíta", nie
  „zráta"; „vyprázdniť kôš", nie „vysypať"). Slová „turnus" a „appka" ostávajú.
  - Zaužívané pojmy: *splátka* (zálohová faktúra s `kryje_id`, nie „kryje"), *doklad* (nie „bloček"),
    *hodinová sadzba* (nie „hodinovka"), *e-mail* (nie „mail"), *asistent* (nie „AI pomocník").
  - „Môcť", nie „vedieť" v zmysle schopnosti („budeš môcť pridať", nie „budeš vedieť pridať").
  - Rodovo neutrálne vety – papiere často vybavuje partnerka („vystavené faktúry", nie „si vystavil").
  - Pomlčka vo vete je krátka s medzerami ( – ), nie dlhá (—).
- **Kód:** názvy a komentáre po slovensky ako v celom projekte; komentáre vysvetľujú prečo.
- **Vzhľad:** premenné v `client/src/styles.css` (svetlá téma `:root`, tmavá `[data-tema='tmavy']`),
  farebné tóny `.ton-*`. Spoločné prvky sú v `client/src/components` (Farby, Oznamenia,
  PrazdnyStav, StitokStavu, Ikony) – použi ich, nekopíruj.
- Písmo najmenej 12 px, kontrast aspoň AA v oboch témach.
- **Telefón (pod 820 px):** tabuľky s viac ako tromi stĺpcami sa samy zobrazia ako karty – popisy
  buniek dopĺňa `App.tsx` zo záhlavia stĺpca, takže nová tabuľka potrebuje `<thead>`. Bunku, ktorá má
  byť nadpisom karty (keď to nie je prvý stĺpec), označ `className="hlavna-bunka"`. `npm run overenie`
  kontroluje každú obrazovku aj na šírke 390 px.
- Potvrdenia cez `potvrd()` a oznámenia cez `oznam()` z `components/Oznamenia.tsx`, nikdy
  `confirm()` ani `alert()`. Po vratnej akcii ponúkni „Vrátiť späť".

## Komunikácia

- Používateľ nie je programátor. Vysvetľuj jednoducho a po slovensky.
- Výsledky ukazuj obrázkami obrazoviek. Často píše z mobilu cez diaľkové ovládanie – vtedy
  odpovedaj stručne.

## Nástroje na Windows

- Git Bash v dlhých heredococh mení spätné lomky. Väčšie úpravy textu zapíš ako skript nástrojom
  Write a spusti ho cez `python` alebo `node`.
