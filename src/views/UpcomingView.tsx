import { useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { CalendarEvent, Task } from '../db/types'
import {
  allClients,
  allProjects,
  calendarEventsBetween,
  completeTask,
  openTasks,
  reopenTask,
  sortTasks,
} from '../db/repo'
import { plannedMinutes } from '../lib/capacity'
import { addDays, formatDayLabel, formatEventRange, fromISODate, toISODate, todayISO } from '../lib/dates'
import { minutesToLabel } from '../lib/freeSlot'
import { TaskRow } from '../components/TaskRow'

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n < 5 ? few : many

const effectiveDate = (t: Task): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

const WEEKDAY = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So']

// Kolik dní dopředu ukazuje pás nahoře.
const STRIP_DAYS = 14
// Jak daleko se hledají naplánované úkoly a schůzky.
const HORIZON_DAYS = 30

// Sytost proužku pod dnem = kolik toho ten den je. Stejná semaforová
// škála jako v kalendáříku u zadávání úkolu.
function loadClass(count: number): string {
  if (count <= 0) return 'bg-transparent'
  if (count <= 2) return 'bg-accent/45'
  if (count <= 4) return 'bg-amber/60'
  return 'bg-danger/60'
}

export function UpcomingView({
  onOpenTask,
  onShowToday,
  onOpenReview,
}: {
  onOpenTask: (t: Task) => void
  onShowToday?: () => void
  onOpenReview?: () => void
}) {
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
  const inbox = sortTasks(open.filter((t) => !effectiveDate(t)))

  // Neděle a pondělí — stejné okno, v jakém chodí nedělní push notifikace.
  const reviewDay = [0, 1].includes(fromISODate(today).getDay())

  const horizon = toISODate(addDays(fromISODate(today), HORIZON_DAYS))
  const events = useLiveQuery(() => calendarEventsBetween(today, horizon), [today, horizon]) ?? []

  // Schůzky po dnech — vícedenní událost patří do KAŽDÉHO svého dne
  // (jinak by dovolená svítila jen v den začátku).
  const eventsPerDay = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    if (e.isTodoBlock) continue
    let d = e.startDay < today ? today : e.startDay
    const end = (e.endDay ?? e.startDay) > horizon ? horizon : (e.endDay ?? e.startDay)
    let guard = 0
    while (d <= end && guard++ <= HORIZON_DAYS + 1) {
      const list = eventsPerDay.get(d) ?? []
      list.push(e)
      eventsPerDay.set(d, list)
      d = toISODate(addDays(fromISODate(d), 1))
    }
  }

  // Den se ukáže, když na něj něco je — úkol nebo schůzka. Plán tak
  // konečně ukazuje i dny, kde čekají jen jednání.
  const dates = [...new Set([...groups.keys(), ...eventsPerDay.keys()])]
    .filter((d) => d > today)
    .sort()

  // Kolik je dnes — dlaždice „dnes" nesla plný modrý proužek pořád,
  // takže mezi ostatními, kde sytost znamená vytížení, hlásila „plno"
  // i na prázdný den. Tady se počítá stejně: úkoly na dnešek (i ty
  // propadlé, ty se na Dnes taky ukážou) plus schůzky.
  const todayCount =
    open.filter((t) => {
      const d = effectiveDate(t)
      return d !== undefined && d <= today
    }).length + (eventsPerDay.get(today)?.length ?? 0)

  // Pás nejbližších dnů: zítřek + STRIP_DAYS-1 dalších (dnešek zvlášť).
  const strip = Array.from({ length: STRIP_DAYS }, (_, i) =>
    toISODate(addDays(fromISODate(today), i + 1)),
  )

  const sectionRefs = useRef(new Map<string, HTMLElement>())
  const jumpTo = (d: string) => {
    sectionRefs.current.get(d)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
    <div className="space-y-6">
      <header className="rise">
        <h1 className="display text-[2.1rem] font-semibold leading-tight">Plán</h1>
        <p className="text-sm text-ink-soft">Co je přede mnou</p>
      </header>

      {/* Pás nejbližších dvou týdnů — proužek pod číslem říká, jak je
          den nabitý; ťuknutí skočí na jeho sekci. */}
      <div
        className="rise -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {onShowToday && (
          <button
            onClick={onShowToday}
            className="flex w-12 shrink-0 flex-col items-center gap-1 rounded-xl bg-well px-1 py-1.5 transition-transform duration-150 active:scale-95"
          >
            <span className="text-[10px] font-medium text-ink-faint">dnes</span>
            <span className="text-[15px] font-semibold text-accent-deep tabular-nums">
              {fromISODate(today).getDate()}
            </span>
            <span className={`h-1 w-6 rounded-full ${loadClass(todayCount)}`} />
          </button>
        )}
        {strip.map((d) => {
          const date = fromISODate(d)
          const count = (groups.get(d)?.length ?? 0) + (eventsPerDay.get(d)?.length ?? 0)
          const weekend = [0, 6].includes(date.getDay())
          const has = count > 0
          return (
            <button
              key={d}
              data-day={d}
              data-load={count}
              disabled={!has}
              onClick={() => jumpTo(d)}
              className={`flex w-12 shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-transform duration-150 ${
                has ? 'bg-card shadow-card active:scale-95' : 'bg-well/50'
              }`}
            >
              <span className={`text-[10px] font-medium ${weekend ? 'text-ink-faint' : 'text-ink-soft'}`}>
                {WEEKDAY[date.getDay()]}
              </span>
              <span
                className={`text-[15px] tabular-nums ${has ? 'font-semibold text-ink' : 'text-ink-faint'}`}
              >
                {date.getDate()}
              </span>
              <span className={`h-1 w-6 rounded-full ${loadClass(count)}`} />
            </button>
          )
        })}
      </div>

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

      {dates.map((d, i) => {
        const dayTasks = sortTasks(groups.get(d) ?? [])
        const dayEvents = [...(eventsPerDay.get(d) ?? [])].sort(
          (a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start),
        )
        const workMin = plannedMinutes(dayTasks)
        return (
          <section
            key={d}
            ref={(el) => {
              if (el) sectionRefs.current.set(d, el)
              else sectionRefs.current.delete(d)
            }}
            className="rise scroll-mt-24"
            style={{ '--stagger': Math.min(i + 1, 8) } as React.CSSProperties}
          >
            {/* bez first-letter:lowercase — s verzálkami v section-label
                dělalo zvěrstva typu „zíTRA" a „sO 8. 8." */}
            <h2 className="section-label mb-2">
              {formatDayLabel(d)}
              {dayTasks.length > 0 && ` · ${dayTasks.length} ${plural(dayTasks.length, 'úkol', 'úkoly', 'úkolů')}`}
              {workMin > 0 && ` · ~${minutesToLabel(workMin)}`}
            </h2>

            <div className="overflow-hidden rounded-2xl bg-card shadow-card">
              {/* schůzky dne — Plán teď ukazuje i to, co je v kalendáři */}
              {dayEvents.length > 0 && (
                <ul className="divide-y divide-line border-b border-line bg-well/30">
                  {dayEvents.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-2">
                      <span className="w-24 shrink-0 text-[13px] tabular-nums text-ink-soft">
                        {formatEventRange(e)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[14px] text-ink-soft">{e.title}</span>
                    </li>
                  ))}
                </ul>
              )}
              {dayTasks.length > 0 ? (
                <ul className="divide-y divide-line">{dayTasks.map((t) => row(t, false))}</ul>
              ) : (
                <p className="px-4 py-2.5 text-[13px] text-ink-faint">Jen schůzky, žádný úkol.</p>
              )}
            </div>
          </section>
        )
      })}

      {inbox.length > 0 && (
        <section className="rise" style={{ '--stagger': Math.min(dates.length + 1, 9) } as React.CSSProperties}>
          <h2 className="section-label mb-2">bez termínu · {inbox.length}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">{inbox.map((t) => row(t, true))}</ul>
        </section>
      )}

      {/* Ohlédnutí za týdnem bydlí tady, ne na Dnes: ráno po otevření appky
          je podstatné, co mám dneska udělat — ne co bylo minulý týden.
          V Plánu sedí na konci, pod výhledem dopředu, a nabízí se jen
          v neděli a v pondělí, kdy má smysl. */}
      {onOpenReview && reviewDay && (
        <button
          onClick={onOpenReview}
          className="rise flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left shadow-card transition-[background-color,transform] duration-150 active:scale-[0.99] active:bg-well/60"
          style={{ '--stagger': Math.min(dates.length + 2, 9) } as React.CSSProperties}
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
    </div>
  )
}
