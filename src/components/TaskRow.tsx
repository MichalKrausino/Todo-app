import { useRef, useState } from 'react'
import type { Client, Priority, Project, Task } from '../db/types'
import { formatDayLabel, todayISO } from '../lib/dates'

// Priorita jako barevná pilulka — čitelnější než prostý text.
const PRIO_BADGE: Partial<Record<Priority, { label: string; cls: string }>> = {
  critical: {
    label: 'kritická',
    cls: 'rounded-full bg-danger-wash px-2 py-px text-[11px] font-semibold text-danger',
  },
  high: {
    label: 'vysoká',
    cls: 'rounded-full bg-note px-2 py-px text-[11px] font-medium text-note-ink',
  },
  low: { label: 'nízká', cls: 'rounded-full bg-well px-2 py-px text-[11px] text-ink-faint' },
}

// Prodleva mezi ťuknutím a skutečným dokončením (jako iOS Připomínky):
// fajfka se nakreslí a titulek škrtne hned, řádek odpluje až potom —
// druhé ťuknutí v mezičase dokončení vrátí.
const COMPLETE_DELAY_MS = 600

// Řádek seskupeného seznamu ve stylu iOS — oddělovače řeší rodičovský
// <ul> přes divide-y, zaoblení a pozadí drží kontejner skupiny.
export function TaskRow({
  task,
  client,
  project,
  onToggle,
  onOpen,
  showDate = true,
}: {
  task: Task
  client?: Client
  project?: Project
  onToggle: (task: Task) => void
  onOpen: (task: Task) => void
  showDate?: boolean
}) {
  const done = task.status === 'done'
  const [pendingDone, setPendingDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Vizuálně hotovo hned po ťuknutí; zápis do DB až po prodlevě.
  const visualDone = done || pendingDone

  const handleToggle = () => {
    if (done) {
      onToggle(task) // vrácení mezi nehotové — bez prodlevy
      return
    }
    if (pendingDone) {
      clearTimeout(timer.current) // rozmyšleno — dokončení se ruší
      setPendingDone(false)
      return
    }
    setPendingDone(true)
    timer.current = setTimeout(() => onToggle(task), COMPLETE_DELAY_MS)
  }

  const overdue = !visualDone && !!task.dueDate && task.dueDate < todayISO()
  const prio = PRIO_BADGE[task.priority]

  return (
    <li className="rise flex items-start gap-3 bg-card px-4 py-3 transition-colors duration-150 active:bg-well/60">
      <button
        aria-label={visualDone ? 'Vrátit mezi nehotové' : 'Označit jako hotové'}
        onClick={handleToggle}
        className="-m-2 shrink-0 p-2 transition-transform duration-150 active:scale-90"
      >
        <span
          className={`relative flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-200 ${
            visualDone
              ? 'check-drawn pop border-accent bg-accent text-card'
              : 'border-ink-faint text-transparent'
          }`}
        >
          {/* záblesk prstence při dokončení (nový element na každé odškrtnutí) */}
          {visualDone && <span key="burst" className="ring-burst" />}
          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path className="check-path" d="M4.5 10.5l3.8 3.8 7.2-8.6" />
          </svg>
        </span>
      </button>

      <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(task)}>
        <div
          className={`title-strike text-[16px] leading-snug ${
            visualDone ? 'is-done text-ink-faint' : 'text-ink'
          }`}
        >
          {task.title}
        </div>
        {(client || project || (showDate && task.dueDate) || prio || task.recurrenceRule || task.sourceTemplateItemId) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
            {client && (
              <span className="inline-flex items-center gap-1.5 text-ink-soft">
                <span className="h-2 w-2 rounded-full" style={{ background: client.color }} />
                {client.name}
              </span>
            )}
            {project && <span className="text-ink-faint">{project.name}</span>}
            {showDate && task.dueDate && !visualDone && (
              <span className={overdue ? 'font-medium text-danger' : 'text-ink-soft'}>
                {formatDayLabel(task.dueDate)}
              </span>
            )}
            {(task.recurrenceRule || task.sourceTemplateItemId) && (
              <span className="text-ink-faint" title="Opakuje se">
                ↻
              </span>
            )}
            {prio && <span className={prio.cls}>{prio.label}</span>}
          </div>
        )}
      </button>
    </li>
  )
}
