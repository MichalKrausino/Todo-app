import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { calendarEventsBetween, openTasks } from '../db/repo'
import { addDays, fromISODate, toISODate, todayISO } from '../lib/dates'

// Vlastní měsíční kalendářík s heatmapou vytížení dne — systémový
// <input type="date"> obarvit nejde. Sytost podkladu = počet schůzek
// (bez bloků z appky, ty jsou už spočítané jako úkoly) + úkolů
// s termínem/plánem v ten den. Vybraný den plná modrá, dnešek rámeček.

const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']
const monthFmt = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' })

// Semaforová škála — barva rovnou říká, jak moc je den plný:
// modrá = pár věcí, oranžová = nabito, červená = plno. Wash odstíny
// byly na displeji k nerozeznání od bílé (ověřeno pixelově), proto
// průhledné varianty plných barev — viditelné v obou režimech.
function heatClass(count: number): string {
  if (count <= 0) return ''
  if (count <= 2) return 'bg-accent/30'
  if (count <= 4) return 'bg-amber/40'
  return 'bg-danger/40 font-medium'
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
    if (e.isTodoBlock) continue
    // vícedenní událost se počítá do KAŽDÉHO dne, přes který běží
    // (oříznuto na zobrazený měsíc; guard proti nesmyslným datům)
    let d = e.startDay < first ? first : e.startDay
    const end = (e.endDay ?? e.startDay) > last ? last : (e.endDay ?? e.startDay)
    let guard = 0
    while (d <= end && guard++ < 62) {
      load.set(d, (load.get(d) ?? 0) + 1)
      d = toISODate(addDays(fromISODate(d), 1))
    }
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
    <div className="rise mb-2 rounded-xl bg-card p-2.5 shadow-card">
      <div className="mb-1 flex items-center justify-between">
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

      <div key={`g${month}`} className="rise grid grid-cols-7 gap-y-0 text-center">
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-[10px] font-medium text-ink-faint">
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
          const heat = heatClass(count)
          const cls = selected
            ? 'bg-accent font-semibold text-card'
            : [
                heat,
                isToday ? 'border border-accent font-semibold' : '',
                isToday && !heat ? 'text-accent' : '',
                !heat && !isToday ? (past ? 'text-ink-faint' : 'text-ink') : '',
              ].join(' ')
          return (
            <button
              key={iso}
              type="button"
              data-day={iso}
              data-load={count}
              onPointerDown={keep}
              onClick={() => onSelect(iso)}
              aria-label={`${iso}${count > 0 ? `, ${count} položek` : ', volno'}`}
              className="flex items-center justify-center"
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] tabular-nums transition-colors duration-150 ${cls}`}
              >
                {i + 1}
              </span>
            </button>
          )
        })}
      </div>

      {/* vizuální legenda — barvy rovnou s významem */}
      <div className="mt-1 flex items-center justify-center gap-3 text-[10px] text-ink-faint">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-accent/30" /> 1–2
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-amber/40" /> 3–4
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/40" /> 5+
        </span>
        <span>schůzek a úkolů za den</span>
      </div>
    </div>
  )
}
