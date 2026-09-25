import { useEffect, useState } from 'react'
import { nastavSkryteSumy, sledujSkryteSumy, suSumySkryte } from '../api'
import { Ikona } from './Ikony'

/** Aktuálny stav skrytých súm a funkcia na prepnutie. */
export function useSkryteSumy(): [boolean, () => void] {
  const [skryte, setSkryte] = useState(suSumySkryte)
  useEffect(() => sledujSkryteSumy(() => setSkryte(suSumySkryte())), [])
  return [skryte, () => nastavSkryteSumy(!suSumySkryte())]
}

/** Malé tlačidlo s okom do bočného panela – sedí v jednom riadku s témou. */
export function PrepinacSum() {
  const [skryte, prepni] = useSkryteSumy()
  return (
    <button
      className={'prepinac-sum' + (skryte ? ' aktivna' : '')}
      title={skryte ? 'Zobraziť sumy' : 'Skryť sumy (napríklad keď sa na obrazovku pozerá niekto ďalší)'}
      aria-pressed={skryte}
      aria-label={skryte ? 'Zobraziť sumy' : 'Skryť sumy'}
      onClick={prepni}
    >
      <Ikona nazov={skryte ? 'okoSkryte' : 'oko'} velkost={16} hrubka={1.9} />
    </button>
  )
}

/** Tlačidlo s popisom – na Prehľad, kde sú sumy najviac na očiach. */
export function TlacidloSum() {
  const [skryte, prepni] = useSkryteSumy()
  return (
    <button className="tlacidlo-s-ikonou" aria-pressed={skryte} onClick={prepni}>
      <Ikona nazov={skryte ? 'okoSkryte' : 'oko'} />
      {skryte ? 'Zobraziť sumy' : 'Skryť sumy'}
    </button>
  )
}
