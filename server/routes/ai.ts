import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db.js'
import {
  ASISTENTI, ASISTENTI_S_NASTROJMI, NAZVY_ASISTENTOV, systemovyPrompt, type Asistent,
} from '../lib/aiPrompty.js'
import { DEFINICIE_NASTROJOV, NASTROJE, spustiNastroj } from '../lib/aiNastroje.js'
import { fotkaPreClaude, najdiFotku, ulozFotku, uploadFotky } from '../lib/chatFotky.js'

export const aiRouter = Router()

const MODEL = process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5'

/** Klient vytvárame až pri prvom použití – bez kľúča má appka fungovať ďalej. */
let klient: Anthropic | null = null
function ziskajKlienta(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null
  if (!klient) klient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return klient
}

function jeAsistent(x: string): x is Asistent {
  return ASISTENTI.includes(x as Asistent)
}

/** Názov konverzácie odvodíme z prvej otázky, aby sa dala v zozname nájsť. */
function odvodNazov(text: string): string {
  const jedenRiadok = text.replace(/\s+/g, ' ').trim()
  return jedenRiadok.length > 60 ? jedenRiadok.slice(0, 57) + '…' : jedenRiadok || 'Nová konverzácia'
}

// ── Stav integrácie ───────────────────────────────────────────
aiRouter.get('/stav', (_req, res) => {
  res.json({
    dostupne: !!ziskajKlienta(),
    model: MODEL,
    asistenti: ASISTENTI.map((a) => ({ kluc: a, nazov: NAZVY_ASISTENTOV[a] })),
  })
})

// ── Konverzácie ───────────────────────────────────────────────
aiRouter.get('/konverzacie', (req, res) => {
  // Asistent je jeden; staršie konverzácie od účtovníka a právnika sa
  // zobrazujú spolu s ostatnými. Filter podľa asistenta ostáva pre istotu.
  const asistent = String(req.query.asistent ?? '')
  const kde = jeAsistent(asistent) ? 'WHERE k.asistent = @asistent' : ''
  res.json(
    db
      .prepare(
        `SELECT k.*, (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = k.id) AS pocet_sprav
         FROM ai_conversations k ${kde} ORDER BY k.updated_at DESC`,
      )
      .all({ asistent }),
  )
})

aiRouter.get('/konverzacie/:id', (req, res) => {
  const k = db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(req.params.id)
  if (!k) return res.status(404).json({ chyba: 'Konverzácia neexistuje.' })
  const spravy = db
    .prepare('SELECT id, rola, obsah, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY id')
    .all(req.params.id)
  res.json({ ...(k as object), spravy })
})

aiRouter.post('/konverzacie', (req, res) => {
  const asistent = String(req.body?.asistent ?? '')
  if (!jeAsistent(asistent)) return res.status(400).json({ chyba: 'Neznámy asistent.' })
  const info = db.prepare('INSERT INTO ai_conversations (asistent) VALUES (?)').run(asistent)
  res.json({ id: Number(info.lastInsertRowid) })
})

aiRouter.delete('/konverzacie/:id', (req, res) => {
  const info = db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(req.params.id)
  if (!info.changes) return res.status(404).json({ chyba: 'Konverzácia neexistuje.' })
  res.json({ ok: true })
})

// ── Fotky do chatu ────────────────────────────────────────────
aiRouter.post('/fotky', uploadFotky.array('fotky', 4), (req, res) => {
  const subory = (req.files as Express.Multer.File[]) ?? []
  res.json({ fotky: subory.map(ulozFotku) })
})

// ── Odoslanie správy a streamovanie odpovede ──────────────────
aiRouter.post('/konverzacie/:id/sprava', async (req, res) => {
  const anthropic = ziskajKlienta()
  if (!anthropic) {
    return res.status(503).json({
      chyba: 'Chýba ANTHROPIC_API_KEY. Doplň ho do súboru .env a reštartuj appku.',
    })
  }

  const konverzacia = db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(req.params.id) as any
  if (!konverzacia) return res.status(404).json({ chyba: 'Konverzácia neexistuje.' })
  const asistent: string = konverzacia.asistent
  if (!jeAsistent(asistent)) return res.status(400).json({ chyba: 'Neznámy asistent.' })

  const text = String(req.body?.sprava ?? '').trim()
  if (!text) return res.status(400).json({ chyba: 'Prázdna správa.' })

  // Uložíme otázku ešte pred volaním API – nech sa nestratí, ak volanie zlyhá.
  db.prepare('INSERT INTO ai_messages (conversation_id, rola, obsah) VALUES (?, ?, ?)')
    .run(konverzacia.id, 'user', text)
  if (konverzacia.nazov === 'Nová konverzácia') {
    db.prepare('UPDATE ai_conversations SET nazov = ? WHERE id = ?').run(odvodNazov(text), konverzacia.id)
  }

  const historia = db
    .prepare('SELECT rola, obsah FROM ai_messages WHERE conversation_id = ? ORDER BY id')
    .all(konverzacia.id) as { rola: string; obsah: string }[]

  const spravy: Anthropic.MessageParam[] = historia.map((m) => ({
    role: m.rola === 'user' ? 'user' : 'assistant',
    content: m.obsah,
  }))

  // Fotky pripájame len k aktuálnej otázke – história ostáva textová, aby sa
  // každé ďalšie volanie nenafukovalo o megabajty obrázkov.
  const idFotiek: number[] = Array.isArray(req.body?.fotky) ? req.body.fotky.map(Number) : []
  if (idFotiek.length && spravy.length) {
    const posledna = spravy[spravy.length - 1]
    const najdene = idFotiek.map(najdiFotku).filter((f): f is NonNullable<typeof f> => !!f)

    if (najdene.length) {
      const zoznam = najdene.map((f) => `${f.nazov} (fotka_id: ${f.id})`).join(', ')
      const povodnyText = typeof posledna.content === 'string' ? posledna.content : text
      posledna.content = [
        ...najdene.map(fotkaPreClaude),
        { type: 'text' as const, text: `${povodnyText}\n\n[Prílohy: ${zoznam}]` },
      ]
      // Do histórie uložíme len poznámku, nie samotné obrázky.
      db.prepare('UPDATE ai_messages SET obsah = ? WHERE id = (SELECT MAX(id) FROM ai_messages WHERE conversation_id = ?)')
        .run(`${text}\n\n[Prílohy: ${najdene.map((f) => f.nazov).join(', ')}]`, konverzacia.id)
    }
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const posli = (typ: string, data: unknown) => {
    res.write(`event: ${typ}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const maNastroje = ASISTENTI_S_NASTROJMI.includes(asistent)
  let odpoved = ''
  let dokoncene = false
  let prerusene = false

  try {
    // Pomocník môže potrebovať viac kôl: načítať dáta → zapísať → potvrdiť.
    // Strop je poistka proti zacykleniu, bežne stačia dve-tri kolá.
    for (let kolo = 0; kolo < 8; kolo++) {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        system: systemovyPrompt(asistent),
        messages: spravy,
        ...(maNastroje ? { tools: DEFINICIE_NASTROJOV } : {}),
      })

      // Ak používateľ zavrie stránku, nemá zmysel ďalej generovať (a platiť za to).
      // Pozor: musí to byť `res`, nie `req` – `req` sa zatvára hneď po načítaní tela.
      res.on('close', () => {
        prerusene = true
        if (!dokoncene) stream.abort()
      })

      for await (const udalost of stream) {
        if (udalost.type === 'content_block_delta' && udalost.delta.type === 'text_delta') {
          odpoved += udalost.delta.text
          posli('text', { text: udalost.delta.text })
        }
      }

      const finalna = await stream.finalMessage()

      if (finalna.stop_reason === 'refusal') {
        odpoved += odpoved
          ? '\n\n(Odpoveď bola prerušená bezpečnostným filtrom.)'
          : 'Na túto otázku neviem odpovedať.'
        break
      }

      const poziadavky = finalna.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (!poziadavky.length) break

      // Claude chce použiť nástroje – vykonáme ich a výsledky mu pošleme späť.
      spravy.push({ role: 'assistant', content: finalna.content })
      const vysledky: Anthropic.ToolResultBlockParam[] = []

      for (const p of poziadavky) {
        posli('nastroj', { nazov: p.name, zapisuje: !!NASTROJE[p.name]?.zapisuje })
        const { vysledok, chyba } = await spustiNastroj(p.name, p.input, konverzacia.id)
        vysledky.push({
          type: 'tool_result',
          tool_use_id: p.id,
          content: vysledok,
          ...(chyba ? { is_error: true } : {}),
        })
      }

      spravy.push({ role: 'user', content: vysledky })
      if (prerusene) break
    }
    dokoncene = true
  } catch (e: any) {
    dokoncene = true
    // Prerušenie po zavretí stránky nie je chyba – používateľ o odpoveď už nestojí.
    if (e?.name === 'APIUserAbortError') {
      if (odpoved.trim()) {
        db.prepare('INSERT INTO ai_messages (conversation_id, rola, obsah) VALUES (?, ?, ?)')
          .run(konverzacia.id, 'assistant', odpoved)
      }
      return res.end()
    }
    console.error('[ai]', e)
    const sprava =
      e?.status === 401
        ? 'API kľúč nie je platný. Skontroluj ANTHROPIC_API_KEY v .env.'
        : e?.status === 429
          ? 'Asistent je momentálne preťažený. Skús to o chvíľu znova.'
          : e?.message || 'Volanie AI zlyhalo.'
    posli('chyba', { chyba: sprava })
  }

  if (odpoved.trim()) {
    db.prepare('INSERT INTO ai_messages (conversation_id, rola, obsah) VALUES (?, ?, ?)')
      .run(konverzacia.id, 'assistant', odpoved)
  }
  db.prepare("UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?").run(konverzacia.id)

  posli('koniec', { ok: true })
  res.end()
})
