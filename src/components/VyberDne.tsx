// Výběr dne a rostoucí pole — díly, které panely appky sdílejí.
//
// Stojí spolu schválně: obojí je „pole, které se chová jinak, než HTML
// umí samo" (textarea, co roste s textem; kalendářík s rychlými dny
// a časem). V detailu úkolu to jen leželo nad komponentou, o kterou tam jde.

import { useLayoutEffect, useRef } from 'react'
import { MonthPicker } from './MonthPicker'
import { pill } from './SlotChip'
import { cn } from '../lib/cn'
import { addDays, fromISODate, nextMonday, toISODate, todayISO } from '../lib/dates'

const QUICK_DAYS: { label: string; day: (today: string) => string }[] = [
  { label: 'Dnes', day: (t) => t },
  { label: 'Zítra', day: (t) => toISODate(addDays(fromISODate(t), 1)) },
  { label: 'Pondělí', day: (t) => toISODate(nextMonday(fromISODate(t))) },
]

export const velkePismeno = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

// Textové pole, které roste s obsahem — titulek ani poznámka nemají mít
// posuvník uvnitř panelu, který sám roluje.
export function AutoTextarea({ className, value, ...props }: React.ComponentProps<'textarea'>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={cn('block w-full resize-none bg-transparent outline-none placeholder:text-ink-faint', className)}
      {...props}
    />
  )
}

// Výběr dne: rychlé volby + kalendářík. Sdílí ho Termín i Naplánováno.
export function VyberDne({
  value,
  bezPopisek,
  onChange,
  children,
}: {
  value: string
  bezPopisek: string
  onChange: (iso: string) => void
  children?: React.ReactNode
}) {
  const today = todayISO()
  return (
    <div>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5" style={{ scrollbarWidth: 'none' }}>
        {QUICK_DAYS.map(({ label, day }) => {
          const iso = day(today)
          const on = value === iso
          return (
            <button
              key={label}
              type="button"
              onClick={() => onChange(iso)}
              aria-pressed={on}
              className={`${pill} ${on ? 'bg-accent text-card' : 'bg-card text-ink'}`}
            >
              {label}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => onChange('')}
          aria-pressed={!value}
          className={`${pill} ${!value ? 'bg-accent text-card' : 'bg-card text-ink-soft'}`}
        >
          {bezPopisek}
        </button>
      </div>
      <MonthPicker value={value || undefined} onSelect={onChange} />
      {children}
    </div>
  )
}
