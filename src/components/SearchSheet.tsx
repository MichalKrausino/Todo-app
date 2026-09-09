import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Task } from '../db/types'
import { allClients, allProjects, allTasks } from '../db/repo'
import { formatDayLabel } from '../lib/dates'
import { Sheet } from './Sheet'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from './ui/Command'
import { Kbd } from './ui/Kbd'

// Hledání jako příkazová paleta (cmdk ze shadcn/ui): úkoly (i hotové),
// klienti a projekty na jednom místě, bez ohledu na diakritiku, a než
// člověk začne psát, nabídne rychlé akce — na Macu je to ⌘K jako
// v Linearu, na iPhonu totéž hledání s lupou. Šipky a Enter obstará
// cmdk, filtr si appka dělá sama (cmdk diakritiku neskládá). Úkol se
// otevře v detailu (panel se vrství nad paletu, kontext hledání zůstává),
// klient/projekt naviguje na záložku Klienti a paletu zavře.

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// Nejbližší relevantní den úkolu — dřívější z „naplánováno“ a „termín“.
const effDate = (t: Task) =>
  [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d)).sort()[0]

const LIMIT_TASKS = 20

export type RychlaAkce = 'novy' | 'dnes' | 'plan' | 'klienti' | 'ohlednuti' | 'sync'

const AKCE: Array<{ id: RychlaAkce; popisek: string; klavesa?: string }> = [
  { id: 'novy', popisek: 'Nový úkol', klavesa: 'N' },
  { id: 'dnes', popisek: 'Dnes', klavesa: '1' },
  { id: 'plan', popisek: 'Plán', klavesa: '2' },
  { id: 'klienti', popisek: 'Klienti', klavesa: '3' },
  { id: 'ohlednuti', popisek: 'Týdenní ohlédnutí' },
  { id: 'sync', popisek: 'Synchronizace a nastavení' },
]

export function SearchSheet({
  onClose,
  onOpenTask,
  onOpenClient,
  onAkce,
}: {
  onClose: () => void
  onOpenTask: (t: Task) => void
  onOpenClient: (clientId: string) => void
  onAkce?: (akce: RychlaAkce) => void
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

  // Rychlé akce se filtrují taky — „ohl" najde ohlédnutí i s jedním písmenem.
  const akce = AKCE.filter((a) => !needle || fold(a.popisek).includes(needle))

  const empty =
    results && results.tasks.length === 0 && results.clients.length === 0 && results.projects.length === 0 && akce.length === 0

  return (
    <Sheet onClose={onClose} tone="paper" className="min-h-[70dvh]">
      {(close) => (
        <Command label="Hledání a rychlé akce" className="space-y-4">
          <CommandInput
            aria-label="Hledat v úkolech, klientech a projektech"
            autoFocus
            value={q}
            onValueChange={setQ}
            placeholder="Hledat úkoly, klienty, projekty…"
            className="mt-2"
          />

          {!results && (
            <p className="px-1 text-[13px] text-ink-faint">
              Prohledává názvy i poznámky, bez ohledu na diakritiku. Napiš aspoň dvě písmena.
            </p>
          )}

          <CommandList className="max-h-[calc(var(--vvh,100dvh)-12rem)]">
            {empty && <CommandEmpty>Nic nenalezeno.</CommandEmpty>}

            {onAkce && akce.length > 0 && (
              <CommandGroup heading="rychlé akce">
                {akce.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`akce-${a.id}`}
                    onSelect={() => {
                      close()
                      onAkce(a.id)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate text-[16px] text-ink">{a.popisek}</span>
                    {a.klavesa && (
                      <CommandShortcut className="hidden [@media(pointer:fine)]:inline-flex">
                        <Kbd>{a.klavesa}</Kbd>
                      </CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results && results.clients.length > 0 && (
              <CommandGroup heading="klienti">
                {results.clients.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`klient-${c.id}`}
                    onSelect={() => {
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
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results && results.projects.length > 0 && (
              <CommandGroup heading="projekty">
                {results.projects.map((p) => {
                  const c = clientMap.get(p.clientId)
                  return (
                    <CommandItem
                      key={p.id}
                      value={`projekt-${p.id}`}
                      onSelect={() => {
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
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            {results && results.tasks.length > 0 && (
              <CommandGroup heading={`úkoly · ${results.tasks.length}`}>
                {results.tasks.slice(0, LIMIT_TASKS).map((t) => {
                  const c = t.clientId ? clientMap.get(t.clientId) : undefined
                  const done = t.status === 'done'
                  const day = effDate(t)
                  return (
                    <CommandItem key={t.id} value={`ukol-${t.id}`} onSelect={() => onOpenTask(t)} className="block">
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
                    </CommandItem>
                  )
                })}
                {results.tasks.length > LIMIT_TASKS && (
                  <p className="px-4 py-2 text-[12px] text-ink-faint">
                    Zobrazeno prvních {LIMIT_TASKS} — upřesni hledání.
                  </p>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      )}
    </Sheet>
  )
}
