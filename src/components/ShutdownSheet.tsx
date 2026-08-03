import { useState } from 'react'
import type { Task } from '../db/types'
import { updateTask } from '../db/repo'
import { deleteBlockForTask } from '../sync/calendar'
import { addDays, fromISODate, toISODate, todayISO } from '../lib/dates'
import { Sheet } from './Sheet'

// Večerní uzávěrka (Cal Newport „shutdown ritual"): nedokončené úkoly drží
// hlavu v práci, dokud nemají plán. Tady každému zbylému úkolu dáš osud —
// zítra / nechat / upravit — a den vědomě zavřeš. Odklad přes „Zítra" jde
// přes updateTask, takže se přirozeně počítá do postponeCount (signály).
export function ShutdownSheet({
  tasks,
  onOpenTask,
  onCloseDay,
  onClose,
}: {
  tasks: Task[]
  onOpenTask: (t: Task) => void
  onCloseDay: () => void
  onClose: () => void
}) {
  // „Nechám na dnes" — jen skryje řádek v tomhle otevření sheetu
  const [kept, setKept] = useState<Set<string>>(new Set())
  const pending = tasks.filter((t) => !kept.has(t.id))
  const tomorrow = toISODate(addDays(fromISODate(todayISO()), 1))

  const moveToTomorrow = (t: Task) => {
    // blok v kalendáři „Todo" patřil dnešku — uvolnit
    if (t.calendarEventId) void deleteBlockForTask(t)
    void updateTask(t.id, t.scheduledFor ? { scheduledFor: tomorrow } : { dueDate: tomorrow })
  }

  return (
    <Sheet onClose={onClose} className="space-y-4">
      {(close) => (
        <>
          <header>
            <h2 className="text-lg font-bold">Uzávěrka dne</h2>
            <p className="text-sm text-ink-soft">
              Projdi, co zbylo, ať to večer nenosíš v hlavě. Odklad není
              prohra — je to plán.
            </p>
          </header>

          {pending.length > 0 ? (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-well/60">
              {pending.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2.5">
                  <button className="min-w-0 flex-1 text-left" onClick={() => onOpenTask(t)}>
                    <span className="block truncate text-[15px]">{t.title}</span>
                  </button>
                  <button
                    onClick={() => setKept((s) => new Set(s).add(t.id))}
                    className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-medium text-ink-soft transition-transform duration-150 active:scale-95"
                  >
                    Nechat
                  </button>
                  <button
                    onClick={() => moveToTomorrow(t)}
                    className="shrink-0 rounded-full bg-accent-wash px-3 py-1 text-[13px] font-semibold text-accent-deep transition-transform duration-150 active:scale-95"
                  >
                    Zítra
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl bg-well px-3 py-3 text-sm text-ink-soft">
              Čisto — všechno má svůj den.
            </p>
          )}

          <div className="flex gap-2">
            {pending.length > 1 && (
              <button
                onClick={() => pending.forEach(moveToTomorrow)}
                className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-transform duration-150 active:scale-[0.98]"
              >
                Vše na zítra
              </button>
            )}
            <button
              onClick={() => {
                onCloseDay()
                close()
              }}
              className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-card transition-transform duration-150 active:scale-[0.98]"
            >
              Uzavřít den
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
