import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { calendarEventsBetween, openTasks } from '../db/repo'
import { fromISODate, toISODate, todayISO } from '../lib/dates'

// Vlastní měsíční kalendářík s heatmapou vytížení dne — systémový
// <input type="date"> obarvit nejde. Sytost podkladu = počet schůzek
// (bez bloků z appky, ty jsou už spočítané jako úkoly) + úkolů
// s termínem/plánem v ten den. Vybraný den plná modrá, dnešek rámeček.

const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']
const monthFmt = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' })

// Tři úrovně sytosti stačí — víc by přestalo být čitelné.
function heatClass(count: number): string {
  if (count <= 0) return ''
  if (count <= 2) return 'bg-accent/15'
  if (count <= 4) return 'bg-accent/30'
  return 'bg-accent/45'
}

export function MonthPicker({
  value,
  onSelect,
}: {
  value?: string
  onSelect: (iso: string) => void
}) {
  const today = todayISO()
  const [month, setMonth] = useState(() => (value ?? today).slice(0, 7)) // YYYY-MM

  const first = `${month}-01`
  const firstDate = fromISODate(first)
  const daysInMonth = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0).getDate()
  const last = `${month}-${String(daysInMonth).padStart(2, '0')}`
  const lead = (firstDate.getDay() + 6) % 7 // pondělí = 0

  const events = useLiveQuery(() => calendarEventsBetween(first, last), [first, last]) ?? []
  const tasks = useLiveQuery(openTasks, []) ?? []

  const load = new Map<string, number>()
  for (const e of events) {
    if (!e.isTodoBlock) load.set(e.startDay, (load.get(e.startDay) ?? 0) + 1)
  }
  for (const t of tasks) {
    for (const d of new Set([t.dueDate, t.scheduledFor].filter((x): x is string => Boolean(x)))) {
      if (d >= first && d <= last) load.set(d, (load.get(d) ?? 0) + 1)
    }
  }

  const shift = (delta: number) => {
    const d = new Date(firstDate.getFullYear(), firstDate.getMonth() + delta, 1)
    setMonth(toISODate(d).slice(0, 7))
  }

  // nebrat fokus textovému poli rychlého zadávání
  const keep = (e: React.PointerEvent) => e.preventDefault()

  return (
    <div className="rise mb-2 rounded-xl bg-card p-3 shadow-card">
      <div className="mb-1.5 flex items-center justify-between">
        <button
          type="button"
          onPointerDown={keep}
          onClick={() => shift(-1)}
          aria-label="Předchozí měsíc"
          className="flex h-8 w-8 items-center justify-center rounded-full text-accent transition-transform duration-150 active:scale-90"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <span key={month} className="pop-soft inline-block text-[14px] font-semibold first-letter:uppercase">
          {monthFmt.format(firstDate)}
        </span>
        <button
          type="button"
          onPointerDown={keep}
          onClick={() => shift(1)}
          aria-label="Další měsíc"
          className="flex h-8 w-8 items-center justify-center rounded-full text-accent transition-transform duration-150 active:scale-90"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <div key={`g${month}`} className="rise grid grid-cols-7 gap-y-0.5 text-center">
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-[11px] font-medium text-ink-faint">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }).map((_, i) => (
          <span key={`lead${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, '0')}`
          const count = load.get(iso) ?? 0
          const selected = iso === value
          const isToday = iso === today
          const past = iso < today
          return (
            <button
              key={iso}
              type="button"
              data-day={iso}
              data-load={count}
              onPointerDown={keep}
              onClick={() => onSelect(iso)}
              aria-label={`${iso}${count > 0 ? `, ${count} položek` : ', volno'}`}
              className="flex items-center justify-center py-0.5"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] tabular-nums transition-colors duration-150 ${
                  selected
                    ? 'bg-accent font-semibold text-card'
                    : `${heatClass(count)} ${
                        isToday
                          ? 'border border-accent font-semibold text-accent'
                          : past
                            ? 'text-ink-faint'
                            : 'text-ink'
                      }`
                }`}
              >
                {i + 1}
              </span>
            </button>
          )
        })}
      </div>

      <p className="mt-1 text-center text-[11px] text-ink-faint">
        sytost pozadí = vytížení dne (schůzky + úkoly)
      </p>
    </div>
  )
}
