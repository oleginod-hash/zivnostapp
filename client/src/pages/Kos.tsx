import { useEffect, useState } from 'react'
import { api, pocet, skDatum, type PolozkaKosa } from '../api'
import { Ikona, type KlucIkony } from '../components/Ikony'
import { PrazdnyStav } from '../components/PrazdnyStav'
import { potvrd } from '../components/Oznamenia'

/** Ktorá ikona patrí ktorej tabuľke – nech je na prvý pohľad jasné, čo to bolo. */
const IKONY: Record<string, KlucIkony> = {
  invoices: 'faktury',
  contracts: 'zmluvy',
  tours: 'turnusy',
  orders: 'objednavky',
  expenses: 'vydavky',
  companies: 'firmy',
}

export function Kos() {
  const [polozky, setPolozky] = useState<PolozkaKosa[] | null>(null)
  const [vybrane, setVybrane] = useState<Set<number>>(new Set())
  const [chyba, setChyba] = useState('')
  const [sprava, setSprava] = useState('')
  const [pracujem, setPracujem] = useState(false)

  function nacitaj() {
    api
      .get<PolozkaKosa[]>('/kos')
      .then((p) => {
        setPolozky(p)
        // Po každej akcii začíname s čistým výberom – inak by ostali
        // zaškrtnuté id, ktoré už v koši nie sú.
        setVybrane(new Set())
      })
      .catch((e) => setChyba(e.message))
  }

  useEffect(nacitaj, [])

  function oznam(text: string) {
    setSprava(text)
    setTimeout(() => setSprava(''), 5000)
  }

  function prepni(id: number) {
    const n = new Set(vybrane)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setVybrane(n)
  }

  function prepniVsetky() {
    if (!polozky) return
    setVybrane(vybrane.size === polozky.length ? new Set() : new Set(polozky.map((p) => p.id)))
  }

  async function obnov(p: PolozkaKosa) {
    setChyba('')
    try {
      const r = await api.post<{ sprava: string }>(`/kos/${p.id}/obnovit`)
      oznam(r.sprava)
      nacitaj()
    } catch (e: any) {
      setChyba(e.message)
    }
  }

  async function zmazNatrvalo(p: PolozkaKosa) {
    const ano = await potvrd({
      nadpis: `Zmazať „${p.popis}" natrvalo?`,
      text: 'Toto je jediná akcia v celej appke, po ktorej sa dáta už nedajú vrátiť.',
      potvrdit: 'Zmazať natrvalo',
      nebezpecne: true,
    })
    if (!ano) return
    await api.del(`/kos/${p.id}`)
    nacitaj()
  }

  async function obnovVybrane() {
    setChyba('')
    setPracujem(true)
    try {
      const r = await api.post<{ vratene: number; chyby: string[] }>('/kos/obnovit', { id: [...vybrane] })
      oznam(
        `Vrátených ${pocet(r.vratene, ['položka', 'položky', 'položiek'])}.` +
          (r.chyby.length ? ` Nepodarilo sa: ${r.chyby.join(' ')}` : ''),
      )
      nacitaj()
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setPracujem(false)
    }
  }

  async function zmazVybrane() {
    const n = vybrane.size
    const ano = await potvrd({
      nadpis: `Zmazať natrvalo ${pocet(n, ['vybranú položku', 'vybrané položky', 'vybraných položiek'])}?`,
      text: 'Tieto dáta sa už nebudú dať vrátiť.',
      potvrdit: 'Zmazať natrvalo',
      nebezpecne: true,
    })
    if (!ano) return
    setPracujem(true)
    try {
      await api.post('/kos/vysypat', { id: [...vybrane] })
      nacitaj()
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setPracujem(false)
    }
  }

  async function vysypVsetko() {
    const n = polozky?.length ?? 0
    // Otázka je jedna, ale pomenúva presne, čo sa stane. Toto je jediné
    // miesto v appke, kde sa dáta stratia nenávratne.
    const ano = await potvrd({
      nadpis: 'Vyprázdniť celý kôš?',
      text: `Natrvalo sa zmaže ${pocet(n, ['položka', 'položky', 'položiek'])} aj s prílohami. Vrátiť sa to už nedá.`,
      potvrdit: 'Vyprázdniť kôš',
      nebezpecne: true,
    })
    if (!ano) return
    setPracujem(true)
    try {
      const r = await api.post<{ zmazane: number }>('/kos/vysypat')
      oznam(`Kôš je vyprázdnený. Natrvalo zmazané: ${pocet(r.zmazane, ['položka', 'položky', 'položiek'])}.`)
      nacitaj()
    } catch (e: any) {
      setChyba(e.message)
    } finally {
      setPracujem(false)
    }
  }

  const vsetkyVybrane = !!polozky?.length && vybrane.size === polozky.length

  return (
    <>
      <div className="hlavicka">
        <h1>Kôš</h1>
        {!!polozky?.length && (
          <div className="akcie">
            <button className="nebezpecne" onClick={vysypVsetko} disabled={pracujem}>
              Vyprázdniť kôš
            </button>
          </div>
        )}
      </div>

      {chyba && <div className="chyba">{chyba}</div>}
      {sprava && <div className="uspech">{sprava}</div>}

      <div className="info-pruh">
        Zmazané záznamy tu zostanú <strong>30 dní</strong>, potom sa odstránia automaticky. Dovtedy sa dajú
        vrátiť. Prílohy a doklady k nim ostávajú uložené, takže sa obnovia aj tie.
      </div>

      {vybrane.size > 0 && (
        <div className="vyber-pruh">
          <span>
            Vybraných <strong>{vybrane.size}</strong> z {polozky?.length}
          </span>
          <div className="vyber-akcie">
            <button className="maly primar" onClick={obnovVybrane} disabled={pracujem}>
              Vrátiť späť
            </button>
            <button className="maly nebezpecne" onClick={zmazVybrane} disabled={pracujem}>
              Zmazať natrvalo
            </button>
            <button className="maly holy" onClick={() => setVybrane(new Set())}>
              Zrušiť výber
            </button>
          </div>
        </div>
      )}

      <div className="panel tesny">
        {!polozky ? (
          <div className="nacitava">Načítavam…</div>
        ) : polozky.length === 0 ? (
          <PrazdnyStav
            ikona="kos"
            nadpis="Kôš je prázdny"
            text="Všetko, čo v appke zmažeš, tu zostane 30 dní a dá sa vrátiť aj s platbami a dokladmi."
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 38 }}>
                  <input
                    type="checkbox"
                    aria-label="Vybrať všetko"
                    style={{ width: 'auto' }}
                    checked={vsetkyVybrane}
                    onChange={prepniVsetky}
                  />
                </th>
                <th>Položka</th>
                <th>Typ</th>
                <th>Zmazané</th>
                <th style={{ width: 250 }}></th>
              </tr>
            </thead>
            <tbody>
              {polozky.map((p) => (
                <tr
                  key={p.id}
                  className={vybrane.has(p.id) ? 'vybrany' : ''}
                  style={{ cursor: 'pointer' }}
                  onClick={() => prepni(p.id)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Vybrať ${p.popis}`}
                      style={{ width: 'auto' }}
                      checked={vybrane.has(p.id)}
                      onChange={() => prepni(p.id)}
                    />
                  </td>
                  <td className="hlavna-bunka">
                    <strong>{p.popis}</strong>
                  </td>
                  <td className="tlmene">
                    <span className="typ-s-ikonou">
                      <Ikona nazov={IKONY[p.tabulka] ?? 'podklad'} />
                      {p.nazov_typu}
                    </span>
                  </td>
                  <td className="tlmene">{skDatum(p.zmazane_at)}</td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                    <button className="maly primar" onClick={() => obnov(p)}>
                      Vrátiť späť
                    </button>{' '}
                    <button className="maly nebezpecne" onClick={() => zmazNatrvalo(p)}>
                      Zmazať natrvalo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {polozky && polozky.length > 0 && (
        <div className="tlmene" style={{ fontSize: 13 }}>
          {pocet(polozky.length, ['položka', 'položky', 'položiek'])} v koši · klikni na riadok pre výber
        </div>
      )}
    </>
  )
}
