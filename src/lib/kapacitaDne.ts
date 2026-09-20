// Strop dne — den má konec a appka to musí říct VE CHVÍLI ROZHODNUTÍ.
//
// PROČ TO VZNIKLO
//
// Appka uměla poznat přetížený den odjakživa (`isOverloaded`), jenže to
// uměla jen na obrazovce Dnes — tedy v den, kdy už se s tím nedá nic
// dělat. Ve chvíli, kdy se práce na den SYPE, mlčela úplně.
//
// Změřeno na skutečných datech (12 dní provozu):
//
//   | den            | naplánováno      | hotovo |
//   |----------------|------------------|--------|
//   | čt 17. 9.      | 7 úkolů · 495 min|   1    |
//   | pá 18. 9.      | 4 úkoly  · 225 min|   0   |
//   | čt 10. 9.      | 3 úkoly  · 165 min|   0   |
//   | so 12. 9.      | 0                |   2    |
//   | so 19. 9.      | 0                |   2    |
//
// Dny, které se naplní, jsou přesně ty, co spadnou: osm a čtvrt hodiny
// práce na jeden čtvrtek — před první schůzkou — a zbylo z toho jedno
// odškrtnutí. Práce se pak dělala v sobotu, na kterou se neplánovalo nic.
// Sedm úkolů ze sedmnáctého tam navíc leželo i o tři dny později.
//
// PRAVIDLO JE TO, KTERÉ UŽ PRUH DNE KRESLÍ
//
// Nezavádí se druhá míra vytíženosti. Pruh dne je dlouhý `PLNY_DEN_MIN`
// (8 h = pracovní doba `WORK_START`–`WORK_END` ve `freeSlot.ts`) a jeho
// díly jsou odhady úkolů PLUS délka schůzek. Přetečený pruh tedy přesně
// znamená „úkoly se nevejdou do zbytku pracovní doby":
//
//   úkoly + schůzky > 8 h   ⟺   úkoly > 8 h − schůzky
//
// Strop proto nemá vlastní číslo — jen dává hlas tomu, co pruh odjakživa
// ukazuje. Kdo by si sem napsal jiné číslo, rozejde se s obrázkem na téže
// obrazovce.
//
// TOLERANCE JE ZÁMĚR
//
// Den přetečený o dvacet minut není přeplněný den, je to normální den.
// Hlásit ho znamená hlásit skoro každý — a signál, který svítí pořád,
// přestane být signál. Je to tatáž tolerance, jakou má `isOverloaded`.

import { PLNY_DEN_MIN } from './pruhDne'

export { PLNY_DEN_MIN as STROP_DNE_MIN }

/** Menší přesah se neřeší — viz „tolerance je záměr" v hlavičce. */
export const TOLERANCE_MIN = 30

/**
 * O kolik minut den přetéká přes strop. Do tolerance včetně vrací 0,
 * takže „přetéká" a „je toho moc" je jedno a totéž číslo.
 */
export function prebytekDne(minuty: number, strop: number = PLNY_DEN_MIN): number {
  const pres = minuty - strop
  return pres > TOLERANCE_MIN ? pres : 0
}

/**
 * Je na ten den víc práce, než se do něj vejde?
 *
 * `strop` je ve výchozím stavu pracovní doba, ale obrazovky ho podávají
 * z vlastní historie (`useOsobniStrop` v `prutok.ts`): osm hodin je
 * poctivé číslo o hodinách, ne o tom, kolik práce projde TOUHLE appkou.
 */
export const jePreplneno = (minuty: number, strop: number = PLNY_DEN_MIN): boolean =>
  prebytekDne(minuty, strop) > 0

/**
 * Minuty jako hodiny po česku („8,3 h"). Desetina hodiny je nejjemnější
 * dílek, který dává smysl: rozdíl šesti minut nikoho nezajímá a „8,25 h"
 * vypadá jako výsledek výpočtu, ne jako odpověď.
 */
export function hodiny(minuty: number): string {
  const h = Math.round(minuty / 6) / 10
  return `${String(h).replace('.', ',')} h`
}

/**
 * Věta do toastu, když práce míří na den, který už je plný.
 *
 * Říká VÝSLEDEK, ne výtku: kolik na tom dni po téhle změně stojí. Appka
 * nikdy nebrání — úkol na ten den opravdu jde a zůstane tam, dokud s ním
 * člověk sám nepohne. To je celý rozdíl mezi „řeknu ti to" a „nedovolím
 * ti to"; druhé by byl dialog, a ty v téhle appce nejsou.
 */
export function popisPreplneneho(popisDne: string, minuty: number): string {
  return `${popisDne} má ${hodiny(minuty)} práce`
}
