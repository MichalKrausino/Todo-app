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
import { isOverloaded, plannedMinutes } from '../lib/capacity'
import { formatFullDate, fromISODate, todayISO } from '../lib/dates'
import { freeMinutes, minutesToLabel, type BusyInterval } from '../lib/freeSlot'
import { computeSignals } from '../lib/signals'
import { ShutdownSheet } from '../components/ShutdownSheet'
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
  // Batching podle klienta: přepínání kontextu žere výkon — filtr drží
  // jednoho klienta v kuse. Jen lokální stav, nikam se neukládá.
  const [batchClient, setBatchClient] = useState<string | null>(null)
  // Večerní uzávěrka (shutdown ritual) — uzavření dne se pamatuje do půlnoci.
  const [shutdownOpen, setShutdownOpen] = useState(false)
  const [dayClosed, setDayClosed] = useState(
    () => localStorage.getItem('todo.dayClosed') === todayISO(),
  )

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

  // Kapacita dne: tichý součet odhadů vs. volno v kalendáři (když je).
  const unfinished = [...overdue, ...todays]
  const busy: BusyInterval[] = events
    .filter((e) => !e.allDay)
    .map((e) => {
      const s = new Date(e.start)
      const en = new Date(e.end)
      return { startMin: s.getHours() * 60 + s.getMinutes(), endMin: en.getHours() * 60 + en.getMinutes() }
    })
  const freeMin = events.length > 0 ? freeMinutes(busy) : null
  const workMin = plannedMinutes(unfinished)
  const overloaded = unfinished.length > 0 && isOverloaded(workMin, freeMin)

  // Batching: klienti dnešních úkolů (chipy se ukážou od dvou různých)
  const batchClients = [
    ...new Map(
      unfinished
        .filter((t) => t.clientId && clientMap.has(t.clientId))
        .map((t) => [t.clientId!, clientMap.get(t.clientId!)!]),
    ).values(),
  ]
  const byBatch = (t: Task) => !batchClient || t.clientId === batchClient
  const visOverdue = overdue.filter(byBatch)
  const visTodays = todays.filter(byBatch)

  const isEvening = new Date().getHours() >= 16
  const closeDay = () => {
    localStorage.setItem('todo.dayClosed', today)
    setDayClosed(true)
  }

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
        {unfinished.length > 0 && (
          <p className={`mt-2 text-xs ${overloaded ? 'font-medium text-note-ink' : 'text-ink-soft'}`}>
            práce ~{minutesToLabel(workMin)}
            {freeMin !== null && <> · volno ~{minutesToLabel(freeMin)}</>}
            {overloaded && ' · den je přeplněný — zvaž něco na zítra'}
          </p>
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
        return (
          <section className="rise" style={stagger(2)}>
            <h2 className="section-label mb-2">
              kalendář · volno ~{minutesToLabel(freeMin ?? 0)}
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

      {/* Večerní uzávěrka: od 16:00, dokud zbývá nedokončené a den není zavřený */}
      {isEvening && !dayClosed && unfinished.length > 0 && (
        <button
          onClick={() => setShutdownOpen(true)}
          className="rise flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3 text-left shadow-card transition-[background-color,transform] duration-150 active:scale-[0.99] active:bg-well/60"
          style={stagger(3)}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Uzávěrka dne</span>
            <span className="text-[13px] text-ink-soft">
              {unfinished.length}{' '}
              {unfinished.length === 1 ? 'nedokončený úkol' : unfinished.length < 5 ? 'nedokončené úkoly' : 'nedokončených úkolů'}{' '}
              — zavři den s čistou hlavou
            </span>
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      )}
      {isEvening && dayClosed && (
        <p className="rise px-1 text-sm font-medium text-moss">✓ Den uzavřen — večer je tvůj.</p>
      )}

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

      {/* Batching podle klienta — jeden klient v kuse, méně přepínání kontextu */}
      {batchClients.length >= 2 && (
        <div className="rise -mx-1 flex gap-1.5 overflow-x-auto px-1" style={{ scrollbarWidth: 'none' }}>
          <button
            onClick={() => setBatchClient(null)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-transform duration-150 active:scale-95 ${
              batchClient === null ? 'bg-ink text-paper' : 'bg-well text-ink-soft'
            }`}
          >
            Vše
          </button>
          {batchClients.map((c) => (
            <button
              key={c.id}
              onClick={() => setBatchClient(batchClient === c.id ? null : c.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-transform duration-150 active:scale-95 ${
                batchClient === c.id ? 'bg-ink text-paper' : 'bg-well text-ink-soft'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
        </div>
      )}

      {visOverdue.length > 0 && (
        <section className="rise" style={stagger(5)}>
          <h2 className="section-label mb-2 !text-danger">po termínu · {visOverdue.length}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">{visOverdue.map(row)}</ul>
        </section>
      )}

      <section className="rise" style={stagger(6)}>
        {visOverdue.length > 0 && visTodays.length > 0 && <h2 className="section-label mb-2">dnes</h2>}
        {visTodays.length > 0 ? (
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">{visTodays.map(row)}</ul>
        ) : batchClient ? (
          visOverdue.length === 0 && (
            <p className="rounded-2xl bg-card px-4 py-4 text-center text-sm text-ink-soft shadow-card">
              U tohohle klienta dnes nic nezbývá.
            </p>
          )
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

      {/* Tichý odkaz na inbox — úkoly bez termínu nejsou na Dnes vidět
          a bez téhle stopy vypadají jako ztracené. */}
      {(() => {
        const inboxCount = open.filter((t) => !effectiveDate(t)).length
        if (inboxCount === 0) return null
        return (
          <button
            onClick={onOpenInbox}
            className="rise flex w-full items-center gap-2 px-1 py-1 text-left text-sm text-ink-soft transition-transform duration-150 active:scale-[0.99]"
            style={stagger(8)}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 13.5l2.5-7A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5l2.5 7V17a2 2 0 01-2 2H6a2 2 0 01-2-2zM4 13.5h4.5a3.5 3.5 0 007 0H20" />
            </svg>
            <span className="min-w-0 flex-1">
              V inboxu {inboxCount === 1 ? 'čeká 1 úkol' : inboxCount < 5 ? `čekají ${inboxCount} úkoly` : `čeká ${inboxCount} úkolů`}{' '}
              bez termínu
            </span>
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        )
      })()}

      {reviewOpen && <WeeklyReviewSheet onClose={() => setReviewOpen(false)} />}
      {shutdownOpen && (
        <ShutdownSheet
          tasks={unfinished}
          onOpenTask={onOpenTask}
          onCloseDay={closeDay}
          onClose={() => setShutdownOpen(false)}
        />
      )}
    </div>
  )
}
