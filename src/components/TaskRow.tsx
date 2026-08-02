import type { Client, Priority, Project, Task } from '../db/types'
import { formatDayLabel, todayISO } from '../lib/dates'

const PRIO_BADGE: Partial<Record<Priority, { label: string; cls: string }>> = {
  critical: { label: '‼ kritická', cls: 'font-semibold text-danger' },
  high: { label: '! vysoká', cls: 'font-medium text-note-ink' },
  low: { label: '↓ nízká', cls: 'text-ink-faint' },
}

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
  const overdue = !done && !!task.dueDate && task.dueDate < todayISO()
  const prio = PRIO_BADGE[task.priority]

  return (
    <li className="flex items-start gap-3 bg-card px-4 py-3 transition-colors duration-150 active:bg-well/60">
      <button
        aria-label={done ? 'Vrátit mezi nehotové' : 'Označit jako hotové'}
        onClick={() => onToggle(task)}
        className="-m-2 shrink-0 p-2 transition-transform duration-150 active:scale-90"
      >
        <span
          className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-200 ${
            done ? 'pop border-accent bg-accent text-card' : 'border-ink-faint text-transparent'
          }`}
        >
          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 10.5l3.8 3.8 7.2-8.6" />
          </svg>
        </span>
      </button>

      <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(task)}>
        <div
          className={`text-[16px] leading-snug transition-colors duration-300 ${
            done ? 'text-ink-faint line-through' : 'text-ink'
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
            {showDate && task.dueDate && !done && (
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
