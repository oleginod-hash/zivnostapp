import { NAZVY_STAVOV, STITOK_STAVU, type StavZobraz } from '../api'
import { Ikona, type KlucIkony } from './Ikony'

/** Ikona ku každému stavu faktúry – aby sa dal stav prečítať aj bez farby. */
const IKONA_STAVU: Record<StavZobraz, KlucIkony> = {
  koncept: 'upravit',
  vystavena: 'faktury',
  zaplatena: 'zaplatena',
  ciastocne: 'hodiny',
  po_splatnosti: 'pozor',
  po_splatnosti_ciastocne: 'pozor',
}

/**
 * Krátke názvy do úzkych tabuliek. „Po termíne" netreba písať – povie to
 * červená farba, výstražná ikona aj odpočet dní pri splatnosti. Celý názov
 * sa ukáže po prejdení myšou.
 */
const KRATKY_NAZOV: Partial<Record<StavZobraz, string>> = {
  ciastocne: 'Čiastočne',
  po_splatnosti_ciastocne: 'Čiastočne',
}

/** Štítok stavu faktúry s ikonou. */
export function StitokStavu({ stav, kratko = false }: { stav: StavZobraz; kratko?: boolean }) {
  return (
    <span className={'stitok ' + STITOK_STAVU[stav]} title={NAZVY_STAVOV[stav]}>
      <Ikona nazov={IKONA_STAVU[stav]} velkost={12} hrubka={2.4} />
      {(kratko && KRATKY_NAZOV[stav]) || NAZVY_STAVOV[stav]}
    </span>
  )
}

/** Štítok zálohovej faktúry. */
export function StitokZalohy() {
  return (
    <span className="stitok zaloha">
      <Ikona nazov="zaloha" velkost={12} hrubka={2.2} />
      záloha
    </span>
  )
}
