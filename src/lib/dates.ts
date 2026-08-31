// Denní data (dueDate, scheduledFor) jsou vždy lokální YYYY-MM-DD —
// nikdy nepoužívat toISOString(), to by kolem půlnoci uteklo do UTC.

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Přijímá i plný ISO datetime a bere z něj jen den. Dřív se řetězec dělil
// po pomlčkách, takže „2026-09-05T10:00:00.000Z" dalo den = NaN a z toho
// neplatné datum — a to pak při formátování shodilo celou obrazovku.
// Takový tvar se do denního pole dostane snadno: Todoist vrací u úkolů
// s časem `due.date` jako datetime, ne jako YYYY-MM-DD.
export function fromISODate(iso: string): Date {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Vytáhne z čehokoli denní řetězec YYYY-MM-DD, nebo undefined. */
export function toDayString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const den = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(den)) return undefined
  return Number.isNaN(fromISODate(den).getTime()) ? undefined : den
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
  // Popisek se nikdy nesmí stát důvodem pádu: Intl na neplatném datu
  // vyhodí výjimku („Invalid time value" v Chromu, „Date value is not
  // finite in DateTimeFormat" v Safari) a React na ni shodí celý strom.
  const d = fromISODate(iso)
  if (Number.isNaN(d.getTime())) return 'bez data'
  return dayFmt.format(d)
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
//
// Razítka (`lastActivityAt`, `updatedAt`) vyrábí `new Date().toISOString()`,
// takže nesou UTC. Uříznout je na deset znaků znamená vzít UTC den — a co
// se stalo po místní půlnoci, spadne na včerejšek: v létě (UTC+2) všechno
// mezi 00:00 a 02:00. Klient by pak vyšel o den zanedbanější, než je.
// Je to tatáž past, před kterou varuje pravidlo o toISOString(), jen
// obráceně, takže se instant nejdřív převede na MÍSTNÍ den.
export function daysSince(isoDatetime: string, todayRef: string = todayISO()): number {
  const den = isoDatetime.length <= 10 ? isoDatetime : toISODate(new Date(isoDatetime))
  const then = fromISODate(den)
  const today = fromISODate(todayRef)
  if (Number.isNaN(then.getTime()) || Number.isNaN(today.getTime())) return 0
  // Přes přechod na letní čas nevyjde rozdíl na celé dny (den má 23 nebo
  // 25 hodin), proto zaokrouhlení — hodinová odchylka se tím srovná.
  return Math.round((today.getTime() - then.getTime()) / 86400000)
}

// „dnes" / „včera" / „před 5 dny". Přes daysSince to vycházelo i na
// „před 0 dny", což u čerstvě založeného klienta znělo jako porucha.
export function formatDaysAgo(isoDatetime: string, todayRef: string = todayISO()): string {
  const n = daysSince(isoDatetime, todayRef)
  if (n <= 0) return 'dnes'
  if (n === 1) return 'včera'
  return `před ${n} dny`
}

const casFmt = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })

/** Je z toho řetězce použitelný čas? Prázdno, undefined ani nesmysl není. */
export const jePlatnyCas = (iso: unknown): iso is string =>
  typeof iso === 'string' && iso !== '' && !Number.isNaN(Date.parse(iso))

// Čas schůzky do řádku: „9:00–10:00", u celodenní „celý den".
//
// Formátuje se přes Intl, a `Intl.DateTimeFormat.format()` na neplatném
// datu VYHODÍ RangeError — na rozdíl od toLocaleDateString, které jen vrátí
// „Invalid Date". Bez téhle pojistky stačila jedna schůzka bez `start`
// (Google umí vrátit start jen s timeZone, a JSON pak klíč vypustí) a celý
// Plán zbělal: React bez error boundary shodí při chybě celý strom.
export function formatEventRange(e: {
  start?: string
  end?: string
  allDay?: boolean
}): string {
  if (e.allDay) return 'celý den'
  const od = jePlatnyCas(e.start) ? casFmt.format(new Date(e.start)) : null
  const doo = jePlatnyCas(e.end) ? casFmt.format(new Date(e.end)) : null
  if (od && doo) return `${od}–${doo}`
  if (od) return od
  return 'čas neznámý'
}
