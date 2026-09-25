# Živnosťapp

Osobná appka na správu živnosti pracujúcej v zahraničí. Jeden používateľ, beží lokálne na PC.

## Spustenie

Najjednoduchšie: dvojklik na **`Spustit-Zivnostapp.bat`**. Otvorí sa prehliadač na `http://localhost:3000`.
Okno príkazového riadka nechaj otvorené — appka beží v ňom. Zavretím okna appku vypneš.

Alternatívne z príkazového riadka:

```bash
npm run build && npm start
```

Pri vývoji (automatické obnovovanie po zmene kódu):

```bash
npm run dev
```

Vývojový režim beží na `http://localhost:5173`, API na `3000`.

## Prvé spustenie

Pri prvom otvorení sa namiesto prázdneho Prehľadu ukáže **sprievodca**. Pýta sa na päť vecí, bez
ktorých sa nedá vystaviť správna faktúra: meno a IČO, adresu, IBAN, či pracuješ na turnusoch
v zahraničí, a DPH so splatnosťou. Podľa IČO doplní meno, adresu aj zápis v živnostenskom registri
z verejného registra. Každý krok sa hneď uloží; sprievodca sa dá preskočiť a kedykoľvek spustiť znova
tlačidlom *Sprievodca nastavením* v Nastaveniach.

**Nastavenia** sú rozdelené podľa toho, kedy ich treba: údaje na faktúre, platby, faktúry, zákazky
v zahraničí (aj so sadzbami stravného) a zložená časť *Pre účtovníčku* – predmety podnikania, dátum
vzniku živnosti, spôsob uplatnenia výdavkov a zdravotná poisťovňa –, ktorú netreba vyplniť hneď.

## Kontrola po zmenách

```bash
npm run overenie
```

Zostaví appku a spustí tri sady kontrol, každú nad dočasnou kópiou dát:

- **Logika servera** na vymyslených údajoch – platby a ich vrátenie, zálohové faktúry, kôš
  s prílohami, súkromné príjmy, hľadanie bez diakritiky, splatnosť v pracovných dňoch, dátum
  v slovenskom čase, automatická záloha, ochrana pred cudzími stránkami a to, že asistent nemôže mazať.
- **Kópia skutočných dát** – migrácie, neporušenosť databázy, všetky zoznamy a prehľady sa načítajú
  a súčty z rôznych miest appky sedia. Tvoje dáta sa len skopírujú, nič sa v nich nezmení.
- **Obrazovky** v neviditeľnom Chrome (1275 × 748 aj šírka telefónu, svetlý aj tmavý režim) – žiadne
  chyby, nič nepretŕča do strany, písmo aspoň 12 px, kontrast podľa normy, sprievodca prvým
  spustením, menu na telefóne, zmazanie a „Zaplatená" s vrátením späť.

Na konci vypíše *Všetko v poriadku* alebo presne to, čo nesedí. Keď chýba Chrome alebo skutočné
dáta, príslušnú sadu preskočí. Len vybrané sady: `node scripts/overenie/index.mjs api ui`.

## Kde sú dáta

Všetko je v priečinku nastavenom cez `DATA_DIR` v súbore `.env`, predvolene `C:\ZivnostAppData`
(na Macu a Linuxe `ZivnostAppData` v domovskom priečinku):

- `app.db` — databáza (faktúry, firmy, zmluvy, turnusy, výdavky, AI konverzácie, nastavenia)
- `files/zmluvy/` — naskenované zmluvy a ich prílohy
- `files/doklady/` — bločky a doklady k výdavkom
- `files/chat/` — fotky priložené do chatu s asistentom

Nepresúvaj tento priečinok do OneDrive — synchronizácia vie SQLite súbor poškodiť počas zápisu.

## Záloha

Dvojklik na **`Zaloha.bat`** (alebo `npm run zaloha`). Vytvorí kópiu databázy aj príloh do
`C:\ZivnostAppData\zalohy\RRRRMMDD-HHMM\`. Funguje aj keď appka práve beží.

Appka sa navyše **zálohuje sama raz denne** do `zalohy\RRRRMMDD-auto\`. Skontroluje to pri štarte
a potom každú hodinu, takže záloha pribudne aj vtedy, keď appka beží niekoľko dní bez reštartu.
Automatické zálohy staršie než 30 dní zmaže, ručné nechá. Prílohy do nich nekopíruje znova, ale
len na ne odkáže (pevný odkaz): každá záloha vyzerá ako úplná kópia a dá sa obnoviť skopírovaním
priečinka, no na disku nezaberá miesto navyše.

Zálohu si občas skopíruj aj mimo počítača — na USB kľúč alebo iný disk. Priečinok s dátami je
jediná kópia tvojich faktúr.

**Vylepšovanie appky dáta nemaže.** Kód a dáta sú v oddelených priečinkoch; pri štarte sa spúšťajú
len prírastkové migrácie, ktoré pridávajú nové stĺpce a tabuľky a existujúce riadky nechávajú tak.

## Vzhľad

Vľavo dole v menu prepneš **svetlý / tmavý režim**, alebo necháš *Auto* — vtedy sa appka riadi
nastavením Windows. Voľba sa pamätá.

Na úzkej obrazovke (telefón, úzke okno) sa appka prestaví: dole je lišta s najčastejšími stránkami
(Prehľad, Faktúry, Výdavky a Turnusy alebo Asistent), celé menu sa vysunie tlačidlom **Viac**
a tabuľky sa zobrazia ako karty s popisom pri každej hodnote. Z telefónu sa však k appke zatiaľ
nedostaneš – beží len na tomto počítači (pozri *Prístup*).

## Prístup

Appka sa nezamyká PIN-om. Namiesto toho je dostupná **len z tohto počítača**: server počúva iba na
lokálnej adrese (`localhost`), takže sa k nej nedá dostať z Wi-Fi ani z iného zariadenia v sieti.
Požiadavky, ktoré prídu pod inou adresou alebo zapisujú z cudzej webstránky, odmietne.
Kto si sadne k tvojmu odomknutému počítaču, appku otvorí — chráni ju heslo do Windows.

## Konfigurácia

Skopíruj `.env.example` na `.env` a vyplň. Súbor `.env` nikdy nepatrí do gitu.

## AI asistent

Appka má jedného **Asistenta**. Vie čítať aj zapisovať tvoje záznamy, čítať fotky dokladov
a odpovedať aj na otázky o daniach, odvodoch a zmluvách – pri nich si vie rovno pozrieť tvoje čísla.
Staršie rozhovory s bývalým Pomocníkom, Účtovníkom a Právnikom sú v jeho zozname konverzácií.

V **Nastaveniach → O mojej živnosti** je voľba *Pracujem na zákazkách v zahraničí (turnusy)*.
Zapnutá = asistent ráta s turnusmi, stravným, formulárom A1 a dvojitým zdanením a ponúka
k tomu príklady otázok; vypnutá = odpovedá ako bežnému živnostníkovi. Status DPH berie
z toho istého miesta.

Asistent potrebuje kľúč k Anthropic API. Vytvor si ho na
[console.anthropic.com](https://console.anthropic.com/), vlož do `.env` ako `ANTHROPIC_API_KEY=...`
a appku reštartuj. Bez kľúča funguje všetko ostatné normálne, len asistent hlási, že kľúč chýba.

Volania idú **výhradne cez backend** — kľúč sa nikdy nedostane do prehliadača. Účtuje ich Anthropic
podľa spotreby. Predvolený model je `claude-opus-5`; lacnejší `claude-sonnet-5` nastavíš cez
`ANTHROPIC_MODEL` v `.env`.

Otázku pošleš klávesom **Enter**, nový riadok spravíš cez **Shift + Enter**.

Fotky z mobilu appka pred odoslaním asistentovi zmenší na 2000 px na dlhšej strane – bloček ostane
čitateľný, nahrá sa rýchlejšie a zmestí sa do limitov Claude API.

### Čo asistent nevie

**Nemôže nič zmazať.** Nie je to len inštrukcia v prompte — chráni to dvojitá poistka: medzi
nástrojmi, ktoré má k dispozícii, žiadny mazací neexistuje, a vrstva, cez ktorú volá API appky,
metódu DELETE odmieta bez ohľadu na to, čo by skúsil. Mazanie ostáva ručnou akciou v appke.

## Stav modulov

- [x] Kostra — nastavenia, firmy
- [x] Faktúry — evidencia, stavy, PDF s QR kódom
- [x] Zmluvy s firmami — prílohy, kategórie, pripomienky expirácie
- [x] Turnusy a objednávky — väzba turnus → firma → objednávka → faktúra
- [x] Rozpočet a financie — výdavky s dokladmi, grafy, zisk podľa turnusov
- [x] AI účtovnícky a právny asistent
- [x] Globálne vyhľadávanie (Ctrl+K)
- [x] Automatické priradenie výdavkov k turnusu podľa dátumu
- [x] Objednávky na hodinovú sadzbu
- [x] Asistent s prístupom k dátam a rozpoznávaním fotiek dokladov
- [x] Čiastočné platby, zálohové faktúry kryjúce staré dlhy, prehľad dlhov
- [x] Prílohy (fotky, PDF, dokumenty) pri všetkých AI asistentoch
- [x] Záložky vo faktúrach (všetky / nevyplatené / vyplatené / zálohové) s odpočtom do splatnosti
- [x] Súkromné príjmy vedené vedľa výdavkov, mimo podnikania
- [x] Podklad pre účtovníčku ako zošit .xlsx
- [x] Prehľad ako rozcestník — každá oblasť má vlastnú dlaždicu s ukážkou
- [x] Hromadný výber v koši, vyprázdnenie celého koša
- [x] Skrytie všetkých súm jedným prepínačom
- [x] Údaje o živnosti (predmety podnikania, zápis v registri, DPH režim)
- [x] Nová podoba faktúry s farebným akcentom
- [x] Vzhľad podľa návrhu „Živnosťapp Dashboard" (Claude Design) – svetlý aj tmavý režim
- [x] Splatnosť faktúry v pracovných dňoch (bez víkendov a slovenských sviatkov)
- [x] Upozornenie, keď beží stará verzia appky a treba ju reštartovať
- [x] Appka bez PIN-u, dostupná len z tohto počítača
- [x] „Vrátiť späť" po zmazaní, označení zaplatenej faktúry a zrušení úhrady
- [x] Vlastné potvrdzovacie okná namiesto okien prehliadača
- [x] Čitateľnosť: písmo najmenej 12 px, kontrast podľa normy v oboch režimoch
- [x] Jeden AI asistent namiesto troch
- [x] Farebné rozlíšenie firiem a kategórií, prázdne zoznamy s prvým krokom
- [x] Texty vo formálnejšom tykaní, bez hovorových slov a účtovníckeho žargónu
- [x] Sprievodca pri prvom spustení (5 krokov, údaje z registra podľa IČO), Nastavenia rozdelené podľa potreby
- [x] Rozloženie pre telefón – spodná lišta, vysúvacie menu, tabuľky ako karty
- [x] Import výpisu z banky (CSV) s párovaním platieb podľa VS a sumy
- [x] Rezerva na dane a odvody s pripomienkou pri každej platbe
- [x] Kalendár termínov – splatnosti, zmluvy, turnusy, odvody, daňové priznanie
- [x] Fotky pre asistenta sa pred odoslaním zmenšia

### Stravné a dni v zahraničí

V **Nastaveniach** si zadáš sadzbu stravného na deň pre krajiny, kam chodievaš. Na detaile turnusu
potom appka spočíta `počet dní × sadzba` a jedným tlačidlom to zapíše medzi výdavky.
Sadzby si udržiavaš sám — menia sa a appka ti ich nepredpisuje.

Na stránke **Financie** vidíš, koľko dní si tento rok strávil v ktorej krajine, s ukazovateľom
k orientačnej hranici 183 dní. Appka daňovú rezidenciu nevyhodnocuje, len počíta dni z turnusov.

### Podklad pre daňové priznanie

Samostatná stránka so všetkým, čo od teba účtovníčka pýta. Dá sa vytlačiť, stiahnuť ako CSV,
alebo — a to je tá pohodlná cesta — ako **zošit .xlsx** s hárkami:

| Hárok | Čo obsahuje |
|---|---|
| Súhrn | identifikačné údaje, hlavné čísla, príjmy po mesiacoch, výdavky po kategóriách, dni v krajinách |
| Faktúry | každá faktúra so sumou, s tým, koľko z nej v danom roku reálne prišlo, a s otvoreným zostatkom |
| Platby | jednotlivé prijaté platby — ich súčet je príjem zo Súhrnu, takže sa dá odkontrolovať |
| Výdavky | rozpis po jednom doklade vrátane toho, či je k nemu priložený bloček |
| Súkromné príjmy | len ak nejaké sú; zvlášť, aby sa nepomýlili s tržbou |
| Turnusy | obdobia a počty dní |

Sumy sú v zošite skutočné čísla (nie text), dátumy skutočné dátumy — dajú sa filtrovať aj sčítať.

Kľúčová vec, ktorú si účtovníčka musí všimnúť: **do príjmu ide stĺpec „Prijaté v roku", nie
fakturovaná suma.** Faktúra uhradená cez zálohové faktúry má v tomto stĺpci nulu a v poznámke
vysvetlenie, pod ktorými číslami tie peniaze v príjme sú.

### Upomienky a odosielanie mailom

Stránka **Upomienky** ukazuje faktúry po splatnosti a koľko dní meškajú. Jedným tlačidlom pošleš
upomienku s predpripraveným textom (slovensky, anglicky alebo nemecky). Rovnako sa dá priamo
z faktúry poslať samotná faktúra — PDF sa priloží automaticky.

Vyžaduje SMTP údaje v `.env`. Pri Gmaile potrebuješ *heslo aplikácie*, nie bežné heslo k účtu.

### Kôš

Mazanie v appke znamená presun do **Koša**, kde záznam počká 30 dní a dá sa vrátiť späť – faktúra
aj s platbami a s väzbou na zálohové faktúry, ktoré ju kryli, výdavok a zmluva aj s prílohami.
Nenávratne sa dá zmazať len ručne priamo v Koši; vtedy (alebo po 30 dňoch) zmiznú z disku aj
súbory príloh.

Položky sa dajú zaškrtnúť (aj kliknutím kamkoľvek na riadok) a potom naraz **vrátiť späť**
alebo **zmazať natrvalo**. Tlačidlo *Vysypať celý kôš* sa pred tým spýta – Kôš je jediné
miesto v celej appke, kde sa dáta stratia nenávratne.

### Dlhy a zálohové faktúry

Všetko je priamo na stránke **Faktúry**, v záložkách nad filtrom:

- **Všetky** — kompletná evidencia vrátane konceptov
- **Nevyplatené** — čo má otvorený zostatok, zoradené od najdlhšie meškajúcej
- **Vyplatené** — plne uhradené
- **Zálohové faktúry** — zálohy, aj s tým, ktorý starý dlh kryjú

Vedľa dátumu splatnosti svieti maličké číslo: zelené `+22 d` znamená, koľko dní ešte do splatnosti
zostáva, červené `−170 d`, o koľko je faktúra po termíne.

Ku každej faktúre sa dajú zapisovať **čiastočné platby** s dátumom prijatia. Stav (nevyplatená /
čiastočne uhradená / vyplatená) sa z nich dopočíta sám.

Keď firma nedoplatí staré faktúry a namiesto toho pýta zálohové, označ zálohu ako typ
*Zálohová faktúra* a vyber, ktorú starú faktúru kryje. Prijatá záloha potom znižuje dlh na pôvodnej
faktúre — vidno to v stĺpcoch „Prijaté" a „Ešte dlhujú" a keď zálohy pokryjú celú sumu, faktúra
sa sama presunie medzi **Vyplatené**. Dlh sa pritom **nikde neráta dvakrát**: ani v „čaká na
zaplatenie", ani v príjmoch, ani v upomienkach.

### Vzhľad

Farby, písmo a rozloženie vychádzajú z návrhu *Živnosťapp Dashboard* z Claude Design. Písma
(Manrope a Barlow Condensed) aj ikony (Lucide) sú pribalené priamo v appke, takže všetko funguje
aj bez internetu. Všetky farby sú na jednom mieste na začiatku `client/src/styles.css` – tmavý
režim je len iná sada tých istých premenných.

### Splatnosť v pracovných dňoch

V **Nastaveniach → Faktúry** je pri predvolenej splatnosti prepínač **pracovné**. Keď je zapnutý,
nové faktúry dostanú splatnosť len v pracovných dňoch – bez sobôt, nedieľ a dní pracovného pokoja.
Platí to aj pre faktúry, ktoré vystaví AI asistent.

Rovnaký prepínač je aj priamo pri faktúre – tam sa dá režim zmeniť len pre tú jednu faktúru. Číslo
lehoty ostáva, posunie sa dátum.

Sviatky zodpovedajú stavu po zákone č. 261/2025 Z. z.: v roku 2026 nie sú dňami pracovného pokoja
8. máj a 15. september (dočasne), 1. september od roku 2025 a 17. november od roku 2026 (natrvalo).
Keby sa zákon znova zmenil, zoznam je v `server/lib/pracovneDni.ts` (používa ho server aj formulár). Vypočítaný dátum je vo
formulári vždy vidieť a dá sa prepísať ručne.

### Keď appka beží dlho

Po aktualizácii sa stránky načítajú nové hneď, ale server v pamäti ostáva starý, kým sa appka
nezavrie. Appka to sama zistí (porovnáva obsah svojho kódu, nie dátumy súborov) a hore ukáže
žltý pruh s výzvou na reštart.

### Faktúra v PDF

Faktúra obsahuje všetko, čo bežná slovenská faktúra: dodávateľa s IČO, DIČ, statusom DPH
a zápisom v živnostenskom registri (ten na obchodných listinách vyžaduje Obchodný zákonník),
kontaktné údaje, odberateľa aj s kontaktnou osobou, dátumy, rámček s platobnými údajmi a QR
kódom PAY by square, položky, súčet a miesto na pečiatku a podpis. Zálohová faktúra má vlastný
nadpis a odkaz na faktúru, ktorú kryje.

Farba akcentu sa dá zmeniť v **Nastaveniach → Faktúry**, kde je aj tlačidlo na ukážku.
Poznámky typu *„[odoslané na …]"*, ktoré si appka zapisuje pri odoslaní mailom, sa na faktúru
netlačia.

### Skryté sumy

Ikonka oka v bočnom paneli (vedľa prepínača témy) a tlačidlo na Prehľade nahradia všetky sumy
v appke hviezdičkami `*** €` — napríklad keď ti niekto pozerá cez plece. Voľba sa pamätá aj po
zatvorení appky. Vo formulároch pri úprave a v odpovediach AI asistentov sumy ostávajú, faktúry
v PDF sa nemenia.

### Prehľad

Úvodná stránka je rozcestník. Hore sú hlavné čísla (klikateľné — vedú rovno na príslušný
zoznam), pod nimi dlaždica za každú oblasť: posledné faktúry, financie za rok, posledné
výdavky, na čo idú peniaze, turnusy, čo je po splatnosti a posledné rozhovory s asistentom.
Každý riadok v tabuľke je odkaz na konkrétny záznam.

### Súkromné príjmy

Vo filtri *Kategória* je aj skupina **Podľa dane** — *Len daňovo uznateľné* a *Len neuznateľné*.
Je to najrýchlejšia cesta k tomu, čo pôjde do daňového podkladu.

Na stránke **Výdavky** je druhá záložka **Súkromné príjmy**. Patria tam peniaze, ktoré prišli na
účet, ale nie sú príjmom z podnikania — vklad vlastných peňazí, prevod od rodiny, vrátka z e-shopu.
Evidujú sa tu preto, že na bankovom výpise chodia spolu s výdavkami, takže sa dá výpis prepísať
naraz (aj cez asistenta zo screenshotu).

Do ničoho podnikateľského nevstupujú: nie sú v príjmoch, v zisku, ani v daňovom podklade.
V zošite pre účtovníčku majú vlastný hárok, aby sa nedali zameniť s tržbou.

### Príjmy a daň

Do príjmov sa ráta **dátum, kedy peniaze prišli na účet**, nie dátum vystavenia faktúry.
Faktúra vystavená v roku 2025 a zaplatená v roku 2026 patrí do príjmov roka 2026. Platí to
v Prehľade, Financiách aj v podklade pre daňové priznanie.

### Výpis z banky

V menu *Výpis z banky* nahráš výpis z internet bankingu vo formáte **CSV**. Appka z neho vezme
prichádzajúce platby a ku každej navrhne faktúru – podľa variabilného symbolu, a keď chýba, podľa
sumy (tá je označená „skontroluj"). Platbu môžeš priradiť aj k inej faktúre, zapísať ako súkromný
príjem alebo nezapísať. Zapíše sa až to, čo potvrdíš, a celý import sa dá hneď vrátiť.

Výpis sa dá nahrať aj viackrát – každý zapísaný pohyb si appka pamätá a druhýkrát ho nezapíše.
Zvláda bežné exporty slovenských bánk (kódovanie windows-1250 aj UTF-8, bodkočiarka aj čiarka,
desatinná čiarka aj bodka, variabilný symbol v stĺpci aj v správe „/VS…/SS/KS"). Keď stĺpce
nenájde, ponúkne ich priradiť ručne. Odchádzajúce platby sa nezapisujú – výdavok patrí zapísať
s dokladom.

### Rezerva na dane a odvody

Vo *Financiách* si nastavíš, koľko percent z každej prijatej platby si odkladáš na daň a odvody
(dá sa aj v Nastaveniach). Appka potom pri každej zapísanej platbe pripomenie „odlož si z nej X €"
a vo Financiách ukáže, koľko si mal za rok odložiť, koľko si už na daniach a odvodoch zaplatil
(výdavky v kategóriách *Daň* a *Odvody (SP/ZP)*, rozozná aj „Sociálna poisťovňa" a pod.) a koľko
má ešte zostať odložené. Daň appka nepočíta – percento treba prebrať s účtovníčkou.

### Termíny

Stránka *Termíny* a panel *Najbližšie termíny* na Prehľade ukazujú, čo ťa čaká: splatnosti
neuhradených faktúr, koniec zmlúv a posledný deň na výpoveď pri automatickej obnove, začiatok
turnusov. K tomu všeobecné termíny živnostníka – odvody do 8. dňa v mesiaci, daňové priznanie
do 31. marca a pri registrácii podľa § 7a súhrnný výkaz do 25. dňa (len keď boli v predchádzajúcom
mesiaci vystavené faktúry firmám s IČ DPH z inej krajiny EÚ). Termín na víkend alebo sviatok sa posunie
na najbližší pracovný deň. Všeobecné termíny sa dajú vypnúť v Nastaveniach.

### Číslovanie faktúr

Nová faktúra dostane nasledujúce voľné číslo – aj číslo faktúry, ktorá sa zmazala. Keď sa potom
zmazaná faktúra vracia z koša a jej číslo už má iná faktúra, appka ju nevráti a povie prečo.

### Vrátenie zmien

**Tvoje vlastné akcie:** po zmazaní, označení faktúry ako zaplatenej alebo zrušení úhrady sa
dole ukáže oznámenie s tlačidlom **Vrátiť späť**. Zmazané veci sú navyše 30 dní v Koši.

**Zmeny od asistenta:** všetko, čo asistent zapíše alebo upraví, sa dá vrátiť. Stačí mu napísať
*„vráť to"* alebo *„daj to ako predtým"*. Vrátenie úpravy obnoví pôvodné hodnoty aj platby;
záznam, ktorý asistent sám vytvoril, sa odstráni. Zoznam svojich zmien vypíše na požiadanie
(*„čo si menil?"*).
