import type { Task } from '../db/types'
import type { Signals } from '../lib/signals'
import { plural } from '../lib/labels'

const MAX_LINES = 6


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
    <section className="rise rounded-2xl bg-note px-4 py-3" style={{ '--stagger': 4 } as React.CSSProperties}>
      <h2 className="section-label !text-note-ink">nepropadá ti něco?</h2>
      <ul className="mt-1.5 space-y-1.5">
        {shown.map((line, i) => (
          <li key={line.key} className="rise" style={{ '--stagger': 5 + i } as React.CSSProperties}>
            <button
              onClick={line.onClick}
              className="flex w-full items-baseline gap-1.5 text-left text-sm text-ink transition-transform duration-150 active:scale-[0.99]"
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
      {hidden > 0 && <p className="mt-1.5 text-xs text-note-ink/70">…a {hidden} dalších</p>}
    </section>
  )
}
