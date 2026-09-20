// Průtok — kolik úkolů projde tímhle člověkem za den doopravdy.
//
// PROČ SE POČÍTAJÍ KUSY, NE MINUTY
//
// První verze měřila průtok v minutách a strop dne s ní. Jenže minuta
// v téhle appce není měřená, je HÁDANÁ: `estimateMinutes` razítkuje
// heuristika o osmi klíčových slovech (`estimate.ts`) a co se netrefí,
// nedostane odhad vůbec.
//
// Změřeno na 45 úkolech skutečného provozu:
//
//   bez odhadu          24  (53 %) → tiše se počítá 60 min
//   odhad 30 min        11
//   odhad 90 min        10
//
// Tedy: polovina konstanta, druhá polovina hod mincí mezi dvěma čísly —
// a s realitou se to nikdy neporovná, protože appka čas neměří a měřit
// nezačne (stopky v todo appce jsou práce navíc, kterou nikdo nedělá).
// Stavět na tom verdikt „tenhle den je přeplněný" znamená stavět ho na
// písku.
//
// Přitom ten nález, kvůli kterému strop vznikl, žádné minuty nepotřebuje:
//
//   | den       | naplánováno | hotovo |
//   |-----------|-------------|--------|
//   | čt 17. 9. |   7 úkolů   |   1    |
//   | pá 18. 9. |   4 úkoly   |   0    |
//   | čt 10. 9. |   3 úkoly   |   0    |
//
// Ten příběh vypráví POČET, a počet je fakt. Měřeno na 17 dnech, ve
// kterých se něco dokončilo: **medián 2 úkoly za den, dobrý den 2,
// nejlepší den vůbec 3**. Na ten čtvrtek jich bylo naplánováno sedm.
//
// KDYŽ APPKA NEVÍ, MLČÍ
//
// Bez dostatečné historie nevrací strop žádné číslo (`undefined`) a nic
// se nehlídá. Dřív se v té situaci sahalo po pracovní době, tedy po
// osmi hodinách — to ale nebyla znalost, jen náhradní číslo, které se
// tvářilo jako znalost.

import { useLiveQuery } from 'dexie-react-hooks'
import type { Task } from '../db/types'
import { hotoveOd } from '../db/repo'
import { addDays, fromISODate, toISODate, todayISO } from './dates'
import { mojeUkoly } from './tymUkoly'
import { useJa } from './useTym'

/** Kolik dní zpátky se historie čte. */
export const OKNO_DNI = 30
/**
 * Kolik dní s hotovou prací musí být v okně, než se strop vezme vážně.
 * Míň je anekdota, ne míra — a nová appka nesmí nikomu nasadit strop
 * spočítaný z jeho prvního odpoledne.
 */
export const MIN_DNU = 7
/** „Dobrý den" — ne obvyklý, viz hlavička. */
export const PERCENTIL = 0.8

export interface Prutok {
  /** kolik dní s hotovou prací okno obsahuje */
  dnu: number
  /** medián úkolů za den — „obvyklý den" */
  median: number
  /** dobrý den (PERCENTIL) — z něj je strop */
  dobryDen: number
  /** nejlepší den v okně */
  nejlepsi: number
}

/** Kvantil ze setříděného pole (lineární interpolace). Prázdné pole = 0. */
export function kvantil(setridene: number[], p: number): number {
  if (setridene.length === 0) return 0
  if (setridene.length === 1) return setridene[0]
  const misto = (setridene.length - 1) * Math.min(1, Math.max(0, p))
  const dolni = Math.floor(misto)
  const horni = Math.ceil(misto)
  if (dolni === horni) return setridene[dolni]
  return setridene[dolni] + (setridene[horni] - setridene[dolni]) * (misto - dolni)
}

/**
 * Počty hotových úkolů po dnech. Počítají se JEN dny, ve kterých se něco
 * dokončilo — den bez jediného odškrtnutí není den s nulovým průtokem,
 * ale nejspíš den, kdy se appka neotevřela (víkend, dovolená, schůzky
 * celý den). Kdyby se nuly počítaly, stáhl by strop k zemi každý volný
 * týden.
 */
export function ukolyHotovePoDnech(ukoly: Task[], od: string, doDne: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of ukoly) {
    if (t.deletedAt || t.status !== 'done') continue
    const den = (t.completedAt ?? '').slice(0, 10)
    if (den < od || den > doDne) continue
    out.set(den, (out.get(den) ?? 0) + 1)
  }
  return out
}

/** Průtok z historie, nebo `undefined`, když je dat málo (viz `MIN_DNU`). */
export function osobniPrutok(ukoly: Task[], dnes: string, okno = OKNO_DNI): Prutok | undefined {
  const od = toISODate(addDays(fromISODate(dnes), -okno))
  const dny = [...ukolyHotovePoDnech(ukoly, od, dnes).values()].sort((a, b) => a - b)
  if (dny.length < MIN_DNU) return undefined
  return {
    dnu: dny.length,
    median: Math.round(kvantil(dny, 0.5)),
    dobryDen: Math.round(kvantil(dny, PERCENTIL)),
    nejlepsi: dny[dny.length - 1],
  }
}

/**
 * Strop dne v úkolech, nebo `undefined`, když appka toho člověka ještě
 * nezná — pak se nehlídá nic. Náhradní číslo, které se tváří jako
 * znalost, je horší než ticho.
 *
 * Strop je rovnou DOBRÝ DEN, bez přirážky: tolerance nad ním je v
 * `kapacitaDne.ts` a je to celý jeden úkol, takže se appka ozve teprve
 * na dni, kde je práce za dobrý den A JEŠTĚ VÍC NEŽ JEDEN úkol navíc.
 */
export function stropZPrutoku(prutok: Prutok | undefined): number | undefined {
  return prutok ? Math.max(1, prutok.dobryDen) : undefined
}

// ── Živý strop pro obrazovky ────────────────────────────────────────────
// Hook, ne výpočet v každé obrazovce zvlášť: Plán i Dnes musí soudit
// podle TÉHOŽ čísla. Kdyby si ho každá počítala po svém, byl by plný den
// na jedné jinde než na druhé — a přesně kvůli takovým rozporům strop
// vznikl.

/**
 * Osobní strop dne (v úkolech), živě z historie. Dokud dotaz nedoběhne
 * nebo je dat málo, je `undefined` a nic se nehlídá.
 *
 * Počítá se jen z MOJÍ práce: u sdíleného klienta odškrtává i kolega a
 * jeho hotové úkoly by mi průtok nafoukly.
 */
export function useOsobniStrop(): number | undefined {
  const dnes = todayISO()
  const od = toISODate(addDays(fromISODate(dnes), -OKNO_DNI))
  const ja = useJa()
  const hotove = useLiveQuery(() => hotoveOd(od), [od])
  return stropZPrutoku(osobniPrutok(mojeUkoly(hotove ?? [], ja), dnes))
}
