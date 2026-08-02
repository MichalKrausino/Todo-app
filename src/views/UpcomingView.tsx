import { useLiveQuery } from 'dexie-react-hooks'
import type { Task } from '../db/types'
import {
  allClients,
  allProjects,
  calendarEventsBetween,
  completeTask,
  openTasks,
  reopenTask,
  sortTasks,
} from '../db/repo'
import { addDays, formatDayLabel, fromISODate, toISODate, todayISO } from '../lib/dates'
import { TaskRow } from '../components/TaskRow'

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n < 5 ? few : many

const effectiveDate = (t: Task): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

export function UpcomingView({ onOpenTask }: { onOpenTask: (t: Task) => void }) {
  const today = todayISO()
  const open = useLiveQuery(openTasks, []) ?? []
  const clients = useLiveQuery(allClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []

  const clientMap = new Map(clients.map((c) => [c.id, c]))
  const projectMap = new Map(projects.map((p) => [p.id, p]))

  const groups = new Map<string, Task[]>()
  for (const t of open) {
    const d = effectiveDate(t)
    if (!d || d <= today) continue
    const list = groups.get(d) ?? []
    list.push(t)
    groups.set(d, list)
  }
  const dates = [...groups.keys()].sort()
  const inbox = sortTasks(open.filter((t) => !effectiveDate(t)))

  const horizon = toISODate(addDays(fromISODate(today), 30))
  const events = useLiveQuery(() => calendarEventsBetween(today, horizon), [today, horizon]) ?? []
  const meetingsPerDay = new Map<string, number>()
  for (const e of events) {
    if (e.isTodoBlock) continue
    meetingsPerDay.set(e.startDay, (meetingsPerDay.get(e.startDay) ?? 0) + 1)
  }

  const toggle = (t: Task) => {
    void (t.status === 'done' ? reopenTask(t.id) : completeTask(t.id))
  }

  const row = (t: Task, showDate: boolean) => (
    <TaskRow
      key={t.id}
      task={t}
      client={t.clientId ? clientMap.get(t.clientId) : undefined}
      project={t.projectId ? projectMap.get(t.projectId) : undefined}
      onToggle={toggle}
      onOpen={onOpenTask}
      showDate={showDate}
    />
  )

  return (
    <div className="space-y-5">
      <header className="rise">
        <h1 className="display text-[2.1rem] font-semibold leading-tight">Plán</h1>
        <p className="text-sm text-ink-soft">Co je přede mnou</p>
      </header>

      {dates.length === 0 && inbox.length === 0 && (
        <div className="rise rounded-2xl bg-card px-6 py-10 text-center shadow-card">
          <svg viewBox="0 0 48 48" className="mx-auto h-12 w-12 text-accent/70" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="7" y="10" width="34" height="31" rx="4" />
            <path d="M7 19h34M16 6v8M32 6v8M16 27h8M16 33h12" />
          </svg>
          <p className="display mt-3 text-lg font-medium">Volný výhled</p>
          <p className="mt-1 text-sm text-ink-soft">Zatím žádné naplánované úkoly.</p>
        </div>
      )}

      {dates.map((d, i) => (
        <section key={d} className="rise" style={{ '--stagger': Math.min(i + 1, 8) } as React.CSSProperties}>
          <h2 className="section-label mb-2 first-letter:lowercase">
            {formatDayLabel(d)}
            {(meetingsPerDay.get(d) ?? 0) > 0 &&
              ` · ${meetingsPerDay.get(d)} ${plural(meetingsPerDay.get(d)!, 'schůzka', 'schůzky', 'schůzek')}`}
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
            {sortTasks(groups.get(d)!).map((t) => row(t, false))}
          </ul>
        </section>
      ))}

      {inbox.length > 0 && (
        <section className="rise" style={{ '--stagger': Math.min(dates.length + 1, 9) } as React.CSSProperties}>
          <h2 className="section-label mb-2">bez termínu · {inbox.length}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">{inbox.map((t) => row(t, true))}</ul>
        </section>
      )}
    </div>
  )
}
