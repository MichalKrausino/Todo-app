// Pruh dne: jeden vodorovný graf, jehož délka je čas a barvy jsou klienti.
//
// Vznikl v Plánu (den = řádek, čas = pruh) a je to jediný opravdu vlastní
// obrázek, který appka má — proto nebydlí v jednom pohledu, ale tady, a
// kreslí ho `src/components/PruhDne.tsx`. Kdo ho počítá po svém, dřív nebo
// později se s Plánem rozejde v tom, co se do dne počítá.
import type { Task } from '../db/types'
import { plannedMinutes } from './capacity'

/** Celý pruh = osm hodin; víc se do řádku nevejde a řekne to popisek. */
export const PLNY_DEN_MIN = 8 * 60

/** Jeden díl pruhu. Bez barvy = schůzka nebo úkol bez klienta. */
export interface Dil {
  barva?: string
  minuty: number
}

/**
 * Díly pruhu jednoho dne: čas úkolů po klientech sestupně a na konci
 * jediný neutrální díl — schůzky a úkoly bez klienta dohromady.
 *
 * Klient, kterého appka nezná (smazaný, nebo cizí ze sdílení, na které
 * uživatel nedosáhne), spadne do neutrálního dílu, ne pod vlastní barvu:
 * barvu by mu stejně nikdo nepřiřadil a pruh by měl díl bez významu.
 */
export function dilyDne(
  ukoly: Task[],
  schuzkyMinuty: number,
  barvaKlienta: (clientId: string) => string | undefined,
): Dil[] {
  const podleKlienta = new Map<string, number>()
  for (const t of ukoly) {
    const barva = t.clientId ? barvaKlienta(t.clientId) : undefined
    const klic = barva ? t.clientId! : ''
    podleKlienta.set(klic, (podleKlienta.get(klic) ?? 0) + plannedMinutes([t]))
  }
  const neutralni = (podleKlienta.get('') ?? 0) + Math.max(0, schuzkyMinuty)
  const dily: Dil[] = [...podleKlienta]
    .filter(([klic]) => klic !== '')
    .map(([klic, minuty]) => ({ barva: barvaKlienta(klic)!, minuty }))
    .sort((a, b) => b.minuty - a.minuty)
  if (neutralni > 0) dily.push({ minuty: neutralni })
  return dily
}

/** Součet minut všech dílů — délka, kterou pruh ukazuje. */
export const minutyDilu = (dily: Dil[]): number => dily.reduce((soucet, d) => soucet + d.minuty, 0)
