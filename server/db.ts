import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import 'dotenv/config'
import { naHladanie } from './lib/format.js'

export const DATA_DIR = process.env.DATA_DIR?.trim() || 'C:\ZivnostAppData'
export const FILES_DIR = path.join(DATA_DIR, 'files')

fs.mkdirSync(FILES_DIR, { recursive: true })

export const db = new Database(path.join(DATA_DIR, 'app.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Hľadanie bez ohľadu na veľké písmená a diakritiku. Vstavaný LIKE to vie len
// pri písmenách bez mäkčeňov – „ľubica" by „Ľubica" nenašla.
db.function('bez_diakritiky', { deterministic: true }, (text: unknown) => naHladanie(String(text ?? '')))

/**
 * Migrácie. Každá položka posunie schému o jednu verziu vyššie.
 * Nikdy neupravuj už nasadenú migráciu – pridaj novú na koniec.
 */
const migrations: string[] = [
  // 1 – kostra: prihlásenie, nastavenia, firmy, faktúry
  `
  CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    meno           TEXT NOT NULL DEFAULT '',
    adresa         TEXT NOT NULL DEFAULT '',
    psc_mesto      TEXT NOT NULL DEFAULT '',
    krajina        TEXT NOT NULL DEFAULT 'Slovensko',
    ico            TEXT NOT NULL DEFAULT '',
    dic            TEXT NOT NULL DEFAULT '',
    zapis          TEXT NOT NULL DEFAULT '',
    email          TEXT NOT NULL DEFAULT '',
    telefon        TEXT NOT NULL DEFAULT '',
    iban           TEXT NOT NULL DEFAULT '',
    swift          TEXT NOT NULL DEFAULT '',
    banka          TEXT NOT NULL DEFAULT '',
    cislo_vzor     TEXT NOT NULL DEFAULT '{RRRR}{NNN}',
    splatnost_dni  INTEGER NOT NULL DEFAULT 14,
    poznamka_pati  TEXT NOT NULL DEFAULT 'Nie som platiteľ DPH.'
  );

  INSERT INTO settings (id) VALUES (1);

  CREATE TABLE companies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nazov      TEXT NOT NULL,
    adresa     TEXT NOT NULL DEFAULT '',
    psc_mesto  TEXT NOT NULL DEFAULT '',
    krajina    TEXT NOT NULL DEFAULT '',
    ico        TEXT NOT NULL DEFAULT '',
    dic        TEXT NOT NULL DEFAULT '',
    ic_dph     TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    telefon    TEXT NOT NULL DEFAULT '',
    poznamka   TEXT NOT NULL DEFAULT '',
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cislo          TEXT NOT NULL UNIQUE,
    company_id     INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    datum_vystav   TEXT NOT NULL,
    datum_dodania  TEXT NOT NULL,
    datum_splat    TEXT NOT NULL,
    stav           TEXT NOT NULL DEFAULT 'vystavena',
    datum_uhrady   TEXT,
    variabilny     TEXT NOT NULL DEFAULT '',
    poznamka       TEXT NOT NULL DEFAULT '',
    suma           REAL NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE invoice_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    poradie    INTEGER NOT NULL DEFAULT 0,
    popis      TEXT NOT NULL,
    mnozstvo   REAL NOT NULL DEFAULT 1,
    jednotka   TEXT NOT NULL DEFAULT 'ks',
    cena       REAL NOT NULL DEFAULT 0
  );

  CREATE INDEX idx_invoices_stav ON invoices(stav);
  CREATE INDEX idx_invoices_company ON invoices(company_id);
  CREATE INDEX idx_items_invoice ON invoice_items(invoice_id);
  `,

  // 2 – zmluvy s firmami a ich prílohy
  `
  CREATE TABLE contracts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nazov           TEXT NOT NULL,
    company_id      INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    kategoria       TEXT NOT NULL DEFAULT '',
    cislo_zmluvy    TEXT NOT NULL DEFAULT '',
    datum_podpisu   TEXT,
    platnost_od     TEXT,
    platnost_do     TEXT,
    obnova          TEXT NOT NULL DEFAULT 'ziadna',
    vypoved_dni     INTEGER NOT NULL DEFAULT 0,
    pripomienka_dni INTEGER NOT NULL DEFAULT 30,
    stav            TEXT NOT NULL DEFAULT 'aktivna',
    poznamka        TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE contract_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id   INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    nazov         TEXT NOT NULL,
    ulozeny_nazov TEXT NOT NULL,
    velkost       INTEGER NOT NULL DEFAULT 0,
    mime          TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_contracts_company ON contracts(company_id);
  CREATE INDEX idx_contracts_stav ON contracts(stav);
  CREATE INDEX idx_contract_files ON contract_files(contract_id);
  `,

  // 3 – turnusy, objednávky a ich naviazanie na faktúry
  `
  CREATE TABLE tours (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nazov      TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    krajina    TEXT NOT NULL DEFAULT '',
    miesto     TEXT NOT NULL DEFAULT '',
    datum_od   TEXT NOT NULL,
    datum_do   TEXT NOT NULL,
    zruseny    INTEGER NOT NULL DEFAULT 0,
    poznamka   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    cislo      TEXT NOT NULL DEFAULT '',
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    tour_id    INTEGER REFERENCES tours(id) ON DELETE SET NULL,
    datum      TEXT,
    popis      TEXT NOT NULL DEFAULT '',
    suma       REAL NOT NULL DEFAULT 0,
    stav       TEXT NOT NULL DEFAULT 'prijata',
    poznamka   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE invoices ADD COLUMN tour_id  INTEGER REFERENCES tours(id)  ON DELETE SET NULL;
  ALTER TABLE invoices ADD COLUMN order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL;

  CREATE INDEX idx_tours_company ON tours(company_id);
  CREATE INDEX idx_orders_tour ON orders(tour_id);
  CREATE INDEX idx_orders_company ON orders(company_id);
  CREATE INDEX idx_invoices_tour ON invoices(tour_id);
  CREATE INDEX idx_invoices_order ON invoices(order_id);
  `,

  // 4 – výdavky a ich doklady (bločky)
  `
  CREATE TABLE expenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    datum      TEXT NOT NULL,
    popis      TEXT NOT NULL,
    kategoria  TEXT NOT NULL DEFAULT '',
    suma       REAL NOT NULL DEFAULT 0,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    tour_id    INTEGER REFERENCES tours(id) ON DELETE SET NULL,
    platba     TEXT NOT NULL DEFAULT 'karta',
    odpocitat  INTEGER NOT NULL DEFAULT 1,
    poznamka   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE expense_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id    INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    nazov         TEXT NOT NULL,
    ulozeny_nazov TEXT NOT NULL,
    velkost       INTEGER NOT NULL DEFAULT 0,
    mime          TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_expenses_datum ON expenses(datum);
  CREATE INDEX idx_expenses_tour ON expenses(tour_id);
  CREATE INDEX idx_expense_files ON expense_files(expense_id);
  `,

  // 5 – konverzácie s AI asistentmi
  `
  CREATE TABLE ai_conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    asistent   TEXT NOT NULL,
    nazov      TEXT NOT NULL DEFAULT 'Nová konverzácia',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE ai_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    rola            TEXT NOT NULL,
    obsah           TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_ai_conv_asistent ON ai_conversations(asistent, updated_at DESC);
  CREATE INDEX idx_ai_messages ON ai_messages(conversation_id, id);
  `,

  // 6 – objednávky na hodinovú sadzbu
  `
  ALTER TABLE orders ADD COLUMN hodinovka REAL NOT NULL DEFAULT 0;
  ALTER TABLE orders ADD COLUMN hodiny    REAL NOT NULL DEFAULT 0;
  `,

  // 7 – fotky priložené do chatu (bločky, skeny zmlúv)
  `
  CREATE TABLE chat_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nazov         TEXT NOT NULL,
    ulozeny_nazov TEXT NOT NULL,
    mime          TEXT NOT NULL DEFAULT '',
    velkost       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // 8 – história zmien, ktoré urobil AI pomocník (kvôli vráteniu späť)
  `
  CREATE TABLE ai_zmeny (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER REFERENCES ai_conversations(id) ON DELETE SET NULL,
    nastroj         TEXT NOT NULL,
    tabulka         TEXT NOT NULL,
    zaznam_id       INTEGER NOT NULL,
    operacia        TEXT NOT NULL,
    stav_pred       TEXT,
    popis           TEXT NOT NULL DEFAULT '',
    vratene         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_ai_zmeny ON ai_zmeny(conversation_id, id DESC);
  `,

  // 9 – kôš, sadzby stravného a šablóny faktúr
  `
  CREATE TABLE kos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tabulka    TEXT NOT NULL,
    zaznam_id  INTEGER NOT NULL,
    stav       TEXT NOT NULL,
    popis      TEXT NOT NULL DEFAULT '',
    zmazane_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE stravne_sadzby (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    krajina  TEXT NOT NULL UNIQUE,
    sadzba   REAL NOT NULL DEFAULT 0,
    mena     TEXT NOT NULL DEFAULT 'EUR',
    poznamka TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE invoice_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nazov      TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    poznamka   TEXT NOT NULL DEFAULT '',
    polozky    TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_kos ON kos(zmazane_at DESC);
  `,

  // 10 – čiastočné platby, zálohové faktúry a krytie starých dlhov
  `
  CREATE TABLE invoice_payments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    datum      TEXT NOT NULL,
    suma       REAL NOT NULL DEFAULT 0,
    poznamka   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 'faktura' = bežná alebo pôvodná faktúra, 'zaloha' = zálohová faktúra
  ALTER TABLE invoices ADD COLUMN typ TEXT NOT NULL DEFAULT 'faktura';
  -- Ktorú staršiu faktúru táto zálohová faktúra kryje (splátka dlhu).
  ALTER TABLE invoices ADD COLUMN kryje_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL;

  -- Doterajšie zaplatené faktúry prevedieme na jednu platbu, nech je história úplná.
  INSERT INTO invoice_payments (invoice_id, datum, suma, poznamka)
  SELECT id, COALESCE(NULLIF(datum_uhrady, ''), datum_vystav), suma, 'prevedené z pôvodnej evidencie'
  FROM invoices WHERE stav = 'zaplatena';

  CREATE INDEX idx_platby_faktura ON invoice_payments(invoice_id);
  CREATE INDEX idx_platby_datum ON invoice_payments(datum);
  CREATE INDEX idx_invoices_kryje ON invoices(kryje_id);
  `,

  // 11 – súkromné príjmy vedené vedľa výdavkov
  `
  -- 'vydavok' = bežný výdavok, 'prijem' = súkromný príjem, ktorý nie je
  -- podnikateľským príjmom (vklad, vrátka, prevod od rodiny…). Evidujeme ho
  -- tu, lebo prichádza na tom istom výpise z banky, ale do dane nevstupuje.
  ALTER TABLE expenses ADD COLUMN druh TEXT NOT NULL DEFAULT 'vydavok';
  CREATE INDEX idx_expenses_druh ON expenses(druh);
  `,

  // 12 – údaje o živnosti a vzhľad faktúry
  `
  -- Predmety podnikania, jeden na riadok, presne ako na živnostenskom liste.
  ALTER TABLE settings ADD COLUMN predmety TEXT NOT NULL DEFAULT '';
  ALTER TABLE settings ADD COLUMN datum_vzniku TEXT NOT NULL DEFAULT '';
  -- Zápis v živnostenskom registri – na faktúre ho vyžaduje § 3a Obchodného zákonníka.
  ALTER TABLE settings ADD COLUMN urad_zr TEXT NOT NULL DEFAULT '';
  ALTER TABLE settings ADD COLUMN cislo_zr TEXT NOT NULL DEFAULT '';
  -- 'neplatitel' alebo '7a' (registrovaný pre DPH kvôli službám do EÚ, ale nie platiteľ).
  ALTER TABLE settings ADD COLUMN dph_rezim TEXT NOT NULL DEFAULT 'neplatitel';
  ALTER TABLE settings ADD COLUMN ic_dph TEXT NOT NULL DEFAULT '';
  -- 'pausalne' alebo 'skutocne' – pre účtovníčku a daňový podklad.
  ALTER TABLE settings ADD COLUMN vydavky_typ TEXT NOT NULL DEFAULT 'pausalne';
  ALTER TABLE settings ADD COLUMN zdravotna_poistovna TEXT NOT NULL DEFAULT '';
  ALTER TABLE settings ADD COLUMN web TEXT NOT NULL DEFAULT '';
  ALTER TABLE settings ADD COLUMN sposob_uhrady TEXT NOT NULL DEFAULT 'Bankový prevod';
  ALTER TABLE settings ADD COLUMN farba_faktury TEXT NOT NULL DEFAULT '#2f6fd6';

  -- Kontaktná osoba u odberateľa – na faktúre pod názvom firmy.
  ALTER TABLE companies ADD COLUMN kontaktna_osoba TEXT NOT NULL DEFAULT '';

  -- Status DPH sa po novom tlačí pri dodávateľovi podľa dph_rezim. Pôvodnú
  -- predvolenú vetu z päty preto zmažeme, inak by bola na faktúre dvakrát.
  UPDATE settings SET poznamka_pati = '' WHERE TRIM(poznamka_pati) IN ('Nie som platiteľ DPH.', 'Nie je platiteľ DPH.');
  `,

  // 13 – predvolená splatnosť v pracovných dňoch
  `
  -- 1 = predvolená lehota splatnosti sa ráta v pracovných dňoch (bez víkendov a sviatkov).
  ALTER TABLE settings ADD COLUMN splatnost_pracovne INTEGER NOT NULL DEFAULT 0;
  `,

  // 14 – appka bez PIN-u, pôvod výdavku a profil pre AI asistentov
  `
  -- Prihlasovanie PIN-om sa zrušilo – odložené prihlásenia ani PIN už nemajú čo chrániť.
  DELETE FROM sessions;
  DELETE FROM app_meta WHERE key IN ('pin_hash', 'pin_salt');

  -- 'stravne' = výdavok, ktorý appka vytvorila zo sadzby stravného za turnus.
  -- Bločky z obchodu v kategórii „Stravné" tak nevyzerajú ako už zapísané diéty.
  ALTER TABLE expenses ADD COLUMN zdroj TEXT NOT NULL DEFAULT '';
  UPDATE expenses SET zdroj = 'stravne'
   WHERE kategoria = 'Stravné' AND platba = 'ine' AND popis LIKE 'Stravné – %';

  -- 1 = pracuje na zákazkách v zahraničí (turnusy). Podľa toho hovoria AI asistenti.
  -- Doterajšia inštalácia to tak mala napevno, nová začína všeobecne.
  ALTER TABLE settings ADD COLUMN praca_v_zahranici INTEGER NOT NULL DEFAULT 0;
  UPDATE settings SET praca_v_zahranici = 1 WHERE meno <> '' OR EXISTS (SELECT 1 FROM tours);

  -- Zaplatenosť sa odvodzuje z platieb. Starý príznak „zaplatená" by pri
  -- neskoršej úprave sumy vedel zapísať platbu, ktorá neprišla.
  UPDATE invoices SET stav = 'vystavena' WHERE stav = 'zaplatena';
  `,
]

const current = db.pragma('user_version', { simple: true }) as number
for (let v = current; v < migrations.length; v++) {
  db.exec('BEGIN')
  try {
    db.exec(migrations[v])
    db.pragma(`user_version = ${v + 1}`)
    db.exec('COMMIT')
    console.log(`[db] migrácia ${v + 1} aplikovaná`)
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function meta(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string) {
  db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
