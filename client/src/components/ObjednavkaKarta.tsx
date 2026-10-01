import { skCislo, skDatum, skSuma, NAZVY_STAVOV_OBJEDNAVKY, STITOK_OBJEDNAVKY, type Objednavka } from '../api'
import { type AkciaMenu } from './MenuAkcii'
import { ZaznamRiadok } from './Zoznam'

/**
 * Objednávka v zozname na telefóne: číslo a dátum, popis s firmou, stav s hodinami a hodnota.
 * Pri turnuse sa jeho názov neopakuje (`vTurnuse`).
 */
export function ObjednavkaKarta({
  o,
  otvor,
  akcie,
  vTurnuse = false,
}: {
  o: Objednavka
  otvor: () => void
  akcie?: AkciaMenu[]
  vTurnuse?: boolean
}) {
  const pod = [o.firma_nazov, !vTurnuse && o.turnus_nazov].filter(Boolean).join(' · ')
  return (
    <ZaznamRiadok
      className="objednavka-riadok"
      tlmeny={o.stav === 'zrusena'}
      otvor={otvor}
      hore={
        <>
          <span className="zaznam-datum">{o.cislo || 'bez čísla'}</span>
          {o.datum && <span className="zaznam-id">{skDatum(o.datum)}</span>}
        </>
      }
      popisAkcii={`Akcie objednávky ${o.cislo || o.popis}`}
      akcie={akcie}
      hlavny={
        <>
          {o.popis || o.cislo || 'Objednávka'}
          {pod && <span className="pod-textom">{pod}</span>}
        </>
      }
      dole={
        <>
          <span className={'stitok ' + STITOK_OBJEDNAVKY[o.stav_zobraz]}>{NAZVY_STAVOV_OBJEDNAVKY[o.stav_zobraz]}</span>
          {o.hodinovka > 0 && (
            <span>
              {o.hodiny > 0 ? `${skCislo(o.hodiny)} h × ` : ''}
              {skSuma(o.hodinovka)}/h
            </span>
          )}
        </>
      }
      suma={o.suma ? <strong>{skSuma(o.suma)}</strong> : undefined}
    />
  )
}
