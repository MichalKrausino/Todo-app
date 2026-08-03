// Denní data (dueDate, scheduledFor) jsou vždy lokální YYYY-MM-DD —
// nikdy nepoužívat toISOString(), to by kolem půlnoci uteklo do UTC.

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const todayISO = () => toISODate(new Date())

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function nextMonday(from: Date): Date {
  let delta = (1 - from.getDay() + 7) % 7
  if (delta === 0) delta = 7
  return addDays(from, delta)
}

const dayFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })
const fullFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })

export function formatDayLabel(iso: string): string {
  const today = todayISO()
  if (iso === today) return 'Dnes'
  if (iso === toISODate(addDays(fromISODate(today), 1))) return 'Zítra'
  if (iso === toISODate(addDays(fromISODate(today), -1))) return 'Včera'
  return dayFmt.format(fromISODate(iso))
}

export function formatFullDate(d: Date): string {
  return fullFmt.format(d)
}

// Pondělí týdne, do kterého daný den patří.
export function mondayOf(iso: string): string {
  const d = fromISODate(iso)
  const delta = (d.getDay() + 6) % 7 // Po=0 … Ne=6
  return toISODate(addDays(d, -delta))
}

// Celé dny od daného ISO datetime do dneška (lokálně, po dnech).
export function daysSince(isoDatetime: string, todayRef: string = todayISO()): number {
  const then = fromISODate(isoDatetime.slice(0, 10))
  const today = fromISODate(todayRef)
  return Math.round((today.getTime() - then.getTime()) / 86400000)
}
