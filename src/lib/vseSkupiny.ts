// Rozdělení VŠECH otevřených úkolů do časových košů.
//
// Obrazovka „Vše" odpovídá na jinou otázku než Dnes: ne „co teď?", ale
// „kde je ten úkol?" a „co všechno mám rozdělané?". Na to je plochý
// seznam tří set řádků k ničemu — člověk v něm hledá podle času („bylo to
// někdy příští týden"), ne podle pořadí. Koše jsou proto dny, ne priorita.
//
// Uvnitř koše se řadí CHRONOLOGICKY a teprve při shodě podle priority:
// v koši „později" může ležet půl roku práce a kritický úkol z března nad
// zítřejším termínem by seznam zamíchal. `sortTasks` (priorita nejdřív)
// se proto použije jen jako druhotné kritérium — řazení v JS je stabilní.

import type { Task } from '../db/types'
import { addDays, fromISODate, mondayOf, toISODate } from './dates'

export type KosId = 'poTerminu' | 'dnes' | 'zitra' | 'tyden' | 'pozdeji' | 'bezTerminu'

export interface Kos {
  id: KosId
  // Malými písmeny — velké písmeno dodá `.section-label` přes ::first-letter.
  jmeno: string
  ukoly: Task[]
}

// Nejbližší relevantní den úkolu — dřívější z „naplánováno" a „termín".
// Totéž, co používá Dnes; jedna definice „kdy to je" pro celou appku.
export const denUkolu = (t: Task): string | undefined =>
  [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d)).sort()[0]

export function zaradDoKose(den: string | undefined, dnes: string): KosId {
  if (!den) return 'bezTerminu'
  if (den < dnes) return 'poTerminu'
  if (den === dnes) return 'dnes'
  if (den === toISODate(addDays(fromISODate(dnes), 1))) return 'zitra'
  // Konec tohoto týdne je neděle — pondělí je „později", i když je za dva dny.
  // Týden je jednotka plánování, ne posuvné okno sedmi dnů.
  if (den <= toISODate(addDays(fromISODate(mondayOf(dnes)), 6))) return 'tyden'
  return 'pozdeji'
}

const JMENA: Record<KosId, string> = {
  poTerminu: 'po termínu',
  dnes: 'dnes',
  zitra: 'zítra',
  tyden: 'tento týden',
  pozdeji: 'později',
  bezTerminu: 'bez termínu',
}

const PORADI: KosId[] = ['poTerminu', 'dnes', 'zitra', 'tyden', 'pozdeji', 'bezTerminu']

// `serad` je `sortTasks` z repo vrstvy — předává se, aby modul zůstal
// čistý a testovatelný bez databáze.
export function vseSkupiny(ukoly: Task[], dnes: string, serad: (t: Task[]) => Task[]): Kos[] {
  const mapa = new Map<KosId, Task[]>()
  for (const t of ukoly) {
    const id = zaradDoKose(denUkolu(t), dnes)
    // `push`, ne kopie pole na každý úkol — to je kvadratická práce.
    const uz = mapa.get(id)
    if (uz) uz.push(t)
    else mapa.set(id, [t])
  }
  return PORADI.filter((id) => (mapa.get(id)?.length ?? 0) > 0).map((id) => ({
    id,
    jmeno: JMENA[id],
    // Priorita nejdřív, pak stabilně přerovnat podle dne: den vyhrává,
    // priorita rozhoduje uvnitř téhož dne.
    ukoly:
      id === 'bezTerminu'
        ? serad(mapa.get(id)!)
        : serad(mapa.get(id)!).sort((a, b) => (denUkolu(a) ?? '').localeCompare(denUkolu(b) ?? '')),
  }))
}
