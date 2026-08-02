import type { Client, Priority, Project, Task } from '../db/types'
import { formatDayLabel, todayISO } from '../lib/dates'

const PRIO_BADGE: Partial<Record<Priority, { label: string; cls: string }>> = {
  critical: { label: '‼ kritická', cls: 'font-semibold text-danger' },
  high: { label: '! vysoká', cls: 'font-medium text-accent' },
  low: { label: '↓ nízká', cls: 'text-ink-faint' },
}

export function TaskRow({
  task,
  client,
  project,
  onToggle,
  onOpen,
  showDate = true,
  index = 0,
}: {
  task: Task
  client?: Client
  project?: Project
  onToggle: (task: Task) => void
  onOpen: (task: Task) => void
  showDate?: boolean
  index?: number
}) {
  const done = task.status === 'done'
  const overdue = !done && !!task.dueDate && task.dueDate < todayISO()
  const prio = PRIO_BADGE[task.priority]

  return (
    <li
      className="rise flex items-start gap-3 rounded-2xl bg-card px-3.5 py-3 shadow-card"
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <button
        aria-label={done ? 'Vrátit mezi nehotové' : 'Označit jako hotové'}
        onClick={() => onToggle(task)}
        className="-m-2 shrink-0 p-2 active:scale-90"
        style={{ transition: 'transform 150ms' }}
      >
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] transition-colors duration-200 ${
            done ? 'pop border-accent bg-accent text-card' : 'border-ink-faint text-transparent'
          }`}
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 10.5l3.8 3.8 7.2-8.6" />
          </svg>
        </span>
      </button>

      <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(task)}>
        <div
          className={`text-[15px] leading-snug transition-colors duration-300 ${
            done ? 'text-ink-faint line-through decoration-ink-faint/60' : 'text-ink'
          }`}
        >
          {task.title}
        </div>
        {(client || project || (showDate && task.dueDate) || prio || task.recurrenceRule || task.sourceTemplateItemId) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
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
