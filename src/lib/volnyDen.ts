// Volnější den — kam odložit, když datum vybírá appka, ne člověk.
//
// Zásada: odložit znamená přesunout tam, kde je na to místo. „Za týden"
// je slepé — může to být den se čtyřmi schůzkami. Appka zná zátěž
// každého dne, takže vybere NEJBLIŽŠÍ PRACOVNÍ DEN S NEJMENŠÍ ZÁTĚŽÍ
// v daném okně; při shodě nejbližší. Víkend se přeskakuje — plánuje
// se práce, a prázdná sobota by vyhrála pokaždé.
//
// ZÁTĚŽ SE MĚŘÍ V ÚKOLECH, SCHŮZKY JSOU AŽ DRUHÉ KRITÉRIUM
//
// Dřív se sčítaly minuty: odhad úkolů plus délka schůzek. Jenže odhad
// času byl HÁDANÝ — razítkovala ho heuristika o osmi klíčových slovech,
// 53 % úkolů ho nemělo vůbec a tiše se za ně počítalo 60 min (ta
// heuristika je od té doby smazaná). V tom součtu měl navíc hádaný díl
// hlavní slovo: jediný úkol bez odhadu vážil přesně tolik co hodinová
// schůzka, dva takové víc než kterákoli schůzka v kalendáři. Ranking
// „volnějších dnů" tedy stál na čísle, které se s realitou neporovná.
//
// A hlavně: strop dne se od té doby počítá v ÚKOLECH (`prutok.ts`,
// `kapacitaDne.ts`). Kdyby se cíl odkladu vybíral v minutách, mohla by
// appka poslat úkol na den, který sama označuje jako přeplněný — čtyři
// krátké úkoly (4 × 30 min) vypadají v minutách líp než jeden dlouhý
// se schůzkou, ale strop překročí právě ty čtyři. Jedna appka, jedna
// míra plného dne.
//
// Schůzky se nezahazují, jen ustoupily na druhé místo: jejich délka je
// jediné MĚŘENÉ číslo, které tu je, takže rozhoduje při shodě počtu.
//
// Používá se u odpovědí, které mají zvolit datum samy: „Volnější den"
// v ranním návrhu (i pauza po druhém „dnes ne"), v triáži propadlých
// a „Jinam" u přeplněného dne v Plánu. Gesto „Zítra" a večerní uzávěrka
// zůstávají doslovné — tam je zítřek záměr, ne odhad.

import { useLiveQuery } from 'dexie-react-hooks'
import type { CalendarEvent, Task } from '../db/types'
import { calendarEventsBetween, openTasks } from '../db/repo'
import { addDays, fromISODate, toISODate, todayISO } from './dates'

const posun = (iso: string, n: number): string => toISODate(addDays(fromISODate(iso), n))

/** Pondělí až pátek. */
export const jePracovni = (iso: string): boolean => {
  const d = fromISODate(iso).getDay()
  return d >= 1 && d <= 5
}

const rozhodneDatum = (t: Task): string | undefined =>
  [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d)).sort()[0]

export interface Naloz {
  /** kolik otevřených úkolů na ten den leží — hlavní kritérium */
  ukoly: number
  /** minuty schůzek — měřené číslo, rozhoduje při shodě počtu */
  schuzky: number
}

/**
 * Zátěž po dnech: počet otevřených úkolů s datem v tom dni (propadlé se
 * počítají na `dnes`) a vedle toho minuty schůzek (vícedenní patří do
 * každého svého dne, celodenní se nepočítají — nemají délku).
 *
 * `dnes` je parametr, ne `todayISO()` uvnitř. Dokud si funkce brala
 * dnešek ze systémových hodin, nebyla čistá, i když tak byla vedená —
 * a test, který porovnával dnešek s pevným datem, fungoval přesně do
 * chvíle, než na to datum došla řada. Spadl v CI po půlnoci (255 místo
 * 210), aniž by se čehokoli dotkla změna, která běh spustila. Volající
 * dnešek stejně v ruce má.
 */
export function nalozPoDnech(
  tasks: Task[],
  events: CalendarEvent[],
  od: string,
  doDne: string,
  dnes: string,
): Map<string, Naloz> {
  const today = dnes
  const out = new Map<string, Naloz>()
  const zapis = (den: string, ukoly: number, schuzky: number) => {
    const n = out.get(den)
    if (n) {
      n.ukoly += ukoly
      n.schuzky += schuzky
    } else {
      out.set(den, { ukoly, schuzky })
    }
  }
  for (const t of tasks) {
    if (t.status !== 'active' && t.status !== 'inbox') continue
    const d = rozhodneDatum(t)
    if (!d) continue
    const den = d < today ? today : d
    if (den < od || den > doDne) continue
    zapis(den, 1, 0)
  }
  for (const e of events) {
    if (e.isTodoBlock || e.allDay) continue
    const delka = Math.max(0, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000))
    let d = e.startDay < od ? od : e.startDay
    const konec = (e.endDay ?? e.startDay) > doDne ? doDne : (e.endDay ?? e.startDay)
    let guard = 0
    while (d <= konec && guard++ < 90) {
      zapis(d, 0, delka)
      d = posun(d, 1)
    }
  }
  return out
}

/**
 * Nejbližší pracovní den s nejmenší zátěží v okně `dnu` dní od `od`
 * (včetně). Pořadí je lexikografické: napřed míň úkolů, při shodě míň
 * schůzek, při shodě obojího ten bližší. Když v okně žádný pracovní den
 * není, vrátí první pracovní den po něm — odložit se musí vždycky někam.
 */
export function volnejsiDen(naloz: Map<string, Naloz>, od: string, dnu: number): string {
  let nej: string | undefined
  let nejU = Infinity
  let nejS = Infinity
  for (let i = 0; i < dnu; i++) {
    const den = posun(od, i)
    if (!jePracovni(den)) continue
    const { ukoly, schuzky } = naloz.get(den) ?? { ukoly: 0, schuzky: 0 }
    if (ukoly < nejU || (ukoly === nejU && schuzky < nejS)) {
      nejU = ukoly
      nejS = schuzky
      nej = den
    }
  }
  if (nej) return nej
  let den = posun(od, dnu)
  while (!jePracovni(den)) den = posun(den, 1)
  return den
}

/** Zátěž po dnech pro následujících `dnu` dní (od dneška), živě z DB. */
export function useNaloz(dnu = 14): Map<string, Naloz> {
  const today = todayISO()
  const konec = posun(today, dnu)
  return (
    useLiveQuery(async () => {
      const [tasks, events] = await Promise.all([openTasks(), calendarEventsBetween(today, konec)])
      return nalozPoDnech(tasks, events, today, konec, today)
    }, [today, konec]) ?? new Map()
  )
}
