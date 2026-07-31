import type { Client, Priority, Project, Task } from '../db/types'
import { formatDayLabel, todayISO } from '../lib/dates'

const PRIO_BADGE: Partial<Record<Priority, { label: string; cls: string }>> = {
  critical: { label: '‼ kritická', cls: 'font-semibold text-red-600' },
  high: { label: '! vysoká', cls: 'font-medium text-orange-600' },
  low: { label: '↓ nízká', cls: 'text-slate-400' },
}

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
    <li className="flex items-start gap-3 rounded-xl bg-white px-3 py-2.5 shadow-sm">
      <button
        aria-label={done ? 'Vrátit mezi nehotové' : 'Označit jako hotové'}
        onClick={() => onToggle(task)}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          done ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 text-transparent'
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 10.5l4 4 8-9" />
        </svg>
      </button>

      <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(task)}>
        <div className={`text-[15px] leading-snug ${done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
          {task.title}
        </div>
        {(client || project || (showDate && task.dueDate) || prio) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {client && (
              <span className="inline-flex items-center gap-1 text-slate-500">
                <span className="h-2 w-2 rounded-full" style={{ background: client.color }} />
                {client.name}
              </span>
            )}
            {project && <span className="text-slate-400">{project.name}</span>}
            {showDate && task.dueDate && !done && (
              <span className={overdue ? 'font-medium text-red-600' : 'text-slate-500'}>
                {formatDayLabel(task.dueDate)}
              </span>
            )}
            {(task.recurrenceRule || task.sourceTemplateItemId) && (
              <span className="text-slate-400" title="Opakuje se">
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
