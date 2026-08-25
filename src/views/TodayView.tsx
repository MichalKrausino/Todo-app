import { Fragment, useEffect, useState } from 'react'
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
import { WORK_END, WORK_START, freeGaps, freeMinutes, minutesToLabel, type BusyInterval } from '../lib/freeSlot'
import { computeSignals } from '../lib/signals'
import { HelpSheet } from '../components/HelpSheet'
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

const minutesOfDay = (iso: string) => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

// „za 25 min" / „za 1 h 20" — odpočet do nejbližší schůzky.
const untilLabel = (min: number): string => {
  if (min < 60) return `za ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `za ${h} h` : `za ${h} h ${m} min`
}

// Kolikátý den vícedenní události dnes je („2. den ze 4").
const dayIndex = (startDay: string, endDay: string, today: string) => {
  const day = 86_400_000
  const from = fromISODate(startDay).getTime()
  const to = fromISODate(endDay).getTime()
  const now = fromISODate(today).getTime()
  const total = Math.round((to - from) / day) + 1
  return { index: Math.round((now - from) / day) + 1, total }
}

// Příklady do prázdného stavu — každý ukazuje jinou schopnost parseru.
const EXAMPLES = [
  'zítra poslat report',
  'v pátek fakturace !!',
  'zavolat Pepovi do 14:00',
]

// Kolik schůzek se ukáže, než se seznam sbalí.
const EVENTS_PREVIEW = 4
// Kratší okno než půl hodiny nemá cenu nabízet jako volný slot.
const MIN_GAP_MIN = 30

// Pevně rozmístěné tečky oslavy splněného dne (žádná runtime náhoda —
// deterministické, jen se přehrají při přepnutí allDone).
const CONFETTI = [
  { left: '12%', cx: '-14px', cy: '-30px', color: 'var(--color-accent)' },
  { left: '28%', cx: '10px', cy: '-38px', color: 'var(--color-moss)' },
  { left: '44%', cx: '-8px', cy: '-26px', color: 'var(--color-note-ink)' },
  { left: '58%', cx: '14px', cy: '-34px', color: 'var(--color-accent)' },
  { left: '72%', cx: '-12px', cy: '-40px', color: 'var(--color-moss)' },
  { left: '86%', cx: '8px', cy: '-28px', color: 'var(--color-accent-deep)' },
]

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
  const [helpOpen, setHelpOpen] = useState(false)
  // Jednorázový tip na swipe gesta — jinak je nikdo neobjeví. Zmizí
  // navždy po zavření nebo po prvním použití gesta.
  const [gestureTip, setGestureTip] = useState(
    () => localStorage.getItem('todo.gestureTipSeen') !== '1',
  )
  const dismissTip = () => {
    localStorage.setItem('todo.gestureTipSeen', '1')
    setGestureTip(false)
  }
  const [dayClosed, setDayClosed] = useState(
    () => localStorage.getItem('todo.dayClosed') === todayISO(),
  )
  // Rozbalený seznam schůzek (jinak se ukáže jen prvních pár).
  const [allEvents, setAllEvents] = useState(false)
  // Živý čas — časová osa dne musí stárnout sama od sebe. Minutová
  // kadence stačí; při návratu do popředí se dorovná okamžitě.
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  })
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setNowMin(d.getHours() * 60 + d.getMinutes())
    }
    const id = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  // Deep-linky z notifikací: #review otevře týdenní ohlédnutí,
  // #shutdown podvečerní uzávěrku dne.
  useEffect(() => {
    const check = () => {
      const hash = window.location.hash
      if (hash !== '#review' && hash !== '#shutdown') return
      if (hash === '#review') setReviewOpen(true)
      else setShutdownOpen(true)
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
  // Volno se počítá od TEĎ do konce pracovní doby — ve dvě odpoledne
  // nemá smysl hlásit celodenních osm hodin. Po pracovní době je nula.
  const restStart = Math.min(Math.max(nowMin, WORK_START), WORK_END)
  const freeMin = events.length > 0 ? freeMinutes(busy, restStart) : null
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
  // „Top 3 dne" — připíchnuté úkoly stojí nahoře ve vlastní sekci a
  // z ostatních seznamů zmizí, ať se nezdvojují.
  const isPinned = (t: Task) => t.pinnedFor === today
  const pinned = sortTasks(unfinished.filter(isPinned)).filter(byBatch)
  const visOverdue = overdue.filter((t) => !isPinned(t)).filter(byBatch)
  const visTodays = todays.filter((t) => !isPinned(t)).filter(byBatch)

  const isEvening = new Date().getHours() >= 16
  const closeDay = () => {
    localStorage.setItem('todo.dayClosed', today)
    setDayClosed(true)
  }

  const toggle = (t: Task) => {
    void (t.status === 'done' ? reopenTask(t.id) : completeTask(t.id))
  }

  // V sekci „dnes" je štítek data redundantní — skrývá se (showDate).
  // V sekci „na čem záleží" je zase redundantní špendlík (showPin).
  const row = (t: Task, showDate = true, showPin = true) => (
    <TaskRow
      key={t.id}
      task={t}
      client={t.clientId ? clientMap.get(t.clientId) : undefined}
      project={t.projectId ? projectMap.get(t.projectId) : undefined}
      onToggle={toggle}
      onOpen={onOpenTask}
      showDate={showDate}
      showPin={showPin}
    />
  )

  return (
    <div className="space-y-6">
      <header className="rise">
        <h1 className="display text-[2.1rem] font-semibold leading-tight">Dnes</h1>
        <p className="text-sm text-ink-soft first-letter:uppercase">{formatFullDate(new Date())}</p>
        {planned > 0 && (
          <div className="relative mt-3 flex items-center gap-2.5">
            {/* tichá oslava: pár teček vyletí, když je den splněný */}
            {allDone &&
              CONFETTI.map((c, i) => (
                <span
                  key={i}
                  className="confetti"
                  style={{ left: c.left, background: c.color, '--cx': c.cx, '--cy': c.cy, '--stagger': i } as React.CSSProperties}
                />
              ))}
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-well">
              <div
                className={`relative h-full overflow-hidden rounded-full transition-[width,background-color] duration-700 ease-glide ${
                  allDone ? 'bg-moss' : 'progress-fill'
                }`}
                style={{ width: `${Math.round(progress * 100)}%` }}
              >
                {allDone && <span className="shimmer" />}
                {!allDone && done.length > 0 && <span key={done.length} className="bar-pulse" />}
              </div>
            </div>
            <span className="text-xs font-medium text-ink-soft">
              <span key={done.length} className="roll-in">
                {done.length}
              </span>{' '}
              z {planned}
            </span>
          </div>
        )}
        {unfinished.length > 0 && (
          <>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft">
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${overloaded ? 'bg-note-ink' : 'bg-moss'}`}
              />
              práce ~{minutesToLabel(workMin)}
              {/* stejné slovo jako v hlavičce kalendáře — jde o totéž číslo */}
              {freeMin !== null && <> · zbývá ~{minutesToLabel(freeMin)}</>}
            </p>
            {/* varování na vlastním řádku — v jedné větě se lámalo přes
                dva řádky a ztrácelo důraz */}
            {overloaded && (
              <p className="pop-soft mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-note px-2.5 py-1 text-xs font-medium text-note-ink">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8v5M12 16.5v.5" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                Den je přeplněný — zvaž něco na zítra
              </p>
            )}
          </>
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
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
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

        // Úkol stojící za blokem z appky — ať se na blok dá ťuknout.
        const taskByEvent = new Map(
          [...open, ...done]
            .filter((t) => t.calendarEventId)
            .map((t) => [t.calendarEventId!, t]),
        )

        // Volná okna zbývající do konce pracovní doby. Ta, co už uplynula,
        // by jen zabírala místo — proto se počítají od teď.
        const gaps = freeGaps(busy, restStart).filter(
          (g) => g.endMin - g.startMin >= MIN_GAP_MIN && g.endMin > nowMin,
        )

        // Nejbližší budoucí schůzka — jen u ní se ukáže odpočet.
        const nextStart = events
          .filter((e) => !e.allDay)
          .map((e) => minutesOfDay(e.start))
          .filter((m) => m > nowMin)
          .sort((a, b) => a - b)[0]

        const shown = allEvents ? events : events.slice(0, EVENTS_PREVIEW)
        const hidden = events.length - shown.length
        // Dvě schůzky ve stejnou minutu by jinak vykreslily tentýž
        // řádek volna dvakrát — každé okno se ukáže nejvýš jednou.
        const usedGaps = new Set<number>()

        return (
          <section className="rise" style={stagger(2)}>
            <h2 className="section-label mb-2">
              {/* po pracovní době už „volno" nedává smysl */}
              kalendář{freeMin !== null && restStart < WORK_END && ` · zbývá ~${minutesToLabel(freeMin)}`}
            </h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
              {shown.map((e) => {
                const startMin = e.allDay ? 0 : minutesOfDay(e.start)
                const endMin = e.allDay ? 24 * 60 : minutesOfDay(e.end)
                const past = !e.allDay && endMin <= nowMin
                const running = !e.allDay && startMin <= nowMin && nowMin < endMin
                const isNext = !e.allDay && startMin === nextStart
                const task = e.isTodoBlock ? taskByEvent.get(e.eventId) : undefined
                const span = e.startDay !== e.endDay ? dayIndex(e.startDay, e.endDay, today) : null
                // volné okno, které končí přesně tam, kde schůzka začíná
                const gapBefore = e.allDay
                  ? undefined
                  : gaps.find((g) => g.endMin === startMin && !usedGaps.has(g.startMin))
                if (gapBefore) usedGaps.add(gapBefore.startMin)

                return (
                  <Fragment key={e.id}>
                    {gapBefore && (
                      <li className="flex items-center gap-3 bg-well/40 px-4 py-1.5">
                        <span className="w-24 shrink-0 text-[12px] tabular-nums text-ink-faint">
                          {timeFmt.format(new Date(0, 0, 1, 0, Math.max(gapBefore.startMin, nowMin)))}
                        </span>
                        <span className="text-[12px] text-ink-faint">
                          volno {minutesToLabel(gapBefore.endMin - Math.max(gapBefore.startMin, nowMin))}
                        </span>
                      </li>
                    )}
                    <li
                      className={`flex items-center gap-3 px-4 py-2.5 transition-opacity duration-300 ${
                        past ? 'opacity-45' : ''
                      } ${running ? 'bg-accent-wash/60' : ''}`}
                    >
                      <span className={`w-24 shrink-0 text-[13px] tabular-nums ${running ? 'font-semibold text-accent-deep' : 'text-ink-soft'}`}>
                        {e.allDay
                          ? 'celý den'
                          : `${timeFmt.format(new Date(e.start))}–${timeFmt.format(new Date(e.end))}`}
                      </span>

                      {/* blok z appky je zástupce úkolu → ťuknutím se otevře */}
                      {task ? (
                        <button
                          className="min-w-0 flex-1 truncate text-left text-[15px] transition-colors duration-150 active:text-accent"
                          onClick={() => onOpenTask(task)}
                        >
                          <span className={task.status === 'done' ? 'text-ink-faint line-through' : ''}>
                            {e.title}
                          </span>
                        </button>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-[15px]">
                          {e.title}
                          {span && (
                            <span className="ml-1.5 text-[12px] text-ink-faint">
                              {span.index}. den ze {span.total}
                            </span>
                          )}
                        </span>
                      )}

                      {running && (
                        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-accent-deep">
                          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle breathe" />
                          teď
                        </span>
                      )}
                      {!running && isNext && (
                        <span className="shrink-0 text-[12px] font-medium text-accent-deep">
                          {untilLabel(startMin - nowMin)}
                        </span>
                      )}

                      {/* follow-up jen u schůzky s časem — celodenní událost
                          (dovolená, svátek) není jednání k dotažení */}
                      {e.isTodoBlock ? (
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${task?.status === 'done' ? 'bg-moss' : 'bg-accent'}`}
                          title="Blok z appky"
                        />
                      ) : e.allDay ? null : followedUp.has(e.id) ? (
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
                  </Fragment>
                )
              })}

              {/* volno po poslední schůzce dne */}
              {allEvents || hidden === 0
                ? (() => {
                    const lastEnd = Math.max(
                      restStart,
                      ...events.filter((e) => !e.allDay).map((e) => minutesOfDay(e.end)),
                    )
                    const tail = gaps.find((g) => g.startMin >= lastEnd)
                    if (!tail) return null
                    return (
                      <li className="flex items-center gap-3 bg-well/40 px-4 py-1.5">
                        <span className="w-24 shrink-0 text-[12px] tabular-nums text-ink-faint">
                          {timeFmt.format(new Date(0, 0, 1, 0, Math.max(tail.startMin, nowMin)))}
                        </span>
                        <span className="text-[12px] text-ink-faint">
                          volno {minutesToLabel(tail.endMin - Math.max(tail.startMin, nowMin))} do konce dne
                        </span>
                      </li>
                    )
                  })()
                : null}

              {hidden > 0 && (
                <li>
                  <button
                    onClick={() => setAllEvents(true)}
                    className="w-full px-4 py-2 text-left text-[13px] font-medium text-accent transition-colors duration-150 active:bg-well/60"
                  >
                    …a další {hidden} {hidden === 1 ? 'schůzka' : hidden < 5 ? 'schůzky' : 'schůzek'}
                  </button>
                </li>
              )}
            </ul>
            {events.some((e) => !e.isTodoBlock && !e.allDay) && (
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
          className="rise flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left shadow-card transition-[background-color,transform] duration-150 active:scale-[0.99] active:bg-well/60"
          style={stagger(3)}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
            <svg viewBox="0 0 24 24" className="breathe h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
          className="rise flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left shadow-card transition-[background-color,transform] duration-150 active:scale-[0.99] active:bg-well/60"
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
              key={`${c.id}:${batchClient === c.id}`}
              onClick={() => setBatchClient(batchClient === c.id ? null : c.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-transform duration-150 active:scale-95 ${
                batchClient === c.id ? 'pop-soft bg-ink text-paper' : 'bg-well text-ink-soft'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Top 3 dne — co musí padnout, ať se stane cokoli. Stojí nahoře,
          zvýrazněné rámečkem, ostatní sekce tyhle úkoly už neopakují. */}
      {pinned.length > 0 && (
        <section className="rise" style={stagger(4)}>
          <h2 className="section-label mb-2 !text-accent-deep">
            na čem záleží · {pinned.length}
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-accent/35">
            {/* datum jen u toho, co není z dneška (propadlé úkoly) */}
            {pinned.map((t) => row(t, effectiveDate(t) !== today, false))}
          </ul>
        </section>
      )}

      {visOverdue.length > 0 && (
        <section className="rise" style={stagger(5)}>
          <h2 className="section-label mb-2 !text-danger">po termínu · {visOverdue.length}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">{visOverdue.map((t) => row(t))}</ul>
        </section>
      )}

      <section className="rise" style={stagger(6)}>
        {visTodays.length > 0 && <h2 className="section-label mb-2">dnes · {visTodays.length}</h2>}
        {visTodays.length > 0 ? (
          <>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
              {visTodays.map((t) => row(t, false))}
            </ul>
            {gestureTip && (
              <div className="rise mt-2 flex items-start gap-2 rounded-xl bg-accent-wash px-3 py-2">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-accent-deep" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12h6M7 9l-3 3 3 3M20 12h-6M17 9l3 3-3 3" />
                </svg>
                <span className="flex-1 text-[13px] text-accent-deep">
                  Tip: přejeď po úkolu <strong className="font-semibold">doprava</strong> = hotovo,{' '}
                  <strong className="font-semibold">doleva</strong> = odložit na zítra.
                </span>
                <button
                  aria-label="Skrýt tip"
                  onClick={dismissTip}
                  className="-m-1 shrink-0 p-1 text-accent-deep/70 transition-transform duration-150 active:scale-90"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            )}
          </>
        ) : batchClient ? (
          visOverdue.length === 0 &&
          pinned.length === 0 && (
            <p className="rounded-2xl bg-card px-4 py-4 text-center text-sm text-ink-soft shadow-card">
              U tohohle klienta dnes nic nezbývá.
            </p>
          )
        ) : (
          overdue.length === 0 &&
          pinned.length === 0 && (
            <div className="rounded-2xl bg-card px-5 py-8 text-center shadow-card">
              <svg viewBox="0 0 48 48" className="breathe mx-auto h-12 w-12 text-accent/70" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="24" cy="24" r="15" />
                <path d="M24 4v5M24 39v5M4 24h5M39 24h5M9.9 9.9l3.5 3.5M34.6 34.6l3.5 3.5M9.9 38.1l3.5-3.5M34.6 13.4l3.5-3.5" />
              </svg>
              <p className="display mt-3 text-lg font-medium">Čistý stůl</p>
              <p className="mt-1 text-sm text-ink-soft">Na dnešek nic neplánuješ.</p>

              {/* Učící prázdný stav: příklady se ťuknutím vloží do pole,
                  takže se syntaxe rychlého zadávání naučí sama od sebe. */}
              {open.length === 0 && done.length === 0 && (
                <>
                  <p className="mt-4 text-[13px] font-medium text-ink-soft">Zkus napsat třeba:</p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {EXAMPLES.map((ex) => (
                      <button
                        key={ex}
                        onClick={() =>
                          window.dispatchEvent(new CustomEvent('todo:prefill', { detail: ex }))
                        }
                        className="rounded-full bg-well px-3 py-2 text-[13px] text-ink transition-transform duration-150 active:scale-95"
                      >
                        „{ex}"
                      </button>
                    ))}
                  </div>
                </>
              )}

              <button
                onClick={() => setHelpOpen(true)}
                className="mt-4 text-[13px] font-medium text-accent transition-transform duration-150 active:scale-95"
              >
                Jak to funguje
              </button>
            </div>
          )
        )}
      </section>

      {/* Úkoly bez termínu (inbox) — vidět přímo na Dnes, ať se nic neztrácí. */}
      {(() => {
        const inbox = sortTasks(open.filter((t) => !effectiveDate(t))).filter(byBatch)
        if (inbox.length === 0) return null
        return (
          <section className="rise" style={stagger(7)}>
            <h2 className="section-label mb-2">bez termínu · {inbox.length}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">{inbox.map((t) => row(t))}</ul>
          </section>
        )
      })()}

      {done.length > 0 && (
        <section className="rise" style={stagger(8)}>
          <h2 className="section-label mb-2">hotovo · {done.length}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">{done.map((t) => row(t))}</ul>
        </section>
      )}

      {helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}
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
