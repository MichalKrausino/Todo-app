import { useLiveQuery } from 'dexie-react-hooks'
import type { Task } from '../db/types'
import { allClients, allProjects, completeTask, openTasks, reopenTask, sortTasks } from '../db/repo'
import { formatDayLabel, todayISO } from '../lib/dates'
import { TaskRow } from '../components/TaskRow'

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
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Plán</h1>
        <p className="text-sm text-slate-500">Co je přede mnou</p>
      </header>

      {dates.length === 0 && inbox.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-sm text-slate-400">
          Zatím žádné naplánované úkoly.
        </div>
      )}

      {dates.map((d) => (
        <section key={d}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 first-letter:uppercase">
            {formatDayLabel(d)}
          </h2>
          <ul className="space-y-2">{sortTasks(groups.get(d)!).map((t) => row(t, false))}</ul>
        </section>
      ))}

      {inbox.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Bez termínu · {inbox.length}
          </h2>
          <ul className="space-y-2">{inbox.map((t) => row(t, true))}</ul>
        </section>
      )}
    </div>
  )
}
