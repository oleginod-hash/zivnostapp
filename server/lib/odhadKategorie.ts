import { naHladanie } from './format.js'

/**
 * Kategória výdavku podľa toho, komu išla platba. Len pre bežných príjemcov,
 * pri ktorých sa nedá pomýliť – ostatné sa appka naučí z predchádzajúcich
 * výdavkov (pozri routes/banka.ts). Názvy kategórií sú tie z appky; podľa
 * „Odvody" a „Daň" spoznáva zaplatené odvody a dane rezerva (lib/rezerva.ts).
 */
const PRAVIDLA: [RegExp, string][] = [
  [/socialna poistovna|zdravotna poistovna|vseobecna zdravotna|\bvszp\b|\bdovera\b|union zdravotna/, 'Odvody (SP/ZP)'],
  [/danovy urad|financna sprava|financne riaditelstvo/, 'Daň'],
  [/poplatok za vedenie|vedenie uctu|mesacny poplatok|poplatok banke|bankovy poplatok/, 'Bankové poplatky'],
  [/\borange\b|slovak telekom|telekom|\bo2 slovakia\b|\b4ka\b|swan|slovanet|\bupc\b|antik telecom/, 'Telefón a internet'],
  [/slovnaft|\bomv\b|\bshell\b|\bmol\b|lukoil|tankovanie|dialnic|eznamka|e-znamka/, 'Doprava'],
  [/ryanair|wizz ?air|regiojet|flixbus|\bzssk\b|leo express/, 'Doprava'],
  [/booking\.com|airbnb|ubytovanie|hotel/, 'Ubytovanie'],
]

export function odhadniKategoriu(...texty: string[]): string {
  const t = naHladanie(texty.filter(Boolean).join(' '))
  return PRAVIDLA.find(([vzor]) => vzor.test(t))?.[1] ?? ''
}
