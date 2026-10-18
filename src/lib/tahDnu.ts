// Přepínání dnů tahem přes hlavičku na Dnes — čistá logika s testy.
//
// Tah DOLEVA (obsah jede doprava) = další den, DOPRAVA = den zpátky,
// a před dnešek se nejde: Dnes se dívá dopředu, minulost je triáž.
//
// Proč jen přes HLAVIČKU (Michalova volba): řádky úkolů mají vodorovná
// gesta odjakživa — doprava odškrtne, doleva pošle na zítřek. Kdyby se
// den přepínal tahem kdekoli, „zpátky na předchozí den" by po řádku
// úkol tiše odškrtlo. Hlavička (titulek, datum, pruh) žádné gesto nemá
// a je velká dost na palec.
//
// Gesto se rozhoduje až po pohybu o `ROZHODNUTI` px — do té doby nevíme,
// jestli člověk roluje stránku, nebo listuje dny, a ukvapené rozhodnutí
// by svislé rolování z hlavičky umrtvilo.

import { formatDayName } from './dates'

/** Kolik px musí prst ujet, než se rozhodne osa gesta. */
export const ROZHODNUTI = 8
/** Pomalý tah přepne den od téhle délky… */
export const PRAH_TAHU = 56
/** …rychlý švih už od kratší (px/ms). */
export const PRAH_RYCHLOSTI = 0.45
const MIN_SVIH = 20

export type Osa = 'x' | 'y'

/** Osa gesta, nebo `null`, dokud se o ní nedá rozhodnout. */
export function osaTahu(dx: number, dy: number): Osa | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < ROZHODNUTI) return null
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
}

/**
 * Výsledek puštěného tahu: +1 další den, −1 předchozí, 0 nic.
 * `posun` je, o kolik dní za dneškem hlavička právě stojí.
 */
export function vysledekTahu(dx: number, ms: number, posun: number): -1 | 0 | 1 {
  const delka = Math.abs(dx)
  const rychlost = delka / Math.max(ms, 1)
  const dost = delka >= PRAH_TAHU || (delka >= MIN_SVIH && rychlost >= PRAH_RYCHLOSTI)
  if (!dost) return 0
  if (dx < 0) return 1
  return posun > 0 ? -1 : 0
}

/**
 * Jak daleko hlavička jede za prstem. Na kraji (dnešek, tah zpátky)
 * klade odpor a zastaví se — gumička říká „dál to nejde" líp než nic.
 */
export function posunHlavicky(dx: number, posun: number): number {
  if (dx > 0 && posun === 0) return Math.min(32, dx * 0.25)
  return dx * 0.6
}

/** Titulek: Dnes, Zítra, dál jméno dne („Sobota"). */
export function titulekDne(posun: number, den: string): string {
  if (posun <= 0) return 'Dnes'
  if (posun === 1) return 'Zítra'
  const jmeno = formatDayName(den)
  return jmeno.charAt(0).toUpperCase() + jmeno.slice(1)
}
