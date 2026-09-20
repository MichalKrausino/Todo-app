// Strop dne — den má konec a appka to musí říct VE CHVÍLI ROZHODNUTÍ.
//
// PROČ TO VZNIKLO
//
// Appka uměla poznat přetížený den odjakživa (`isOverloaded`), jenže to
// uměla jen na obrazovce Dnes — tedy v den, kdy už se s tím nedá nic
// dělat. Ve chvíli, kdy se práce na den SYPE, mlčela úplně.
//
// Změřeno na 12 dnech provozu:
//
//   | den            | naplánováno | hotovo |
//   |----------------|-------------|--------|
//   | čt 17. 9.      |  7 úkolů    |   1    |
//   | pá 18. 9.      |  4 úkoly    |   0    |
//   | čt 10. 9.      |  3 úkoly    |   0    |
//   | so 12. 9.      |  0          |   2    |
//   | so 19. 9.      |  0          |   2    |
//
// Dny, které se naplní, jsou přesně ty, co spadnou; práce se pak udělala
// v sobotu, na kterou se neplánovalo nic. Sedm úkolů ze sedmnáctého tam
// navíc leželo i o tři dny později.
//
// MĚŘÍ SE V ÚKOLECH, NE V MINUTÁCH
//
// První verze porovnávala odhadované minuty s délkou pracovní doby. To
// znělo přesněji, ale bylo to méně pravdivé: `estimateMinutes` je hádaný
// (53 % úkolů ho nemá vůbec, zbytek má jen dvě hodnoty) a s realitou se
// neporovnává. Počet úkolů je naproti tomu fakt — a vypráví týž příběh,
// jak je v tabulce výš vidět. Strop se proto bere z vlastní historie
// v KUSECH (`prutok.ts`): měřeno 17 dnů, medián 2 úkoly za den, nejlepší
// den vůbec 3.
//
// TOLERANCE JE ZÁMĚR
//
// Den o jeden úkol nad dobrým dnem není přeplněný den, je to ambiciózní
// den. Hlásit ho znamená hlásit skoro každý — a signál, který svítí
// pořád, přestane být signál.
//
// KDYŽ APPKA NEVÍ, MLČÍ
//
// Bez stropu (`undefined`, tedy málo historie) není nikdy nic přeplněné.

import { plural } from './labels'

/** O jeden úkol nad dobrý den se neřeší — viz „tolerance je záměr". */
export const TOLERANCE_UKOLU = 1

/**
 * O kolik úkolů den přetéká přes strop. Do tolerance včetně vrací 0,
 * takže „přetéká" a „je toho moc" je jedno a totéž číslo. Bez stropu
 * (appka toho člověka ještě nezná) je to vždycky 0.
 */
export function prebytekDne(pocet: number, strop: number | undefined): number {
  if (strop === undefined) return 0
  const pres = pocet - strop
  return pres > TOLERANCE_UKOLU ? pres : 0
}

/** Je na ten den víc práce, než se do něj vejde? */
export const jePreplneno = (pocet: number, strop: number | undefined): boolean =>
  prebytekDne(pocet, strop) > 0

/**
 * Věta do toastu, když práce míří na den, který už je plný.
 *
 * Říká VÝSLEDEK a měřítko, ne výtku: kolik na tom dni po téhle změně
 * stojí a kolik obvykle zvládneš. Appka nikdy nebrání — úkol na ten den
 * opravdu jde a zůstane tam, dokud s ním člověk sám nepohne. To je celý
 * rozdíl mezi „řeknu ti to" a „nedovolím ti to"; druhé by byl dialog,
 * a ty v téhle appce nejsou.
 */
export function popisPreplneneho(popisDne: string, pocet: number, obvykle: number): string {
  return `${popisDne} má ${pocet} ${plural(pocet, 'úkol', 'úkoly', 'úkolů')} · obvykle ${obvykle}`
}
