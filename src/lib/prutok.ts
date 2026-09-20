// Průtok — kolik práce projde tímhle člověkem za den doopravdy.
//
// PROČ TO VZNIKLO (a proč hned po stropu dne)
//
// Strop dne (`kapacitaDne.ts`) hlídá přeplněné dny proti délce pracovní
// doby, tedy osmi hodinám. To je poctivé číslo o hodinách, jenže o TÉHLE
// appce neříká nic: v ní nestojí celý den, ale jen práce, kterou si do ní
// člověk zapíše. Schůzky, telefonáty, hašení a všechno ostatní jsou mimo.
//
// Změřeno na sedmnácti dnech, ve kterých se něco dokončilo:
//
//   medián dne        120 min
//   průměr dne         97 min
//   NEJLEPŠÍ DEN      150 min
//
// Nominální strop byl tedy **víc než trojnásobek životního rekordu** —
// strážce, který se prakticky nemá jak ozvat. Na dvanácti dnech skutečného
// plánování by spustil jediný, a to ještě jen díky schůzkám. Čtvrtek se
// 495 minutami přitom nebyl „o kousek přes": byl to **trojnásobek
// nejlepšího dne, jaký kdy byl**.
//
// PROTO SE STROP POČÍTÁ Z VLASTNÍ HISTORIE
//
// Ne z mediánu: strop na obvyklém dni by se ozval skoro pokaždé a signál,
// který svítí pořád, přestane být signál (totéž pravidlo jako tolerance
// ve `kapacitaDne.ts`). Bere se **dobrý den** (`PERCENTIL`) a k němu
// **rezerva** — plánovat o něco víc, než je obvyklé, je zdravé; plánovat
// trojnásobek není plán, ale přání.
//
// DVĚ VĚCI, KTERÉ TOHLE ČÍSLO NEŘÍKÁ
//
// (1) Není to „kolik toho ten člověk nadělá" — je to, kolik projde APPKOU.
//     Kdo si zapisuje každou maličkost, bude mít průtok vyšší, a je to tak
//     správně: strop má hlídat právě tu evidenci, kterou appka vidí.
// (2) Stojí na odhadech (`estimateMinutes`), ne na měřeném čase. Appka čas
//     neměří a měřit nezačne — stopky v todo appce jsou práce navíc, kterou
//     nikdo nedělá. Obě strany rovnice ale používají TÝŽ odhad, takže se
//     případná chyba odhadu z porovnání „naplánováno vs. zvládnuto" krátí.

import { useLiveQuery } from 'dexie-react-hooks'
import type { Task } from '../db/types'
import { hotoveOd } from '../db/repo'
import { DEFAULT_TASK_MINUTES } from './capacity'
import { addDays, fromISODate, toISODate, todayISO } from './dates'
import { PLNY_DEN_MIN } from './pruhDne'
import { mojeUkoly } from './tymUkoly'
import { useJa } from './useTym'

/** Kolik dní zpátky se historie čte. */
export const OKNO_DNI = 30
/**
 * Kolik dní s hotovou prací musí být v okně, než se osobní strop vezme
 * vážně. Míň je anekdota, ne míra — a hlavně: nová appka nesmí novému
 * člověku hned nasadit strop spočítaný z jeho prvního odpoledne.
 */
export const MIN_DNU = 7
/** „Dobrý den" — ne obvyklý, viz hlavička. */
export const PERCENTIL = 0.8
/** Plánovat o něco víc než obvykle je zdravé. */
export const REZERVA = 1.5
/**
 * Pod tohle strop nikdy nespadne. Bez spodní hranice by týden dovolené
 * (pár krátkých úkolů) utáhl strop na půl hodiny a appka by pak namítala
 * proti každému druhému úkolu.
 */
export const MIN_STROP_MIN = 120

export interface Prutok {
  /** kolik dní s hotovou prací okno obsahuje */
  dnu: number
  /** medián minut za den — „obvyklý den" */
  median: number
  /** dobrý den (PERCENTIL) — z něj se počítá strop */
  dobryDen: number
  /** nejlepší den v okně */
  nejlepsi: number
}

const minutyUkolu = (t: Task): number => t.estimateMinutes ?? DEFAULT_TASK_MINUTES

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
 * Minuty hotové práce po dnech. Počítají se JEN dny, ve kterých se něco
 * dokončilo — den bez jediného odškrtnutí není den s nulovým průtokem,
 * ale nejspíš den, kdy se appka neotevřela (víkend, dovolená, schůzky
 * celý den). Kdyby se nuly počítaly, stáhly by strop k zemi za každý
 * volný týden.
 */
export function minutyHotovePoDnech(ukoly: Task[], od: string, doDne: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of ukoly) {
    if (t.deletedAt || t.status !== 'done') continue
    const den = (t.completedAt ?? '').slice(0, 10)
    if (den < od || den > doDne) continue
    out.set(den, (out.get(den) ?? 0) + minutyUkolu(t))
  }
  return out
}

/** Průtok z historie, nebo `undefined`, když je dat málo (viz `MIN_DNU`). */
export function osobniPrutok(ukoly: Task[], dnes: string, okno = OKNO_DNI): Prutok | undefined {
  const od = toISODate(addDays(fromISODate(dnes), -okno))
  const dny = [...minutyHotovePoDnech(ukoly, od, dnes).values()].sort((a, b) => a - b)
  if (dny.length < MIN_DNU) return undefined
  return {
    dnu: dny.length,
    median: Math.round(kvantil(dny, 0.5)),
    dobryDen: Math.round(kvantil(dny, PERCENTIL)),
    nejlepsi: dny[dny.length - 1],
  }
}

/**
 * Strop dne pro TOHOHLE člověka. Bez dostatečné historie platí pracovní
 * doba — dokud appka nic neví, nevymýšlí si.
 *
 * Strop nikdy nepřeleze pracovní dobu (víc než den se do dne nevejde,
 * ať je kdo chce jak výkonný) a nikdy nespadne pod `MIN_STROP_MIN`.
 */
export function stropZPrutoku(prutok: Prutok | undefined): number {
  if (!prutok) return PLNY_DEN_MIN
  const navrh = Math.round(prutok.dobryDen * REZERVA)
  return Math.min(PLNY_DEN_MIN, Math.max(MIN_STROP_MIN, navrh))
}

// ── Živý strop pro obrazovky ────────────────────────────────────────────
// Hook, ne výpočet v každé obrazovce zvlášť: Plán i Dnes musí kreslit
// přetečení proti TÉMUŽ číslu. Kdyby si ho každá počítala po svém, byl by
// na Dnes plný den jinde než v Plánu — přesně ten druh rozporu, kvůli
// kterému strop vznikl.


/**
 * Osobní strop dne v minutách, živě z historie. Dokud dotaz nedoběhne
 * (nebo je dat málo), platí pracovní doba — appka radši nenamítá nic,
 * než aby namítala podle čísla, které ještě nezná.
 *
 * Počítá se jen z MOJÍ práce: u sdíleného klienta odškrtává i kolega a
 * jeho hotové úkoly by mi průtok nafoukly.
 */
export function useOsobniStrop(): number {
  const dnes = todayISO()
  const od = toISODate(addDays(fromISODate(dnes), -OKNO_DNI))
  const ja = useJa()
  const hotove = useLiveQuery(() => hotoveOd(od), [od])
  return stropZPrutoku(osobniPrutok(mojeUkoly(hotove ?? [], ja), dnes))
}
