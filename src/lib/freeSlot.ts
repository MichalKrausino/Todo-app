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

// Volná okna v pracovní době — doplněk k obsazeným intervalům.
// Používá je časová osa na Dnes („volno 2 h" mezi schůzkami).
export function freeGaps(
  busy: BusyInterval[],
  dayStart = WORK_START,
  dayEnd = WORK_END,
): BusyInterval[] {
  const gaps: BusyInterval[] = []
  let cursor = dayStart
  for (const b of mergeBusy(busy)) {
    if (b.endMin <= dayStart || b.startMin >= dayEnd) continue
    if (b.startMin > cursor) gaps.push({ startMin: cursor, endMin: Math.min(b.startMin, dayEnd) })
    cursor = Math.max(cursor, b.endMin)
  }
  if (cursor < dayEnd) gaps.push({ startMin: cursor, endMin: dayEnd })
  return gaps.filter((g) => g.endMin > g.startMin)
}

// Doba jako člověk: „45 min", „2 h", „2,5 h", „2 h 15".
//
// Dřív tu bylo `m === 0 ? h h : h,5 h`, takže KAŽDÝ zbytek vyšel jako půl
// hodiny — 70 minut i 100 minut hlásilo „1,5 h". Nebyla to teoretická vada:
// odhady úkolů jsou 120/90/60/45/30 min, takže stačí jedna fakturace (45)
// v součtu a den spadne na čtvrthodinu; volno mezi schůzkami má minuty
// úplně libovolné. Půlky si notace nechává, protože „2,5 h" se čte líp než
// „2 h 30", ale čtvrthodiny se odteď říkají rovnou.
export const minutesToLabel = (min: number): string => {
  const total = Math.max(0, Math.round(min))
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const m = total % 60
  if (m === 0) return `${h} h`
  if (m === 30) return `${h},5 h`
  return `${h} h ${m} min`
}
