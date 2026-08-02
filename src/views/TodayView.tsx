import { useLiveQuery } from 'dexie-react-hooks'
import type { Task } from '../db/types'
import { allClients, allProjects, completeTask, doneOn, openTasks, reopenTask, sortTasks } from '../db/repo'
import { formatFullDate, todayISO } from '../lib/dates'
import { computeSignals } from '../lib/signals'
import { SignalsBlock } from '../components/SignalsBlock'
import { TaskRow } from '../components/TaskRow'

// Nejbližší relevantní den úkolu — dřívější z „naplánováno“ a „termín“.
const effectiveDate = (t: Task): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

export function TodayView({
  onOpenTask,
  onOpenClient,
  onOpenInbox,
}: {
  onOpenTask: (t: Task) => void
  onOpenClient: (id: string) => void
  onOpenInbox: () => void
}) {
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

  const planned = todays.length + done.length
  const progress = planned > 0 ? done.length / planned : 0

  const toggle = (t: Task) => {
    void (t.status === 'done' ? reopenTask(t.id) : completeTask(t.id))
  }

  const row = (t: Task, i: number) => (
    <TaskRow
      key={t.id}
      task={t}
      index={i}
      client={t.clientId ? clientMap.get(t.clientId) : undefined}
      project={t.projectId ? projectMap.get(t.projectId) : undefined}
      onToggle={toggle}
      onOpen={onOpenTask}
    />
  )

  return (
    <div className="space-y-5">
      <header className="rise">
        <h1 className="display text-[2.1rem] font-semibold leading-tight">Dnes</h1>
        <p className="text-sm text-ink-soft first-letter:uppercase">{formatFullDate(new Date())}</p>
        {planned > 0 && (
          <div className="mt-3 flex items-center gap-2.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-well">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <span className="text-xs font-medium text-ink-soft">
              {done.length} z {planned}
            </span>
          </div>
        )}
      </header>

      <SignalsBlock
        signals={computeSignals(clients, projects, [...open, ...done], today)}
        onOpenClient={onOpenClient}
        onOpenTask={onOpenTask}
        onOpenInbox={onOpenInbox}
      />

      {overdue.length > 0 && (
        <section>
          <h2 className="section-label mb-2 !text-danger">po termínu · {overdue.length}</h2>
          <ul className="space-y-2">{overdue.map(row)}</ul>
        </section>
      )}

      <section>
        {overdue.length > 0 && todays.length > 0 && <h2 className="section-label mb-2">dnes</h2>}
        {todays.length > 0 ? (
          <ul className="space-y-2">{todays.map(row)}</ul>
        ) : (
          overdue.length === 0 && (
            <div className="rise rounded-2xl bg-card px-6 py-10 text-center shadow-card">
              <svg viewBox="0 0 48 48" className="mx-auto h-12 w-12 text-accent/70" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="24" cy="24" r="15" />
                <path d="M24 4v5M24 39v5M4 24h5M39 24h5M9.9 9.9l3.5 3.5M34.6 34.6l3.5 3.5M9.9 38.1l3.5-3.5M34.6 13.4l3.5-3.5" />
              </svg>
              <p className="display mt-3 text-lg font-medium">Čistý stůl</p>
              <p className="mt-1 text-sm text-ink-soft">
                Na dnešek nic neplánuješ. Přidej úkol polem dole,
                <br />
                nebo si užij klid.
              </p>
            </div>
          )
        )}
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="section-label mb-2">hotovo · {done.length}</h2>
          <ul className="space-y-2">{done.map(row)}</ul>
        </section>
      )}
    </div>
  )
}
