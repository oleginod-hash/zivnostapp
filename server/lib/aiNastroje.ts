import type Anthropic from '@anthropic-ai/sdk'
import fs from 'node:fs'
import { volajApi } from './internyKlient.js'
import { cestaFotky, najdiFotku } from './chatFotky.js'
import { nacitajStav, vratZmenu, zapisZmenu, zoznamZmien, type Operacia } from './historiaZmien.js'

/**
 * Nástroje, ktoré má chat asistent k dispozícii.
 *
 * Zámerne tu NIE JE žiadny nástroj na mazanie – ani faktúr, ani zmlúv, ani
 * čohokoľvek iného. Mazanie ostáva výhradne manuálnou akciou používateľa.
 * Druhá, nezávislá poistka je v internyKlient.ts, ktorý metódu DELETE odmieta.
 */

type Vykonavac = (vstup: any) => Promise<unknown>

type Nastroj = {
  definicia: Anthropic.Tool
  /** true = zapisuje do databázy (appka to používateľovi ohlási) */
  zapisuje: boolean
  vykonaj: Vykonavac
  /** Čoho sa zápis týka – vďaka tomu sa dá zmena vrátiť späť. */
  historia?: {
    tabulka: string
    operacia: Operacia
    /** ID meneného záznamu. Pri vytváraní ho berieme až z výsledku volania. */
    idZoVstupu?: (vstup: any) => number | null
    popis: (vstup: any) => string
  }
}

const DATUM = { type: 'string' as const, description: 'Dátum vo formáte RRRR-MM-DD' }

function dopyt(zaklad: string, parametre: Record<string, unknown>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(parametre)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `${zaklad}?${s}` : zaklad
}

async function get(cesta: string) {
  const r = await volajApi('GET', cesta)
  if (!r.ok) throw new Error(r.data?.chyba || `Načítanie zlyhalo (${r.stav}).`)
  return r.data
}

async function zapis(metoda: 'POST' | 'PUT', cesta: string, telo: unknown) {
  const r = await volajApi(metoda, cesta, telo)
  if (!r.ok) throw new Error(r.data?.chyba || `Uloženie zlyhalo (${r.stav}).`)
  return r.data
}

export const NASTROJE: Record<string, Nastroj> = {
  // ── Čítanie ───────────────────────────────────────────────
  hladaj: {
    zapisuje: false,
    definicia: {
      name: 'hladaj',
      description:
        'Vyhľadá naprieč celou appkou – faktúry, zmluvy, firmy, turnusy, objednávky aj výdavky. ' +
        'Používaj to vždy, keď potrebuješ nájsť ID záznamu podľa názvu alebo čísla.',
      input_schema: {
        type: 'object',
        properties: { dopyt: { type: 'string', description: 'Hľadaný text' } },
        required: ['dopyt'],
      },
    },
    vykonaj: (v) => get(dopyt('/hladat', { q: v.dopyt })),
  },

  zoznam_faktur: {
    zapisuje: false,
    definicia: {
      name: 'zoznam_faktur',
      description:
        'Zoznam faktúr s možnosťou filtrovať podľa stavu, firmy, turnusu alebo roku. ' +
        'Stav: nevyplatene = ešte nie celé zaplatené, vyplatene = uhradené celé (aj cez zálohy), ' +
        'zalohy = zálohové faktúry, po_splatnosti, ciastocne = čiastočne uhradené, koncept.',
      input_schema: {
        type: 'object',
        properties: {
          stav: { type: 'string', enum: ['nevyplatene', 'vyplatene', 'zalohy', 'po_splatnosti', 'ciastocne', 'koncept'] },
          firma: { type: 'number', description: 'ID firmy' },
          turnus: { type: 'number', description: 'ID turnusu' },
          rok: { type: 'string' },
          hladat: { type: 'string' },
        },
      },
    },
    vykonaj: (v) => get(dopyt('/faktury', v)),
  },

  detail_faktury: {
    zapisuje: false,
    definicia: {
      name: 'detail_faktury',
      description: 'Celá faktúra vrátane položiek.',
      input_schema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    },
    vykonaj: (v) => get(`/faktury/${Number(v.id)}`),
  },

  zoznam_firiem: {
    zapisuje: false,
    definicia: {
      name: 'zoznam_firiem',
      description: 'Všetky firmy (odberatelia) aj s ich IČO a adresou.',
      input_schema: { type: 'object', properties: {} },
    },
    vykonaj: () => get('/firmy'),
  },

  zoznam_turnusov: {
    zapisuje: false,
    definicia: {
      name: 'zoznam_turnusov',
      description:
        'Turnusy s obdobím, krajinou a súhrnom (objednané, vyfakturované, zaplatené). ' +
        'Užitočné aj pri otázkach typu koľko dní som bol v ktorej krajine.',
      input_schema: {
        type: 'object',
        properties: {
          stav: { type: 'string', enum: ['planovany', 'prebieha', 'ukonceny', 'zruseny'] },
          rok: { type: 'string' },
          hladat: { type: 'string' },
        },
      },
    },
    vykonaj: (v) => get(dopyt('/turnusy', v)),
  },

  detail_turnusu: {
    zapisuje: false,
    definicia: {
      name: 'detail_turnusu',
      description: 'Turnus vrátane jeho objednávok a faktúr.',
      input_schema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    },
    vykonaj: (v) => get(`/turnusy/${Number(v.id)}`),
  },

  zoznam_objednavok: {
    zapisuje: false,
    definicia: {
      name: 'zoznam_objednavok',
      description: 'Objednávky vrátane hodinovej sadzby a toho, koľko z nich je vyfakturované.',
      input_schema: {
        type: 'object',
        properties: {
          stav: { type: 'string', enum: ['prijata', 'potvrdena', 'zrusena', 'nevyfakturovane'] },
          firma: { type: 'number' },
          turnus: { type: 'number' },
          hladat: { type: 'string' },
        },
      },
    },
    vykonaj: (v) => get(dopyt('/objednavky', v)),
  },

  zoznam_zmluv: {
    zapisuje: false,
    definicia: {
      name: 'zoznam_zmluv',
      description: 'Zmluvy vrátane platnosti, kategórie a upozornenia na blížiacu sa expiráciu.',
      input_schema: {
        type: 'object',
        properties: {
          stav: { type: 'string', enum: ['navrh', 'aktivna', 'ukoncena'] },
          firma: { type: 'number' },
          kategoria: { type: 'string' },
          hladat: { type: 'string' },
        },
      },
    },
    vykonaj: (v) => get(dopyt('/zmluvy', v)),
  },

  detail_zmluvy: {
    zapisuje: false,
    definicia: {
      name: 'detail_zmluvy',
      description: 'Zmluva vrátane zoznamu priložených súborov.',
      input_schema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    },
    vykonaj: (v) => get(`/zmluvy/${Number(v.id)}`),
  },

  zoznam_vydavkov: {
    zapisuje: false,
    definicia: {
      name: 'zoznam_vydavkov',
      description:
        'Výdavky s možnosťou filtrovať podľa obdobia, kategórie alebo turnusu. ' +
        'V tej istej evidencii sú aj súkromné príjmy – vyfiltruješ ich cez druh.',
      input_schema: {
        type: 'object',
        properties: {
          od: DATUM,
          do: DATUM,
          kategoria: { type: 'string' },
          turnus: { type: 'number' },
          hladat: { type: 'string' },
          druh: { type: 'string', enum: ['vydavok', 'prijem'] },
        },
      },
    },
    vykonaj: (v) => get(dopyt('/vydavky', v)),
  },

  financie: {
    zapisuje: false,
    definicia: {
      name: 'financie',
      description:
        'Súhrn financií za obdobie: príjmy (zaplatené faktúry), výdavky, zisk, čo čaká na zaplatenie. ' +
        'Bez parametrov vráti aktuálny rok.',
      input_schema: {
        type: 'object',
        properties: { rok: { type: 'string' }, od: DATUM, do: DATUM },
      },
    },
    vykonaj: async (v) => ({
      prehlad: await get(dopyt('/financie/prehlad', v)),
      podlaKategorii: await get(dopyt('/financie/kategorie', v)),
      podlaTurnusov: await get(dopyt('/financie/turnusy', { rok: v.rok })),
    }),
  },

  nastavenia: {
    zapisuje: false,
    definicia: {
      name: 'nastavenia',
      description: 'Fakturačné údaje používateľa (meno, IČO, DIČ, IBAN, vzor čísla faktúry, splatnosť).',
      input_schema: { type: 'object', properties: {} },
    },
    vykonaj: () => get('/nastavenia'),
  },

  // ── Zápis ─────────────────────────────────────────────────
  vytvor_firmu: {
    zapisuje: true,
    historia: {
      tabulka: 'companies',
      operacia: 'vytvorenie',
      popis: (v) => `firma ${v.nazov}`,
    },
    definicia: {
      name: 'vytvor_firmu',
      description: 'Založí novú firmu (odberateľa).',
      input_schema: {
        type: 'object',
        properties: {
          nazov: { type: 'string' },
          kontaktna_osoba: { type: 'string', description: 'Meno kontaktnej osoby u odberateľa' },
          adresa: { type: 'string' },
          psc_mesto: { type: 'string' },
          krajina: { type: 'string' },
          ico: { type: 'string' },
          dic: { type: 'string' },
          ic_dph: { type: 'string' },
          email: { type: 'string' },
          telefon: { type: 'string' },
          poznamka: { type: 'string' },
        },
        required: ['nazov'],
      },
    },
    vykonaj: (v) => zapis('POST', '/firmy', v),
  },

  uprav_firmu: {
    zapisuje: true,
    historia: {
      tabulka: 'companies',
      operacia: 'uprava',
      idZoVstupu: (v) => Number(v.id) || null,
      popis: (v) => `firma ${v.nazov}`,
    },
    definicia: {
      name: 'uprav_firmu',
      description:
        'Upraví firmu. Pole, ktoré nepošleš, ostane bez zmeny. ' +
        'Najprv si firmu načítaj cez zoznam_firiem.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          nazov: { type: 'string' },
          kontaktna_osoba: { type: 'string', description: 'Meno kontaktnej osoby u odberateľa' },
          adresa: { type: 'string' },
          psc_mesto: { type: 'string' },
          krajina: { type: 'string' },
          ico: { type: 'string' },
          dic: { type: 'string' },
          ic_dph: { type: 'string' },
          email: { type: 'string' },
          telefon: { type: 'string' },
          poznamka: { type: 'string' },
        },
        required: ['id', 'nazov'],
      },
    },
    vykonaj: (v) => zapis('PUT', `/firmy/${Number(v.id)}`, v),
  },

  vytvor_turnus: {
    zapisuje: true,
    historia: {
      tabulka: 'tours',
      operacia: 'vytvorenie',
      popis: (v) => `turnus ${v.nazov}`,
    },
    definicia: {
      name: 'vytvor_turnus',
      description: 'Založí turnus – obdobie práce u jednej firmy v zahraničí.',
      input_schema: {
        type: 'object',
        properties: {
          nazov: { type: 'string' },
          company_id: { type: 'number', description: 'ID firmy' },
          krajina: { type: 'string' },
          miesto: { type: 'string' },
          datum_od: DATUM,
          datum_do: DATUM,
          poznamka: { type: 'string' },
        },
        required: ['nazov', 'datum_od', 'datum_do'],
      },
    },
    vykonaj: (v) => zapis('POST', '/turnusy', v),
  },

  uprav_turnus: {
    zapisuje: true,
    historia: {
      tabulka: 'tours',
      operacia: 'uprava',
      idZoVstupu: (v) => Number(v.id) || null,
      popis: (v) => `turnus ${v.nazov}`,
    },
    definicia: {
      name: 'uprav_turnus',
      description: 'Upraví turnus. Pošli všetky polia. `zruseny: true` turnus zruší (nemaže ho).',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          nazov: { type: 'string' },
          company_id: { type: 'number' },
          krajina: { type: 'string' },
          miesto: { type: 'string' },
          datum_od: DATUM,
          datum_do: DATUM,
          zruseny: { type: 'boolean' },
          poznamka: { type: 'string' },
        },
        required: ['id', 'nazov', 'datum_od', 'datum_do'],
      },
    },
    vykonaj: (v) => zapis('PUT', `/turnusy/${Number(v.id)}`, v),
  },

  vytvor_objednavku: {
    zapisuje: true,
    historia: {
      tabulka: 'orders',
      operacia: 'vytvorenie',
      popis: (v) => `objednávka ${v.cislo || v.popis || ''}`,
    },
    definicia: {
      name: 'vytvor_objednavku',
      description:
        'Založí objednávku. Pri práci na hodiny vyplň hodinovku (€/h) a prípadne dohodnuté hodiny; ' +
        'pri paušálnej zákazke namiesto toho sumu.',
      input_schema: {
        type: 'object',
        properties: {
          cislo: { type: 'string' },
          popis: { type: 'string' },
          company_id: { type: 'number' },
          tour_id: { type: 'number', description: 'ID turnusu' },
          datum: DATUM,
          hodinovka: { type: 'number', description: 'Sadzba v € za hodinu' },
          hodiny: { type: 'number' },
          suma: { type: 'number', description: 'Pevná suma, ak sa nefakturuje na hodiny' },
          stav: { type: 'string', enum: ['prijata', 'potvrdena', 'zrusena'] },
          poznamka: { type: 'string' },
        },
      },
    },
    vykonaj: (v) => zapis('POST', '/objednavky', v),
  },

  uprav_objednavku: {
    zapisuje: true,
    historia: {
      tabulka: 'orders',
      operacia: 'uprava',
      idZoVstupu: (v) => Number(v.id) || null,
      popis: (v) => `objednávka ${v.cislo || v.popis || ''}`,
    },
    definicia: {
      name: 'uprav_objednavku',
      description: 'Upraví objednávku. Pošli všetky polia.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          cislo: { type: 'string' },
          popis: { type: 'string' },
          company_id: { type: 'number' },
          tour_id: { type: 'number' },
          datum: DATUM,
          hodinovka: { type: 'number' },
          hodiny: { type: 'number' },
          suma: { type: 'number' },
          stav: { type: 'string', enum: ['prijata', 'potvrdena', 'zrusena'] },
          poznamka: { type: 'string' },
        },
        required: ['id'],
      },
    },
    vykonaj: (v) => zapis('PUT', `/objednavky/${Number(v.id)}`, v),
  },

  vytvor_fakturu: {
    zapisuje: true,
    historia: {
      tabulka: 'invoices',
      operacia: 'vytvorenie',
      popis: (v) => `faktúra ${v.cislo || ''}`,
    },
    definicia: {
      name: 'vytvor_fakturu',
      description:
        'Vystaví faktúru. Číslo, dátumy a splatnosť sa doplnia samy podľa nastavení, ak ich neuvedieš. ' +
        'Ak uvedieš objednávku, turnus aj odberateľ sa doplnia z nej.',
      input_schema: {
        type: 'object',
        properties: {
          company_id: { type: 'number', description: 'ID odberateľa' },
          tour_id: { type: 'number' },
          order_id: { type: 'number' },
          cislo: { type: 'string' },
          datum_vystav: DATUM,
          datum_dodania: DATUM,
          datum_splat: DATUM,
          stav: { type: 'string', enum: ['koncept', 'vystavena', 'zaplatena'] },
          variabilny: { type: 'string' },
          poznamka: { type: 'string' },
          polozky: {
            type: 'array',
            description: 'Aspoň jedna položka.',
            items: {
              type: 'object',
              properties: {
                popis: { type: 'string' },
                mnozstvo: { type: 'number' },
                jednotka: { type: 'string', description: 'napr. hod, deň, ks' },
                cena: { type: 'number', description: 'Cena za jednotku v €' },
              },
              required: ['popis', 'mnozstvo', 'cena'],
            },
          },
        },
        required: ['polozky'],
      },
    },
    vykonaj: (v) => zapis('POST', '/faktury', v),
  },

  uprav_fakturu: {
    zapisuje: true,
    historia: {
      tabulka: 'invoices',
      operacia: 'uprava',
      idZoVstupu: (v) => Number(v.id) || null,
      popis: (v) => `faktúra ${v.cislo || ''}`,
    },
    definicia: {
      name: 'uprav_fakturu',
      description:
        'Upraví faktúru. Pole, ktoré nepošleš, ostane bez zmeny (aj typ dokladu a krytie starého dlhu). ' +
        'Keď meníš položky, pošli ich kompletné – nahradia pôvodné. ' +
        'Najprv si faktúru načítaj cez detail_faktury.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          cislo: { type: 'string' },
          company_id: { type: 'number' },
          tour_id: { type: 'number' },
          order_id: { type: 'number' },
          typ: { type: 'string', enum: ['faktura', 'zaloha'], description: 'faktura = bežná, zaloha = zálohová faktúra' },
          kryje_id: { type: 'number', description: 'Pri zálohovej faktúre: ID staršej faktúry, ktorej dlh táto záloha spláca' },
          datum_vystav: DATUM,
          datum_dodania: DATUM,
          datum_splat: DATUM,
          stav: { type: 'string', enum: ['koncept', 'vystavena', 'zaplatena'] },
          datum_uhrady: DATUM,
          variabilny: { type: 'string' },
          poznamka: { type: 'string' },
          polozky: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                popis: { type: 'string' },
                mnozstvo: { type: 'number' },
                jednotka: { type: 'string' },
                cena: { type: 'number' },
              },
              required: ['popis', 'mnozstvo', 'cena'],
            },
          },
        },
        required: ['id'],
      },
    },
    vykonaj: (v) => zapis('PUT', `/faktury/${Number(v.id)}`, v),
  },

  zmen_stav_faktury: {
    zapisuje: true,
    historia: {
      tabulka: 'invoices',
      operacia: 'uprava',
      idZoVstupu: (v) => Number(v.id) || null,
      popis: (v) => `stav faktúry na ${v.stav}`,
    },
    definicia: {
      name: 'zmen_stav_faktury',
      description: 'Zmení stav faktúry – napríklad označí ako zaplatenú.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          stav: { type: 'string', enum: ['koncept', 'vystavena', 'zaplatena'] },
          datum_uhrady: DATUM,
        },
        required: ['id', 'stav'],
      },
    },
    vykonaj: (v) => zapis('POST', `/faktury/${Number(v.id)}/stav`, v),
  },

  vytvor_vydavok: {
    zapisuje: true,
    historia: {
      tabulka: 'expenses',
      operacia: 'vytvorenie',
      popis: (v) => `výdavok ${v.popis} (${v.suma} €)`,
    },
    definicia: {
      name: 'vytvor_vydavok',
      description:
        'Zapíše výdavok alebo súkromný príjem. Ak dátum spadá do obdobia turnusu, priradí sa naň ' +
        'automaticky – turnus uvádzaj len keď má patriť inam. Keď z bankového výpisu spracúvaš ' +
        'prichádzajúcu platbu, ktorá nie je úhradou faktúry, zapíš ju s druh="prijem".',
      input_schema: {
        type: 'object',
        properties: {
          datum: DATUM,
          popis: { type: 'string' },
          suma: { type: 'number' },
          druh: {
            type: 'string',
            enum: ['vydavok', 'prijem'],
            description:
              'vydavok = bežný výdavok; prijem = súkromný príjem, ktorý NIE JE príjmom z podnikania ' +
              '(vklad vlastných peňazí, prevod od rodiny, vrátka). Predvolene vydavok.',
          },
          kategoria: {
            type: 'string',
            description: 'napr. Doprava, Ubytovanie, Materiál, Náradie, Stravné, Odvody (SP/ZP)',
          },
          tour_id: { type: 'number' },
          platba: { type: 'string', enum: ['karta', 'hotovost', 'prevod', 'ine'] },
          odpocitat: { type: 'boolean', description: 'Daňovo uznateľný výdavok (predvolene áno)' },
          poznamka: { type: 'string' },
        },
        required: ['datum', 'popis', 'suma'],
      },
    },
    vykonaj: (v) => zapis('POST', '/vydavky', v),
  },

  uprav_vydavok: {
    zapisuje: true,
    historia: {
      tabulka: 'expenses',
      operacia: 'uprava',
      idZoVstupu: (v) => Number(v.id) || null,
      popis: (v) => `výdavok ${v.popis}`,
    },
    definicia: {
      name: 'uprav_vydavok',
      description: 'Upraví výdavok alebo súkromný príjem. Pošli všetky polia.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          datum: DATUM,
          popis: { type: 'string' },
          suma: { type: 'number' },
          druh: {
            type: 'string',
            enum: ['vydavok', 'prijem'],
            description:
              'vydavok = bežný výdavok; prijem = súkromný príjem, ktorý NIE JE príjmom z podnikania ' +
              '(vklad vlastných peňazí, prevod od rodiny, vrátka). Predvolene vydavok.',
          },
          kategoria: { type: 'string' },
          tour_id: { type: 'number' },
          platba: { type: 'string', enum: ['karta', 'hotovost', 'prevod', 'ine'] },
          odpocitat: { type: 'boolean' },
          poznamka: { type: 'string' },
        },
        required: ['id', 'datum', 'popis', 'suma'],
      },
    },
    vykonaj: (v) => zapis('PUT', `/vydavky/${Number(v.id)}`, v),
  },

  vytvor_zmluvu: {
    zapisuje: true,
    historia: {
      tabulka: 'contracts',
      operacia: 'vytvorenie',
      popis: (v) => `zmluva ${v.nazov}`,
    },
    definicia: {
      name: 'vytvor_zmluvu',
      description: 'Založí zmluvu. Prílohy (skeny) sa pridávajú ručne v appke.',
      input_schema: {
        type: 'object',
        properties: {
          nazov: { type: 'string' },
          company_id: { type: 'number' },
          kategoria: { type: 'string' },
          cislo_zmluvy: { type: 'string' },
          datum_podpisu: DATUM,
          platnost_od: DATUM,
          platnost_do: DATUM,
          obnova: { type: 'string', enum: ['ziadna', 'automaticka', 'rucna'] },
          vypoved_dni: { type: 'number' },
          pripomienka_dni: { type: 'number', description: 'Koľko dní vopred upozorniť (predvolene 30)' },
          stav: { type: 'string', enum: ['navrh', 'aktivna', 'ukoncena'] },
          poznamka: { type: 'string' },
        },
        required: ['nazov'],
      },
    },
    vykonaj: (v) => zapis('POST', '/zmluvy', v),
  },

  uprav_zmluvu: {
    zapisuje: true,
    historia: {
      tabulka: 'contracts',
      operacia: 'uprava',
      idZoVstupu: (v) => Number(v.id) || null,
      popis: (v) => `zmluva ${v.nazov}`,
    },
    definicia: {
      name: 'uprav_zmluvu',
      description: 'Upraví zmluvu. Pošli všetky polia.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          nazov: { type: 'string' },
          company_id: { type: 'number' },
          kategoria: { type: 'string' },
          cislo_zmluvy: { type: 'string' },
          datum_podpisu: DATUM,
          platnost_od: DATUM,
          platnost_do: DATUM,
          obnova: { type: 'string', enum: ['ziadna', 'automaticka', 'rucna'] },
          vypoved_dni: { type: 'number' },
          pripomienka_dni: { type: 'number' },
          stav: { type: 'string', enum: ['navrh', 'aktivna', 'ukoncena'] },
          poznamka: { type: 'string' },
        },
        required: ['id', 'nazov'],
      },
    },
    vykonaj: (v) => zapis('PUT', `/zmluvy/${Number(v.id)}`, v),
  },

  priloz_fotku_k_vydavku: {
    zapisuje: true,
    definicia: {
      name: 'priloz_fotku_k_vydavku',
      description:
        'Priloží fotku z tejto konverzácie k výdavku ako doklad. Použi hneď po tom, ' +
        'čo z fotky bločku vytvoríš výdavok – nech má používateľ doklad pri zázname.',
      input_schema: {
        type: 'object',
        properties: {
          fotka_id: { type: 'number', description: 'ID fotky, ktoré si dostal pri jej priložení' },
          expense_id: { type: 'number', description: 'ID výdavku' },
        },
        required: ['fotka_id', 'expense_id'],
      },
    },
    vykonaj: async (v) => {
      const fotka = najdiFotku(Number(v.fotka_id))
      if (!fotka) throw new Error('Fotka sa nenašla.')

      // Nahrávanie ide cez multipart, nie JSON – preto výnimočne priamy fetch.
      const obsah = fs.readFileSync(cestaFotky(fotka))
      const telo = new FormData()
      telo.append('subory', new Blob([new Uint8Array(obsah)], { type: fotka.mime }), fotka.nazov)

      const port = Number(process.env.PORT) || 3000
      const r = await fetch(`http://127.0.0.1:${port}/api/vydavky/${Number(v.expense_id)}/subory`, {
        method: 'POST',
        body: telo,
      })
      const data = (await r.json()) as any
      if (!r.ok) throw new Error(data?.chyba || 'Priloženie dokladu zlyhalo.')
      return data
    },
  },

  uprav_nastavenia: {
    zapisuje: true,
    historia: {
      tabulka: 'settings',
      operacia: 'uprava',
      idZoVstupu: () => 1,
      popis: () => 'fakturačné údaje',
    },
    definicia: {
      name: 'uprav_nastavenia',
      description:
        'Upraví fakturačné a živnostenské údaje. Posielaj len polia, ktoré meníš – ostatné ostanú.',
      input_schema: {
        type: 'object',
        properties: {
          meno: { type: 'string' },
          adresa: { type: 'string' },
          psc_mesto: { type: 'string' },
          krajina: { type: 'string' },
          ico: { type: 'string' },
          dic: { type: 'string' },
          zapis: { type: 'string' },
          predmety: { type: 'string', description: 'Predmety podnikania, jeden na riadok' },
          datum_vzniku: { type: 'string', description: 'Dátum vzniku živnostenského oprávnenia RRRR-MM-DD' },
          urad_zr: { type: 'string', description: 'Okresný úrad, v ktorého živnostenskom registri je zapísaný' },
          cislo_zr: { type: 'string', description: 'Číslo živnostenského registra' },
          dph_rezim: { type: 'string', enum: ['neplatitel', '7a'] },
          ic_dph: { type: 'string' },
          vydavky_typ: { type: 'string', enum: ['pausalne', 'skutocne'] },
          zdravotna_poistovna: { type: 'string' },
          web: { type: 'string' },
          sposob_uhrady: { type: 'string' },
          email: { type: 'string' },
          telefon: { type: 'string' },
          iban: { type: 'string' },
          swift: { type: 'string' },
          banka: { type: 'string' },
          cislo_vzor: { type: 'string' },
          splatnost_dni: { type: 'number' },
          splatnost_pracovne: {
            type: 'boolean',
            description: 'Predvolenú splatnosť rátať v pracovných dňoch (bez víkendov a sviatkov)',
          },
          praca_v_zahranici: {
            type: 'boolean',
            description: 'Pracuje na zákazkách v zahraničí (turnusy) – AI asistenti s tým potom rátajú',
          },
          poznamka_pati: { type: 'string' },
        },
      },
    },
    vykonaj: (v) => zapis('PUT', '/nastavenia', v),
  },

  stravne_za_turnus: {
    zapisuje: false,
    definicia: {
      name: 'stravne_za_turnus',
      description:
        'Koľko stravného (diét) patrí za turnus – počet dní × sadzba pre danú krajinu. ' +
        'Povie aj to, či už bolo zapísané a či pre krajinu vôbec existuje sadzba.',
      input_schema: {
        type: 'object',
        properties: { tour_id: { type: 'number' } },
        required: ['tour_id'],
      },
    },
    vykonaj: (v) => get(`/stravne/turnus/${Number(v.tour_id)}`),
  },

  zapis_stravne: {
    zapisuje: true,
    historia: {
      tabulka: 'expenses',
      operacia: 'vytvorenie',
      popis: (v) => `stravné za turnus (${v.suma} €)`,
    },
    definicia: {
      name: 'zapis_stravne',
      description:
        'Zapíše stravné za turnus ako výdavok v kategórii Stravné. Sumu si najprv zisti ' +
        'cez stravne_za_turnus a over, či už zapísané nie je – nech nevznikne duplicita.',
      input_schema: {
        type: 'object',
        properties: {
          tour_id: { type: 'number' },
          suma: { type: 'number' },
          poznamka: { type: 'string' },
        },
        required: ['tour_id', 'suma'],
      },
    },
    vykonaj: (v) => zapis('POST', `/stravne/turnus/${Number(v.tour_id)}/zapisat`, v),
  },

  dni_v_krajinach: {
    zapisuje: false,
    definicia: {
      name: 'dni_v_krajinach',
      description:
        'Koľko dní strávil používateľ v ktorej krajine za daný rok, spočítané z turnusov, ' +
        'vrátane toho, koľko zostáva do orientačnej hranice 183 dní.',
      input_schema: { type: 'object', properties: { rok: { type: 'string' } } },
    },
    vykonaj: (v) => get(dopyt('/stravne/dni', v)),
  },

  danovy_podklad: {
    zapisuje: false,
    definicia: {
      name: 'danovy_podklad',
      description:
        'Kompletný ročný súhrn pre daňové priznanie: príjmy, uznateľné a neuznateľné výdavky ' +
        'po kategóriách, zoznam faktúr, turnusov a dní v krajinách.',
      input_schema: { type: 'object', properties: { rok: { type: 'string' } } },
    },
    vykonaj: (v) => get(dopyt('/danovy-podklad', v)),
  },

  faktury_po_splatnosti: {
    zapisuje: false,
    definicia: {
      name: 'faktury_po_splatnosti',
      description: 'Faktúry po splatnosti aj s počtom dní omeškania a e-mailom odberateľa.',
      input_schema: { type: 'object', properties: {} },
    },
    vykonaj: () => get('/mail/po-splatnosti'),
  },

  // ── Vrátenie zmien ────────────────────────────────────────
  co_som_zmenil: {
    zapisuje: false,
    definicia: {
      name: 'co_som_zmenil',
      description:
        'Zoznam zmien, ktoré si v dátach urobil – od najnovšej. Použi, keď sa používateľ pýta, ' +
        'čo si menil, alebo keď chce niečo vrátiť a treba zistiť čo.',
      input_schema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Koľko posledných zmien (predvolene 10)' } },
      },
    },
    vykonaj: async (v) => zoznamZmien(null, Math.min(Number(v.limit) || 10, 30)),
  },

  vrat_spat: {
    zapisuje: true,
    definicia: {
      name: 'vrat_spat',
      description:
        'Vráti zmenu späť do stavu pred ňou. Bez parametra vráti tú úplne poslednú. ' +
        'Úprava sa vráti na pôvodné hodnoty; záznam, ktorý si sám vytvoril, sa odstráni. ' +
        'Vracať sa dajú LEN tvoje vlastné zmeny – nie to, čo používateľ zapísal ručne v appke.',
      input_schema: {
        type: 'object',
        properties: {
          zmena_id: { type: 'number', description: 'ID zmeny zo zoznamu co_som_zmenil. Bez neho sa vráti posledná.' },
        },
      },
    },
    vykonaj: async (v) => {
      const zmeny = zoznamZmien(null, 30)
      const cielova = v.zmena_id
        ? zmeny.find((z) => z.id === Number(v.zmena_id))
        : zmeny.find((z) => !z.vratene)

      if (!cielova) throw new Error('Niet čo vrátiť – žiadna zmena sa nenašla.')
      const vysledok = vratZmenu(cielova)
      if (!vysledok.ok) throw new Error(vysledok.sprava)
      return { sprava: vysledok.sprava, vratena_zmena: cielova.popis }
    },
  },
}

export const DEFINICIE_NASTROJOV: Anthropic.Tool[] = Object.values(NASTROJE).map((n) => n.definicia)

export async function spustiNastroj(
  nazov: string,
  vstup: any,
  conversationId: number | null = null,
): Promise<{ vysledok: string; chyba: boolean }> {
  const nastroj = NASTROJE[nazov]
  if (!nastroj) return { vysledok: `Nástroj ${nazov} neexistuje.`, chyba: true }

  const h = nastroj.historia
  // Pri úprave si pôvodný stav musíme odložiť ešte pred zápisom.
  const idPred = h?.idZoVstupu?.(vstup ?? {}) ?? null
  const stavPred = h && h.operacia === 'uprava' && idPred ? nacitajStav(h.tabulka, idPred) : null

  try {
    const data = await nastroj.vykonaj(vstup ?? {})

    if (h) {
      // Pri vytvorení nám ID povie až výsledok volania.
      const id = h.operacia === 'vytvorenie' ? Number((data as any)?.id) || null : idPred
      if (id) {
        try {
          zapisZmenu({
            conversation_id: conversationId,
            nastroj: nazov,
            tabulka: h.tabulka,
            zaznam_id: id,
            operacia: h.operacia,
            stav_pred: stavPred,
            popis: h.popis(vstup ?? {}),
          })
        } catch (e) {
          // Zápis dát už prebehol – neúspech pri odkladaní histórie ho nesmie zhodiť.
          // Zmena sa potom nedá vrátiť, ale samotný záznam je v poriadku uložený.
          console.error('[historia zmien]', e)
        }
      }
    }

    return { vysledok: JSON.stringify(data ?? { ok: true }), chyba: false }
  } catch (e: any) {
    return { vysledok: e?.message || 'Nástroj zlyhal.', chyba: true }
  }
}
