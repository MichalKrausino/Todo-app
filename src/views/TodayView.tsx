import { useLiveQuery } from 'dexie-react-hooks'
import type { Task } from '../db/types'
import { allClients, allProjects, completeTask, doneOn, openTasks, reopenTask, sortTasks } from '../db/repo'
import { formatFullDate, todayISO } from '../lib/dates'
import { TaskRow } from '../components/TaskRow'
import { neglectedDays } from './ClientsView'

// Nejbližší relevantní den úkolu — dřívější z „naplánováno“ a „termín“.
const effectiveDate = (t: Task): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

export function TodayView({ onOpenTask }: { onOpenTask: (t: Task) => void }) {
  const today = todayISO()
  const open = useLiveQuery(openTasks, []) ?? []
  const done = useLiveQuery(() => doneOn(today), [today]) ?? []
  const clients = useLiveQuery(allClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []

  const clientMap = new Map(clients.map((c) => [c.id, c]))
  const projectMap = new Map(projects.map((p) => [p.id, p]))

  const overdue = sortTasks(
    open.filter((t) => {
      const d = effectiveDate(t)
      return d !== undefined && d < today
    }),
  )
  const todays = sortTasks(open.filter((t) => effectiveDate(t) === today))

  const toggle = (t: Task) => {
    void (t.status === 'done' ? reopenTask(t.id) : completeTask(t.id))
  }

  const row = (t: Task) => (
    <TaskRow
      key={t.id}
      task={t}
      client={t.clientId ? clientMap.get(t.clientId) : undefined}
      project={t.projectId ? projectMap.get(t.projectId) : undefined}
      onToggle={toggle}
      onOpen={onOpenTask}
    />
  )

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Dnes</h1>
        <p className="text-sm text-slate-500 first-letter:uppercase">{formatFullDate(new Date())}</p>
      </header>

      {(() => {
        const neglected = clients
          .filter((c) => c.status === 'active')
          .map((c) => ({ c, days: neglectedDays(c) }))
          .filter((x): x is { c: (typeof clients)[0]; days: number } => x.days !== null)
          .sort((a, b) => b.days - a.days)
        if (neglected.length === 0) return null
        return (
          <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <span className="font-semibold">Dlouho se nic nedělo: </span>
            {neglected.map(({ c, days }, i) => (
              <span key={c.id}>
                {i > 0 && ', '}
                {c.name} ({days} dní)
              </span>
            ))}
          </div>
        )
      })()}

      {overdue.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600">
            Po termínu · {overdue.length}
          </h2>
          <ul className="space-y-2">{overdue.map(row)}</ul>
        </section>
      )}

      <section>
        {overdue.length > 0 && (
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Dnes</h2>
        )}
        {todays.length > 0 ? (
          <ul className="space-y-2">{todays.map(row)}</ul>
        ) : (
          overdue.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-sm text-slate-400">
              Na dnešek nic naplánovaného.
              <br />
              Přidej úkol polem dole ↓
            </div>
          )
        )}
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Hotovo · {done.length}
          </h2>
          <ul className="space-y-2">{done.map(row)}</ul>
        </section>
      )}
    </div>
  )
}
