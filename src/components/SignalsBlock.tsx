import type { Task } from '../db/types'
import type { Signals } from '../lib/signals'
import { useState } from 'react'
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

  const [vse, setVse] = useState(false)
  if (lines.length === 0) return null
  const shown = vse ? lines : lines.slice(0, MAX_LINES)
  const hidden = lines.length - shown.length

  // Dřív oranžová plocha přes celou šířku — na obrazovce s reálnými daty
  // to byl nejhlasitější prvek. Teď stejná karta jako ostatní sekce; že
  // jde o signály, říká jen barva nadpisu a řádky vedou dál šipkou.
  return (
    <section className="rise" style={{ '--stagger': 4 } as React.CSSProperties}>
      <h2 className="section-label mb-2 !text-note-ink">nepropadá ti něco?</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
        {shown.map((line, i) => (
          <li key={line.key} className="rise" style={{ '--stagger': Math.min(5 + i, 9) } as React.CSSProperties}>
            <button
              onClick={line.onClick}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] text-ink transition-colors duration-150 active:bg-well/60"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: line.color ?? 'var(--color-amber)' }}
              />
              <span className="min-w-0 flex-1">{line.text}</span>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <button
              onClick={() => setVse(true)}
              className="w-full px-4 py-2.5 text-left text-[13px] font-medium text-accent-deep transition-colors duration-150 active:bg-well/60"
            >
              Zobrazit {plural(hidden, 'další', 'další', 'dalších')} {hidden}
            </button>
          </li>
        )}
      </ul>
    </section>
  )
}
