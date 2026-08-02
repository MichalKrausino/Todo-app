// Volná okna v pracovním dni (Fáze 3) — čisté funkce nad minutami dne.
// Stejnou logiku používá server (supabase/functions/calendar) při hledání
// místa pro blok; při změně udržovat obě kopie v souladu.

export interface BusyInterval {
  startMin: number // minuty od půlnoci
  endMin: number
}

export const WORK_START = 9 * 60
export const WORK_END = 17 * 60

// Sloučí překrývající se intervaly a seřadí je.
export function mergeBusy(busy: BusyInterval[]): BusyInterval[] {
  const sorted = [...busy]
    .filter((b) => b.endMin > b.startMin)
    .sort((a, b) => a.startMin - b.startMin)
  const merged: BusyInterval[] = []
  for (const b of sorted) {
    const last = merged[merged.length - 1]
    if (last && b.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, b.endMin)
    } else {
      merged.push({ ...b })
    }
  }
  return merged
}

// První volné okno dané délky v pracovní době; null když se nevejde.
export function findFreeSlot(
  busy: BusyInterval[],
  durationMin: number,
  dayStart = WORK_START,
  dayEnd = WORK_END,
): BusyInterval | null {
  let cursor = dayStart
  for (const b of mergeBusy(busy)) {
    if (b.endMin <= cursor) continue
    if (b.startMin - cursor >= durationMin) {
      return { startMin: cursor, endMin: cursor + durationMin }
    }
    cursor = Math.max(cursor, b.endMin)
  }
  if (dayEnd - cursor >= durationMin) {
    return { startMin: cursor, endMin: cursor + durationMin }
  }
  return null
}

// Kolik minut v pracovní době zbývá volných.
export function freeMinutes(
  busy: BusyInterval[],
  dayStart = WORK_START,
  dayEnd = WORK_END,
): number {
  let free = dayEnd - dayStart
  for (const b of mergeBusy(busy)) {
    const overlap = Math.min(b.endMin, dayEnd) - Math.max(b.startMin, dayStart)
    if (overlap > 0) free -= overlap
  }
  return Math.max(0, free)
}

export const minutesToLabel = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h},5 h`
}
