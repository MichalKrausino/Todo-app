// Tiché signály — „Nepropadá ti něco?" — v panelu. Na obrazovce Dnes je
// z nich jen kontextový chip s počtem: signály nejsou dnešní práce, jsou
// to věci k rozmyšlení, a jako blok pod seznamem se z nich stal ten
// nejhlasitější prvek obrazovky.

import type { Task } from '../db/types'
import type { Signals } from '../lib/signals'
import { plural } from '../lib/labels'
import { Sheet } from './Sheet'

export interface SignalRadek {
  key: string
  color?: string
  text: string
  onClick?: () => void
}

export function signalRadky(
  signals: Signals,
  h: { onOpenClient: (id: string) => void; onOpenTask: (t: Task) => void; onOpenInbox: () => void },
): SignalRadek[] {
  const lines: SignalRadek[] = []
  for (const { client, days } of signals.neglected) {
    lines.push({ key: `neg:${client.id}`, color: client.color, text: `${client.name} — ${days} dní bez aktivity`, onClick: () => h.onOpenClient(client.id) })
  }
  for (const client of signals.unplanned) {
    lines.push({ key: `unp:${client.id}`, color: client.color, text: `${client.name} — nic naplánovaného`, onClick: () => h.onOpenClient(client.id) })
  }
  for (const { project, client } of signals.stalledProjects) {
    lines.push({ key: `stall:${project.id}`, color: client.color, text: `Projekt „${project.name}“ (${client.name}) stojí — chybí další krok`, onClick: () => h.onOpenClient(client.id) })
  }
  for (const task of signals.postponed) {
    lines.push({ key: `post:${task.id}`, text: `„${task.title}“ — odloženo už ${task.postponeCount}×`, onClick: () => h.onOpenTask(task) })
  }
  if (signals.agingInbox.length > 0) {
    const n = signals.agingInbox.length
    lines.push({ key: 'inbox', text: `${n} ${plural(n, 'úkol leží', 'úkoly leží', 'úkolů leží')} v inboxu déle než týden`, onClick: h.onOpenInbox })
  }
  return lines
}

export function SignalySheet({ radky, onClose }: { radky: SignalRadek[]; onClose: () => void }) {
  return (
    <Sheet onClose={onClose} tone="paper" className="space-y-4">
      {(close) => (
        <>
          <header className="pt-1">
            <h2 className="display text-2xl font-bold">Nepropadá ti něco?</h2>
            <p className="mt-1 text-sm text-ink-soft">
              {radky.length} {plural(radky.length, 'věc k rozmyšlení', 'věci k rozmyšlení', 'věcí k rozmyšlení')} — každá vede tam, kde se to dá napravit.
            </p>
          </header>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
            {radky.map((line) => (
              <li key={line.key}>
                <button
                  onClick={() => {
                    close()
                    line.onClick?.()
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] text-ink transition-colors duration-150 active:bg-well/60"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: line.color ?? 'var(--color-amber)' }} />
                  <span className="min-w-0 flex-1">{line.text}</span>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  )
}
