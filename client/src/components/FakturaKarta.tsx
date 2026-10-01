import { dniDoSplatnosti, pocet, skDatum, skSuma, type Faktura } from '../api'
import { type AkciaMenu } from './MenuAkcii'
import { StitokStavu, StitokZalohy } from './StitokStavu'
import { ZaznamRiadok } from './Zoznam'

/**
 * Maličký odpočet vedľa splatnosti: koľko dní ešte zostáva, alebo o koľko
 * dní je faktúra po termíne. Pri už uhradených faktúrach nemá čo robiť –
 * tam už na termíne nezáleží.
 */
export function Dni({ splatnost, otvorene = true }: { splatnost: string; otvorene?: boolean }) {
  if (!otvorene) return null
  const d = dniDoSplatnosti(splatnost)
  if (d === null) return null
  if (d === 0) return <span className="dni dnes" title="Splatnosť je dnes">dnes</span>
  if (d > 0) {
    return (
      <span className="dni zostava" title={`Do splatnosti zostáva ${pocet(d, ['deň', 'dni', 'dní'])}`}>
        +{d} d
      </span>
    )
  }
  return (
    <span className="dni po" title={`Po splatnosti už ${pocet(-d, ['deň', 'dni', 'dní'])}`}>
      −{-d} d
    </span>
  )
}

/**
 * Faktúra v zozname na telefóne – v troch riadkoch: číslo a dátum, odberateľ,
 * stav a suma. Rovnaká vo Faktúrach aj na Prehľade, nech ju človek všade spozná.
 */
export function FakturaKarta({ fa, otvor, akcie }: { fa: Faktura; otvor: () => void; akcie?: AkciaMenu[] }) {
  const otvorene = fa.otvoreny_zostatok > 0.005
  return (
    <ZaznamRiadok
      className="faktura-riadok"
      otvor={otvor}
      hore={
        <>
          <span className="cislo-faktury">{fa.cislo}</span>
          <span className="zaznam-id">{skDatum(fa.datum_vystav)}</span>
          {fa.typ === 'zaloha' && <StitokZalohy />}
        </>
      }
      popisAkcii={`Akcie faktúry ${fa.cislo}`}
      akcie={akcie}
      hlavny={
        <>
          {fa.firma_nazov || <span className="tlmene">bez odberateľa</span>}
          {(fa.turnus_nazov || fa.kryje_cislo) && (
            <span className="pod-textom">
              {[fa.turnus_nazov, fa.kryje_cislo && `splátka ${fa.kryje_cislo}`].filter(Boolean).join(' · ')}
            </span>
          )}
        </>
      }
      dole={
        <>
          <StitokStavu stav={fa.stav_zobraz} kratko />
          <Dni splatnost={fa.datum_splat} otvorene={otvorene && fa.stav !== 'koncept'} />
        </>
      }
      suma={
        <>
          <strong>{skSuma(fa.suma)}</strong>
          {otvorene && fa.uhradene_spolu > 0.005 && (
            <span className="pod-textom">zostáva {skSuma(fa.otvoreny_zostatok)}</span>
          )}
        </>
      }
    />
  )
}

/** Faktúra v zozname pri turnuse či objednávke – odberateľ je tam jasný, dôležitá je splatnosť. */
export function FakturaVZozname({
  fa,
  otvor,
}: {
  fa: Pick<Faktura, 'id' | 'cislo' | 'typ' | 'datum_vystav' | 'suma' | 'stav_zobraz'> & { datum_splat?: string }
  otvor: () => void
}) {
  return (
    <ZaznamRiadok
      className="faktura-riadok"
      otvor={otvor}
      hore={
        <>
          <span className="cislo-faktury">{fa.cislo}</span>
          <span className="zaznam-id">{skDatum(fa.datum_vystav)}</span>
          {fa.typ === 'zaloha' && <StitokZalohy />}
        </>
      }
      hlavny={fa.datum_splat ? `Splatná ${skDatum(fa.datum_splat)}` : `Vystavená ${skDatum(fa.datum_vystav)}`}
      dole={<StitokStavu stav={fa.stav_zobraz} kratko />}
      suma={<strong>{skSuma(fa.suma)}</strong>}
    />
  )
}
