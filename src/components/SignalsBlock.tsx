import type { Task } from '../db/types'
import type { Signals } from '../lib/signals'

const MAX_LINES = 6

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n < 5 ? few : many

interface Line {
  key: string
  color?: string
  text: string
  onClick?: () => void
}

// Střídmý blok „Nepropadá ti něco?" — jedna klidná karta, žádné vykřičníky
// u každého úkolu. Řádky vedou rovnou na místo, kde se to dá napravit.
export function SignalsBlock({
  signals,
  onOpenClient,
  onOpenTask,
  onOpenInbox,
}: {
  signals: Signals
  onOpenClient: (id: string) => void
  onOpenTask: (t: Task) => void
  onOpenInbox: () => void
}) {
  const lines: Line[] = []

  for (const { client, days } of signals.neglected) {
    lines.push({
      key: `neg:${client.id}`,
      color: client.color,
      text: `${client.name} — ${days} dní bez aktivity`,
      onClick: () => onOpenClient(client.id),
    })
  }
  for (const client of signals.unplanned) {
    lines.push({
      key: `unp:${client.id}`,
      color: client.color,
      text: `${client.name} — nic naplánovaného`,
      onClick: () => onOpenClient(client.id),
    })
  }
  for (const { project, client } of signals.stalledProjects) {
    lines.push({
      key: `stall:${project.id}`,
      color: client.color,
      text: `Projekt „${project.name}“ (${client.name}) stojí — chybí další krok`,
      onClick: () => onOpenClient(client.id),
    })
  }
  for (const task of signals.postponed) {
    lines.push({
      key: `post:${task.id}`,
      text: `„${task.title}“ — odloženo už ${task.postponeCount}×`,
      onClick: () => onOpenTask(task),
    })
  }
  if (signals.agingInbox.length > 0) {
    const n = signals.agingInbox.length
    lines.push({
      key: 'inbox',
      text: `${n} ${plural(n, 'úkol leží', 'úkoly leží', 'úkolů leží')} v inboxu déle než týden`,
      onClick: onOpenInbox,
    })
  }

  if (lines.length === 0) return null
  const shown = lines.slice(0, MAX_LINES)
  const hidden = lines.length - shown.length

  return (
    <section className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-700">
        Nepropadá ti něco?
      </h2>
      <ul className="mt-1.5 space-y-1">
        {shown.map((line) => (
          <li key={line.key}>
            <button
              onClick={line.onClick}
              className="flex w-full items-baseline gap-1.5 text-left text-sm text-slate-700"
            >
              {line.color && (
                <span
                  className="h-2 w-2 shrink-0 self-center rounded-full"
                  style={{ background: line.color }}
                />
              )}
              <span className="min-w-0">{line.text}</span>
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="mt-1 text-xs text-amber-700/70">…a {hidden} dalších</p>}
    </section>
  )
}
