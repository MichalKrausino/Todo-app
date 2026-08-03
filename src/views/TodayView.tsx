import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Task } from '../db/types'
import {
  addMeetingFollowUp,
  allClients,
  allProjects,
  calendarEventsOn,
  completeTask,
  decideDayPlanSuggestion,
  doneOn,
  getDayPlan,
  openTasks,
  reopenTask,
  sortTasks,
} from '../db/repo'
import { scheduleBlockForTask } from '../sync/calendar'
import { formatFullDate, fromISODate, todayISO } from '../lib/dates'
import { freeMinutes, minutesToLabel, type BusyInterval } from '../lib/freeSlot'
import { computeSignals } from '../lib/signals'
import { SignalsBlock } from '../components/SignalsBlock'
import { TaskRow } from '../components/TaskRow'
import { WeeklyReviewSheet } from '../components/WeeklyReviewSheet'

// Nejbližší relevantní den úkolu — dřívější z „naplánováno“ a „termín“.
const effectiveDate = (t: Task): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

// Kaskáda nástupu sekcí (proměnnou čte animace .rise v index.css).
const stagger = (i: number) => ({ '--stagger': i }) as React.CSSProperties

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
  const [reviewOpen, setReviewOpen] = useState(false)
  // Rozhodnuté ranní návrhy odplouvají do strany a řádek se složí —
  // zápis do DB až po animaci, aby liveQuery řádek neutrhl skokem.
  const [leavingSuggestions, setLeavingSuggestions] = useState<
    Record<string, 'accepted' | 'rejected'>
  >({})
  // Schůzky, ze kterých už v tomhle otevření vznikl follow-up (ukáže ✓).
  const [followedUp, setFollowedUp] = useState<Set<string>>(new Set())

  // Nedělní push (#review) vede rovnou do týdenního ohlédnutí.
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== '#review') return
      setReviewOpen(true)
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])
  // Ohlédnutí za týdnem se nabízí v neděli (plán: nedělní shrnutí) a v pondělí.
  const reviewDay = [0, 1].includes(fromISODate(today).getDay())
  const open = useLiveQuery(openTasks, []) ?? []
  const done = useLiveQuery(() => doneOn(today), [today]) ?? []
  const clients = useLiveQuery(allClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []
  const dayPlan = useLiveQuery(() => getDayPlan(today), [today])
  const events = useLiveQuery(() => calendarEventsOn(today), [today]) ?? []

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
  const allDone = planned > 0 && done.length === planned && overdue.length === 0

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
    <div className="space-y-5">
      <header className="rise">
        <h1 className="display text-[2.1rem] font-semibold leading-tight">Dnes</h1>
        <p className="text-sm text-ink-soft first-letter:uppercase">{formatFullDate(new Date())}</p>
        {planned > 0 && (
          <div className="mt-3 flex items-center gap-2.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-well">
              <div
                className={`relative h-full overflow-hidden rounded-full transition-[width,background-color] duration-700 ease-glide ${
                  allDone ? 'bg-moss' : 'bg-accent'
                }`}
                style={{ width: `${Math.round(progress * 100)}%` }}
              >
                {allDone && <span className="shimmer" />}
              </div>
            </div>
            <span className="text-xs font-medium text-ink-soft">
              <span key={done.length} className="pop-soft inline-block">
                {done.length}
              </span>{' '}
              z {planned}
            </span>
          </div>
        )}
      </header>

      {(() => {
        if (!dayPlan) return null
        const taskById = new Map(open.map((t) => [t.id, t]))
        const pending = dayPlan.suggestions.filter(
          (s) => s.decision === 'ignored' && taskById.has(s.taskId),
        )
        if (pending.length === 0) return null

        // Zápis rozhodnutí až po odplutí řádku (340 ms ≈ délka animace).
        const decide = (taskId: string, decision: 'accepted' | 'rejected') => {
          if (leavingSuggestions[taskId]) return
          setLeavingSuggestions((m) => ({ ...m, [taskId]: decision }))
          const task = taskById.get(taskId)!
          setTimeout(() => {
            void decideDayPlanSuggestion(dayPlan.id, taskId, decision)
            // přijatý návrh si zabere blok v kalendáři „Todo"
            if (decision === 'accepted') void scheduleBlockForTask({ ...task, scheduledFor: today })
          }, 340)
        }

        return (
          <section className="rise" style={stagger(1)}>
            <h2 className="section-label mb-2">ranní návrh · {pending.length}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
              {pending.map((s) => {
                const task = taskById.get(s.taskId)!
                const leaving = leavingSuggestions[s.taskId]
                return (
                  <li
                    key={s.taskId}
                    className={`row-collapse ${leaving ? `leave leave-${leaving}` : ''}`}
                  >
                    <div>
                      <div className="row-inner flex items-center gap-3 px-4 py-3">
                        <button className="min-w-0 flex-1 text-left" onClick={() => onOpenTask(task)}>
                          <div className="text-[16px] leading-snug">{task.title}</div>
                          <div className="mt-0.5 text-[13px] text-ink-soft">{s.reason}</div>
                        </button>
                        <button
                          aria-label="Zamítnout návrh"
                          onClick={() => decide(s.taskId, 'rejected')}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-well text-ink-soft transition-transform duration-150 active:scale-90"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                        <button
                          aria-label="Přijmout návrh"
                          onClick={() => decide(s.taskId, 'accepted')}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-card transition-transform duration-150 active:scale-90"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12.5l4.5 4.5L19 7.5" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })()}

      {(() => {
        if (events.length === 0) return null
        const timeFmt = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })
        const busy: BusyInterval[] = events
          .filter((e) => !e.allDay)
          .map((e) => {
            const s = new Date(e.start)
            const en = new Date(e.end)
            return { startMin: s.getHours() * 60 + s.getMinutes(), endMin: en.getHours() * 60 + en.getMinutes() }
          })
        const free = freeMinutes(busy)
        return (
          <section className="rise" style={stagger(2)}>
            <h2 className="section-label mb-2">
              kalendář · volno ~{minutesToLabel(free)}
            </h2>
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-24 shrink-0 text-[13px] tabular-nums text-ink-soft">
                    {e.allDay
                      ? 'celý den'
                      : `${timeFmt.format(new Date(e.start))}–${timeFmt.format(new Date(e.end))}`}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px]">{e.title}</span>
                  {e.isTodoBlock ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-accent" title="Blok z appky" />
                  ) : followedUp.has(e.id) ? (
                    <span className="pop shrink-0 text-[12px] font-medium text-moss">✓ úkol</span>
                  ) : (
                    <button
                      aria-label={`Vytvořit follow-up ke schůzce ${e.title}`}
                      title="Follow-up úkol ze schůzky"
                      onClick={() => {
                        void addMeetingFollowUp(e)
                        setFollowedUp((s) => new Set(s).add(e.id))
                      }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-well text-ink-soft transition-transform duration-150 active:scale-90"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 6v12M6 12h12" />
                      </svg>
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {events.some((e) => !e.isTodoBlock) && (
              <p className="mt-1.5 px-1 text-xs text-ink-faint">
                Plusko u schůzky založí úkol „Follow-up: …" na dnešek.
              </p>
            )}
          </section>
        )
      })()}

      {reviewDay && (
        <button
          onClick={() => setReviewOpen(true)}
          className="rise flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3 text-left shadow-card transition-[background-color,transform] duration-150 active:scale-[0.99] active:bg-well/60"
          style={stagger(3)}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5V13M10 19.5V8M16 19.5v-9M20.5 19.5H3.5" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Týdenní ohlédnutí</span>
            <span className="text-[13px] text-ink-soft">Jak šel týden a co čeká v tom dalším</span>
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      )}

      <SignalsBlock
        signals={computeSignals(clients, projects, [...open, ...done], today)}
        onOpenClient={onOpenClient}
        onOpenTask={onOpenTask}
        onOpenInbox={onOpenInbox}
      />

      {overdue.length > 0 && (
        <section className="rise" style={stagger(5)}>
          <h2 className="section-label mb-2 !text-danger">po termínu · {overdue.length}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">{overdue.map(row)}</ul>
        </section>
      )}

      <section className="rise" style={stagger(6)}>
        {overdue.length > 0 && todays.length > 0 && <h2 className="section-label mb-2">dnes</h2>}
        {todays.length > 0 ? (
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">{todays.map(row)}</ul>
        ) : (
          overdue.length === 0 && (
            <div className="rounded-2xl bg-card px-6 py-10 text-center shadow-card">
              <svg viewBox="0 0 48 48" className="breathe mx-auto h-12 w-12 text-accent/70" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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
        <section className="rise" style={stagger(7)}>
          <h2 className="section-label mb-2">hotovo · {done.length}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">{done.map(row)}</ul>
        </section>
      )}

      {reviewOpen && <WeeklyReviewSheet onClose={() => setReviewOpen(false)} />}
    </div>
  )
}
