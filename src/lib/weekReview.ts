// Týdenní zpětná vazba (Fáze 7) — čisté funkce nad daty.
// Shrnutí týdne: co se dokončilo a komu, nakolik vyšel plán, co se odkládá,
// u koho bylo ticho, a jak vypadá příštích 7 dní. Porovnání odhadu času
// a skutečnosti přibude s Fází 5 (estimateMinutes).

import type { Client, Task } from '../db/types'
import { addDays, fromISODate, mondayOf, toISODate } from './dates'

export interface WeekStats {
  weekStart: string // pondělí
  weekEnd: string // neděle
  completedCount: number
  /** dokončené úkoly podle klienta, sestupně; clientId undefined = bez klienta */
  completedByClient: Array<{ client: Client | undefined; count: number }>
  /** úkoly s termínem/plánem v týdnu (mimo zahozené) */
  plannedCount: number
  /** z nich skutečně dokončené */
  plannedDoneCount: number
  /** otevřené úkoly s nejvyšším počtem odkladů (aspoň 2), max 3 */
  mostPostponed: Task[]
  /** aktivní klienti (kind=client), u kterých se v týdnu nic nedokončilo */
  quietClients: Client[]
  /** počet otevřených úkolů na příštích 7 dní, den po dni */
  nextDays: Array<{ date: string; count: number }>
}

const effectiveDate = (t: Task): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

// V pondělí se ohlížíme za celým minulým týdnem, jinak za tím právě běžícím.
export function reviewWeekStart(today: string): string {
  const isMonday = fromISODate(today).getDay() === 1
  return mondayOf(isMonday ? toISODate(addDays(fromISODate(today), -1)) : today)
}

export function computeWeekStats(clients: Client[], tasks: Task[], today: string): WeekStats {
  const weekStart = reviewWeekStart(today)
  const weekEnd = toISODate(addDays(fromISODate(weekStart), 6))
  const live = tasks.filter((t) => !t.deletedAt)

  const completed = live.filter((t) => {
    const day = t.completedAt?.slice(0, 10)
    return t.status === 'done' && day && day >= weekStart && day <= weekEnd
  })

  const byClient = new Map<string | undefined, number>()
  for (const t of completed) {
    byClient.set(t.clientId, (byClient.get(t.clientId) ?? 0) + 1)
  }
  const clientById = new Map(clients.map((c) => [c.id, c]))
  const completedByClient = [...byClient.entries()]
    .map(([clientId, count]) => ({ client: clientId ? clientById.get(clientId) : undefined, count }))
    .sort((a, b) => b.count - a.count)

  const planned = live.filter((t) => {
    if (t.status === 'dropped') return false
    const d = effectiveDate(t)
    return d !== undefined && d >= weekStart && d <= weekEnd
  })
  const plannedDone = planned.filter((t) => t.status === 'done')

  const mostPostponed = live
    .filter((t) => (t.status === 'inbox' || t.status === 'active') && (t.postponeCount ?? 0) >= 2)
    .sort((a, b) => (b.postponeCount ?? 0) - (a.postponeCount ?? 0))
    .slice(0, 3)

  const completedClientIds = new Set(completed.map((t) => t.clientId).filter(Boolean))
  const quietClients = clients.filter(
    (c) =>
      !c.deletedAt &&
      c.status === 'active' &&
      c.kind === 'client' &&
      c.createdAt.slice(0, 10) < weekStart &&
      !completedClientIds.has(c.id),
  )

  const open = live.filter((t) => t.status === 'inbox' || t.status === 'active')
  const nextDays: Array<{ date: string; count: number }> = []
  for (let i = 1; i <= 7; i++) {
    const date = toISODate(addDays(fromISODate(today), i))
    nextDays.push({ date, count: open.filter((t) => effectiveDate(t) === date).length })
  }

  return {
    weekStart,
    weekEnd,
    completedCount: completed.length,
    completedByClient,
    plannedCount: planned.length,
    plannedDoneCount: plannedDone.length,
    mostPostponed,
    quietClients,
    nextDays,
  }
}
