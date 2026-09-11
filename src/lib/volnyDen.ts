// Volnější den — kam odložit, když datum vybírá appka, ne člověk.
//
// Zásada: odložit znamená přesunout tam, kde je na to místo. „Za týden"
// je slepé — může to být den se čtyřmi schůzkami. Appka zná zátěž
// každého dne (odhad úkolů + délka schůzek, totéž co kreslí pruh
// v Plánu), takže vybere NEJBLIŽŠÍ PRACOVNÍ DEN S NEJMENŠÍ ZÁTĚŽÍ
// v daném okně; při shodě nejbližší. Víkend se přeskakuje — plánuje
// se práce, a prázdná sobota by vyhrála pokaždé.
//
// Používá se u odpovědí, které mají zvolit datum samy: „Volnější den"
// v ranním návrhu (i pauza po druhém „dnes ne") a v triáži propadlých.
// Gesto „Zítra" a večerní uzávěrka zůstávají doslovné — tam je zítřek
// záměr, ne odhad.

import { useLiveQuery } from 'dexie-react-hooks'
import type { CalendarEvent, Task } from '../db/types'
import { calendarEventsBetween, openTasks } from '../db/repo'
import { plannedMinutes } from './capacity'
import { addDays, fromISODate, toISODate, todayISO } from './dates'

const posun = (iso: string, n: number): string => toISODate(addDays(fromISODate(iso), n))

/** Pondělí až pátek. */
export const jePracovni = (iso: string): boolean => {
  const d = fromISODate(iso).getDay()
  return d >= 1 && d <= 5
}

const rozhodneDatum = (t: Task): string | undefined =>
  [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d)).sort()[0]

/**
 * Zátěž po dnech v minutách: odhad otevřených úkolů s datem v tom dni
 * (propadlé se počítají na dnešek) + délka schůzek (vícedenní patří do
 * každého svého dne, celodenní se nepočítají — nemají délku).
 * Stejná logika jako pruh v Plánu.
 */
export function minutyPoDnech(tasks: Task[], events: CalendarEvent[], od: string, doDne: string): Map<string, number> {
  const today = todayISO()
  const out = new Map<string, number>()
  for (const t of tasks) {
    if (t.status !== 'active' && t.status !== 'inbox') continue
    const d = rozhodneDatum(t)
    if (!d) continue
    const den = d < today ? today : d
    if (den < od || den > doDne) continue
    out.set(den, (out.get(den) ?? 0) + plannedMinutes([t]))
  }
  for (const e of events) {
    if (e.isTodoBlock || e.allDay) continue
    const delka = Math.max(0, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000))
    let d = e.startDay < od ? od : e.startDay
    const konec = (e.endDay ?? e.startDay) > doDne ? doDne : (e.endDay ?? e.startDay)
    let guard = 0
    while (d <= konec && guard++ < 90) {
      out.set(d, (out.get(d) ?? 0) + delka)
      d = posun(d, 1)
    }
  }
  return out
}

/**
 * Nejbližší pracovní den s nejmenší zátěží v okně `dnu` dní od `od`
 * (včetně). Když v okně žádný pracovní den není, vrátí první pracovní
 * den po něm — odložit se musí vždycky někam.
 */
export function volnejsiDen(naloz: Map<string, number>, od: string, dnu: number): string {
  let nej: string | undefined
  let nejMin = Infinity
  for (let i = 0; i < dnu; i++) {
    const den = posun(od, i)
    if (!jePracovni(den)) continue
    const m = naloz.get(den) ?? 0
    if (m < nejMin) {
      nejMin = m
      nej = den
    }
  }
  if (nej) return nej
  let den = posun(od, dnu)
  while (!jePracovni(den)) den = posun(den, 1)
  return den
}

/** Zátěž po dnech pro následujících `dnu` dní (od dneška), živě z DB. */
export function useNaloz(dnu = 14): Map<string, number> {
  const today = todayISO()
  const konec = posun(today, dnu)
  return (
    useLiveQuery(async () => {
      const [tasks, events] = await Promise.all([openTasks(), calendarEventsBetween(today, konec)])
      return minutyPoDnech(tasks, events, today, konec)
    }, [today, konec]) ?? new Map()
  )
}
