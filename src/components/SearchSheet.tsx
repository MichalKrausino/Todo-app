import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Task } from '../db/types'
import { allClients, allProjects, allTasks } from '../db/repo'
import { formatDayLabel } from '../lib/dates'
import { Sheet } from './Sheet'

// Globální vyhledávání: úkoly (i hotové), klienti a projekty na jednom
// místě, bez ohledu na diakritiku. Úkol se otevře v detailu (panel se
// vrství nad vyhledávání, kontext hledání zůstává), klient/projekt
// naviguje na záložku Klienti a vyhledávání zavře.

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

// Nejbližší relevantní den úkolu — dřívější z „naplánováno“ a „termín“.
const effDate = (t: Task) =>
  [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d)).sort()[0]

const LIMIT_TASKS = 20

export function SearchSheet({
  onClose,
  onOpenTask,
  onOpenClient,
}: {
  onClose: () => void
  onOpenTask: (t: Task) => void
  onOpenClient: (clientId: string) => void
}) {
  const [q, setQ] = useState('')
  const tasks = useLiveQuery(allTasks, []) ?? []
  const clients = useLiveQuery(allClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []
  const clientMap = new Map(clients.map((c) => [c.id, c]))

  const needle = fold(q.trim())
  const results = useMemo(() => {
    if (needle.length < 2) return null
    const hitTasks = tasks
      .filter((t) => fold(t.title).includes(needle) || (t.notes && fold(t.notes).includes(needle)))
      .sort((a, b) => {
        // rozdělané před hotovými; rozdělané podle nejbližšího dne,
        // hotové od nejčerstvějších
        const ad = a.status === 'done' ? 1 : 0
        const bd = b.status === 'done' ? 1 : 0
        if (ad !== bd) return ad - bd
        if (ad === 1) return (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
        return (effDate(a) ?? '9999').localeCompare(effDate(b) ?? '9999')
      })
    const hitClients = clients.filter((c) => fold(c.name).includes(needle))
    const hitProjects = projects.filter((p) => fold(p.name).includes(needle))
    return { tasks: hitTasks, clients: hitClients, projects: hitProjects }
  }, [needle, tasks, clients, projects])

  const empty =
    results && results.tasks.length === 0 && results.clients.length === 0 && results.projects.length === 0

  return (
    <Sheet onClose={onClose} tone="paper" className="min-h-[70dvh] space-y-4">
      {(close) => (
        <>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hledat úkoly, klienty, projekty…"
            className="mt-2 w-full rounded-full border border-transparent bg-well px-4 py-2.5 text-[16px] text-ink outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent/50 focus:bg-card"
          />

          {!results && (
            <p className="px-1 text-[13px] text-ink-faint">
              Prohledává názvy i poznámky, bez ohledu na diakritiku. Napiš aspoň dvě písmena.
            </p>
          )}
          {empty && <p className="px-1 text-[13px] text-ink-faint">Nic nenalezeno.</p>}

          {results && results.clients.length > 0 && (
            <section className="rise">
              <h2 className="section-label mb-2">klienti</h2>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
                {results.clients.map((c) => (
                  <li key={c.id}>
                    <button
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors duration-150 active:bg-well/60"
                      onClick={() => {
                        close()
                        onOpenClient(c.id)
                      }}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                      <span className="min-w-0 flex-1 truncate text-[16px] text-ink">{c.name}</span>
                      {c.status !== 'active' && (
                        <span className="text-[12px] text-ink-faint">
                          {c.status === 'archived' ? 'archiv' : 'pauza'}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results && results.projects.length > 0 && (
            <section className="rise">
              <h2 className="section-label mb-2">projekty</h2>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
                {results.projects.map((p) => {
                  const c = clientMap.get(p.clientId)
                  return (
                    <li key={p.id}>
                      <button
                        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors duration-150 active:bg-well/60"
                        onClick={() => {
                          close()
                          onOpenClient(p.clientId)
                        }}
                      >
                        <span className="text-ink-faint">▸</span>
                        <span className="min-w-0 flex-1 truncate text-[16px] text-ink">{p.name}</span>
                        {c && (
                          <span className="inline-flex max-w-32 items-center gap-1.5 truncate text-[12px] text-ink-soft">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
                            {c.name}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {results && results.tasks.length > 0 && (
            <section className="rise">
              <h2 className="section-label mb-2">úkoly · {results.tasks.length}</h2>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
                {results.tasks.slice(0, LIMIT_TASKS).map((t) => {
                  const c = t.clientId ? clientMap.get(t.clientId) : undefined
                  const done = t.status === 'done'
                  const day = effDate(t)
                  return (
                    <li key={t.id}>
                      <button
                        className="w-full px-4 py-3 text-left transition-colors duration-150 active:bg-well/60"
                        onClick={() => onOpenTask(t)}
                      >
                        <div className={`text-[16px] leading-snug ${done ? 'text-ink-faint line-through' : 'text-ink'}`}>
                          {t.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px]">
                          {done && <span className="text-moss">✓ hotovo</span>}
                          {c && (
                            <span className="inline-flex items-center gap-1.5 text-ink-soft">
                              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                              {c.name}
                            </span>
                          )}
                          {!done && day && <span className="text-ink-soft">{formatDayLabel(day)}</span>}
                          {!done && t.dueTime && <span className="text-ink-soft">do {t.dueTime}</span>}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {results.tasks.length > LIMIT_TASKS && (
                <p className="mt-1.5 px-1 text-[12px] text-ink-faint">
                  Zobrazeno prvních {LIMIT_TASKS} — upřesni hledání.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </Sheet>
  )
}
