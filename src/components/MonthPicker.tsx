import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { calendarEventsBetween, openTasks } from '../db/repo'
import { addDays, fromISODate, toISODate, todayISO } from '../lib/dates'

// Vlastní měsíční kalendářík — systémový <input type="date"> obarvit nejde.
//
// Jediná plná výplň v celém kalendáři je VYBRANÝ den. Vytížení dne
// (schůzky bez bloků z appky + úkoly s termínem nebo plánem) se kreslí
// jako tečka pod číslem, ne jako podbarvení: dřív mělo „něco tam je"
// i „tohle jsi zvolil" tutéž modrou v jiné sytosti a nešlo je rozeznat.
// Tečka + kroužek dneška je jazyk, který lidé znají z Kalendáře.

const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']
const monthFmt = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' })

// Semaforová tečka pod číslem: klidná = pár věcí, oranžová = nabito,
// červená = plno. Přesný obsah dne řekne náhled pod kalendářem, tady
// stačí, že je vidět rozdíl mezi prázdným a napěchovaným dnem.
function loadDot(count: number): string {
  if (count <= 0) return ''
  if (count <= 2) return 'bg-accent/70'
  if (count <= 4) return 'bg-amber'
  return 'bg-danger'
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

  // směr listování — nový měsíc přijíždí ze strany, kam se listuje
  const [dir, setDir] = useState(0)

  // Vybraný den může spadnout do jiného měsíce, než je zrovna vidět —
  // třicátého prvního srpna míří „Zítra" na září a kalendář zůstával
  // v srpnu, kde nebylo označeno nic. Měsíc proto jde za výběrem.
  useEffect(() => {
    const cil = value?.slice(0, 7)
    if (!cil || cil === month) return
    setDir(cil > month ? 1 : -1)
    setMonth(cil)
  }, [value, month])
  const shift = (delta: number) => {
    setDir(delta)
    const d = new Date(firstDate.getFullYear(), firstDate.getMonth() + delta, 1)
    setMonth(toISODate(d).slice(0, 7))
  }

  // nebrat fokus textovému poli rychlého zadávání
  const keep = (e: React.PointerEvent) => e.preventDefault()

  return (
    // Bez vlastní karty — sedí rovnou v panelu zadávání. Dvě zaoblené
    // krabice v sobě dělaly z výběru termínu hlučnější věc, než je.
    <div className="rise mb-1.5 px-1 py-0.5">
      <div className="mb-0.5 flex items-center justify-between">
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

      <div
        key={`g${month}`}
        className="view-enter grid grid-cols-7 gap-y-1 text-center"
        style={{ '--vx': dir === 0 ? '0px' : dir > 0 ? '18px' : '-18px' } as React.CSSProperties}
      >
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
          const cls = selected
            ? 'bg-accent font-semibold text-card'
            : isToday
              ? 'ring-1 ring-accent font-semibold text-accent'
              : past
                ? 'text-ink-faint'
                : 'text-ink'
          return (
            <button
              key={iso}
              type="button"
              data-day={iso}
              data-load={count}
              onPointerDown={keep}
              onClick={() => onSelect(iso)}
              aria-label={`${iso}${count > 0 ? `, ${count} položek` : ', volno'}`}
              className="flex flex-col items-center justify-center"
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] tabular-nums transition-colors duration-150 ${cls}`}
              >
                {i + 1}
              </span>
              {/* U vybraného dne tečku neukazujeme — co na něm je, stojí
                  rozepsané hned pod kalendářem. */}
              <span
                className={`mt-[2px] h-1 w-1 rounded-full ${selected ? '' : loadDot(count)}`}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
