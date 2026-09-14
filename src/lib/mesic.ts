// Měsíc jako mřížka — čistá logika, kterou potřebuje Plán.
//
// Počítá se výhradně přes `dates.ts` (lokální dny, žádné `toISOString()`),
// takže to kolem půlnoci neuteče do UTC a přechod na letní čas nepřidá
// ani neubere den.

import { fromISODate } from './dates'

/** „2026-09" z libovolného dne. */
export const kotvaMesice = (iso: string): string => iso.slice(0, 7)

/**
 * Posun o N měsíců. Počítá se od PRVNÍHO dne, ne od zadaného: kdyby se
 * posouval 31. leden, skončil by v březnu, protože únor třicátého prvního
 * nemá. Listování měsíci pak přeskakuje celý měsíc.
 */
export function posunMesic(kotva: string, o: number): string {
  const [rok, mesic] = kotva.split('-').map(Number)
  const d = new Date(rok, mesic - 1 + o, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Kolik dnů má měsíc (nultý den dalšího měsíce je poslední den tohohle). */
export const dnuVMesici = (kotva: string): number => {
  const [rok, mesic] = kotva.split('-').map(Number)
  return new Date(rok, mesic, 0).getDate()
}

/**
 * Kolik prázdných buněk stojí před prvním dnem, aby mřížka začínala
 * pondělím. Týden začíná v pondělí, jak se píše česky — ne nedělí.
 */
export const odsazeniMesice = (kotva: string): number =>
  (fromISODate(`${kotva}-01`).getDay() + 6) % 7

/** Dny měsíce jako ISO, od prvního do posledního. */
export function dnyMesice(kotva: string): string[] {
  return Array.from(
    { length: dnuVMesici(kotva) },
    (_, i) => `${kotva}-${String(i + 1).padStart(2, '0')}`,
  )
}
