// Celý den z kalendáře v panelu: schůzky, volná okna mezi nimi, follow-up
// ke schůzce. Na obrazovce Dnes stojí jen jedna řádka s nejbližší schůzkou
// (kontextový chip) — rozpis dne není dnešní práce, ta je v seznamu úkolů.

import { Fragment, useState } from 'react'
import type { CalendarEvent, Task } from '../db/types'
import { addMeetingFollowUp } from '../db/repo'
import { formatEventRange, fromISODate } from '../lib/dates'
import { freeGaps, minutesToLabel } from '../lib/freeSlot'
import { Sheet } from './Sheet'

export const minutesOfDay = (iso: string) => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

// „za 25 min" / „za 1 h 20" — odpočet do nejbližší schůzky.
export const untilLabel = (min: number): string => {
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

const timeFmt = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })

export function KalendarSheet({
  events,
  tasks,
  gaps,
  nowMin,
  restStart,
  today,
  freeMin,
  onOpenTask,
  onClose,
}: {
  events: CalendarEvent[]
  tasks: Task[]
  gaps: ReturnType<typeof freeGaps>
  nowMin: number
  restStart: number
  today: string
  freeMin: number | null
  onOpenTask: (t: Task) => void
  onClose: () => void
}) {
  // Schůzky, ze kterých už v tomhle otevření vznikl follow-up (ukáže ✓).
  const [followedUp, setFollowedUp] = useState<Set<string>>(new Set())
  // Úkol stojící za blokem z appky — ať se na blok dá ťuknout.
  const taskByEvent = new Map(tasks.filter((t) => t.calendarEventId).map((t) => [t.calendarEventId!, t]))
  const nextStart = events
    .filter((e) => !e.allDay)
    .map((e) => minutesOfDay(e.start))
    .filter((m) => m > nowMin)
    .sort((a, b) => a - b)[0]
  // Dvě schůzky ve stejnou minutu by jinak vykreslily tentýž řádek volna
  // dvakrát — každé okno se ukáže nejvýš jednou.
  const usedGaps = new Set<number>()
  const lastEnd = Math.max(restStart, ...events.filter((e) => !e.allDay).map((e) => minutesOfDay(e.end)))
  const tail = gaps.find((g) => g.startMin >= lastEnd)

  return (
    <Sheet onClose={onClose} tone="paper" className="space-y-4">
      {() => (
        <>
          <header className="flex items-baseline justify-between gap-3 pt-1">
            <h2 className="display text-2xl font-bold">Kalendář</h2>
            {freeMin !== null && (
              <span className="shrink-0 text-sm text-ink-soft">zbývá ~{minutesToLabel(freeMin)}</span>
            )}
          </header>

          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
            {events.map((e) => {
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
                    className={`flex items-center gap-3 px-4 py-2.5 ${past ? 'opacity-45' : ''} ${
                      running ? 'bg-accent-wash/60' : ''
                    }`}
                  >
                    <span
                      className={`w-24 shrink-0 text-[13px] tabular-nums ${running ? 'font-semibold text-accent-deep' : 'text-ink-soft'}`}
                    >
                      {e.allDay ? 'celý den' : formatEventRange(e)}
                    </span>
                    {task ? (
                      <button
                        className="min-w-0 flex-1 truncate text-left text-[15px] transition-colors duration-150 active:text-accent-deep"
                        onClick={() => onOpenTask(task)}
                      >
                        <span className={task.status === 'done' ? 'text-ink-faint line-through' : ''}>{e.title}</span>
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
                      <span className="shrink-0 text-[12px] font-medium text-accent-deep">{untilLabel(startMin - nowMin)}</span>
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
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-well text-ink-soft transition-transform duration-150 active:scale-90"
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
            {tail && (
              <li className="flex items-center gap-3 bg-well/40 px-4 py-1.5">
                <span className="w-24 shrink-0 text-[12px] tabular-nums text-ink-faint">
                  {timeFmt.format(new Date(0, 0, 1, 0, Math.max(tail.startMin, nowMin)))}
                </span>
                <span className="text-[12px] text-ink-faint">
                  volno {minutesToLabel(tail.endMin - Math.max(tail.startMin, nowMin))} do konce dne
                </span>
              </li>
            )}
          </ul>
          <p className="px-1 text-[12px] text-ink-faint">Plusko u schůzky založí úkol „Follow-up: …" na dnešek.</p>
        </>
      )}
    </Sheet>
  )
}
