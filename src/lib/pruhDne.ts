// Pruh dne: jeden vodorovný graf, jehož délka je PRÁCE a barvy jsou klienti.
//
// Vznikl v Plánu (den = řádek) a je to jediný opravdu vlastní obrázek,
// který appka má — proto nebydlí v jednom pohledu, ale tady, a kreslí ho
// `src/components/PruhDne.tsx`. Kdo ho počítá po svém, dřív nebo později
// se s Plánem rozejde v tom, co se do dne počítá.
//
// DÉLKA JE POČET ÚKOLŮ, NE ODHADOVANÝ ČAS
//
// Původně to byly minuty z `estimateMinutes`. To číslo appka neměřila,
// hádala ho heuristika o osmi klíčových slovech — 53 % úkolů ho nemělo
// vůbec (tiše se za ně počítala hodina) a zbytek měl jen dvě hodnoty.
// Pruh tedy kreslil přesně vypadající obrázek z čísla, které nikdo
// nespočítal: den se dvěma úkoly mohl být delší než den se čtyřmi podle
// toho, jestli se v názvu trefilo klíčové slovo.
//
// Teď je jednotka JEDEN ÚKOL — tedy přesně ta jednotka, ve které appka
// měří i strop dne (`prutok.ts`, `kapacitaDne.ts`). Pruh a verdikt nad
// ním konečně mluví jednou řečí: plný pruh znamená „tolik práce za den
// ti obvykle projde", a co přeteče, je nad tvůj dobrý den.
//
// SCHŮZKY V PRUHU NEJSOU
//
// Dřív padaly do neutrálního dílu, protože pruh měřil čas a schůzka čas
// zabírá. V kusech by ale schůzka byla „jeden úkol", což není pravda —
// a hlavně by pruh zase říkal něco jiného než strop, který je výhradně
// o mojí práci. Kolik času zbývá mezi schůzkami, říká měřená věta ze
// skutečného kalendáře („zbývá ~3 h"), ne tenhle obrázek.
import type { Task } from '../db/types'

/**
 * Proti čemu se pruh kreslí, dokud appka strop neumí spočítat (míň než
 * `MIN_DNU` dnů historie). Není to strop a nic z něj neplyne — jen aby
 * první týden nevycházel den s jedním úkolem jako plný. Soud nad dnem
 * v té době nepadá žádný.
 */
export const ZAKLAD_BEZ_STROPU = 4

/** Jeden díl pruhu. Bez barvy = úkoly bez klienta. */
export interface Dil {
  barva?: string
  pocet: number
}

/**
 * Díly pruhu jednoho dne: počty úkolů po klientech sestupně a na konci
 * jediný neutrální díl — úkoly bez klienta.
 *
 * Klient, kterého appka nezná (smazaný, nebo cizí ze sdílení, na které
 * uživatel nedosáhne), spadne do neutrálního dílu, ne pod vlastní barvu:
 * barvu by mu stejně nikdo nepřiřadil a pruh by měl díl bez významu.
 */
export function dilyDne(ukoly: Task[], barvaKlienta: (clientId: string) => string | undefined): Dil[] {
  const podleKlienta = new Map<string, number>()
  for (const t of ukoly) {
    const barva = t.clientId ? barvaKlienta(t.clientId) : undefined
    const klic = barva ? t.clientId! : ''
    podleKlienta.set(klic, (podleKlienta.get(klic) ?? 0) + 1)
  }
  const neutralni = podleKlienta.get('') ?? 0
  const dily: Dil[] = [...podleKlienta]
    .filter(([klic]) => klic !== '')
    .map(([klic, pocet]) => ({ barva: barvaKlienta(klic)!, pocet }))
    .sort((a, b) => b.pocet - a.pocet)
  if (neutralni > 0) dily.push({ pocet: neutralni })
  return dily
}

/** Součet úkolů ve všech dílech — délka, kterou pruh ukazuje. */
export const ukolyVDilech = (dily: Dil[]): number => dily.reduce((soucet, d) => soucet + d.pocet, 0)
