import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { activeClients, addTask, allProjects, removeTask } from '../db/repo'
import { formatDayLabel, todayISO } from '../lib/dates'
import { PRIORITY_LABELS } from '../lib/labels'
import { foldToken, mentionToken, parseQuickAdd } from '../lib/quickAdd'
import { humanizeRule } from '../lib/rrule'

// Rozepsaný @klient / #projekt na konci textu → našeptávač nad polem.
const RE_MENTION = /(^|\s)([@#])(\S*)$/

// defaultToToday: na obrazovce Dnes jde úkol bez data na dnešek (scheduledFor)
// — kdo píše na Dnes, myslí „udělám to dnes". Jinde bez data → inbox.
export function QuickAdd({
  onShowUpcoming,
  defaultToToday = false,
}: {
  onShowUpcoming?: () => void
  defaultToToday?: boolean
}) {
  const [text, setText] = useState('')
  // Počítadlo přidaných úkolů — mění key tlačítka, takže po každém
  // přidání proběhne potvrzovací pop (hmatová odezva bez haptiky).
  const [addedCount, setAddedCount] = useState(0)
  // Pojistka proti špatnému parsování: pár vteřin po přidání jde úkol vrátit.
  // dueDate říká, kam úkol šel — bez termínu skončil v inboxu (Plán),
  // což bez vysvětlení vypadá, jako by se nic nestalo.
  const [lastAdded, setLastAdded] = useState<{ id: string; title: string; dueDate?: string } | null>(
    null,
  )
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const clients = useLiveQuery(activeClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []

  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const parsed = useMemo(
    () => (text.trim() ? parseQuickAdd(text, clients, new Date(), projects) : null),
    [text, clients, projects],
  )

  // Našeptávač: fragment za @/# na konci textu, nabídka podle prefixu.
  const mention = useMemo(() => {
    const m = RE_MENTION.exec(text)
    if (!m) return null
    const kind = m[2] === '@' ? ('client' as const) : ('project' as const)
    const frag = foldToken(m[3])
    const pool =
      kind === 'client'
        ? clients.map((c) => ({ id: c.id, name: c.name, color: c.color as string | undefined }))
        : (parsed?.clientId ? projects.filter((p) => p.clientId === parsed.clientId) : projects).map(
            (p) => ({ id: p.id, name: p.name, color: undefined as string | undefined }),
          )
    const items = pool.filter((x) => foldToken(x.name).startsWith(frag)).slice(0, 4)
    if (items.length === 0) return null
    // jediná shoda, která už je dopsaná celá → nabídka by jen překážela
    if (items.length === 1 && foldToken(items[0].name) === frag) return null
    return { start: m.index + m[1].length, marker: m[2], items }
  }, [text, clients, projects, parsed?.clientId])

  const pickMention = (name: string) => {
    if (!mention) return
    setText(text.slice(0, mention.start) + mention.marker + mentionToken(name) + ' ')
  }

  // Na Dnes dostane úkol bez data plán na dnešek — vidět předem jako chip.
  const impliedToday = Boolean(
    defaultToToday && parsed && !parsed.dueDate && !parsed.recurrenceRule,
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed || !parsed.title) return
    const task = await addTask({
      title: parsed.title,
      dueDate: parsed.dueDate,
      scheduledFor: impliedToday ? todayISO() : undefined,
      clientId: parsed.clientId,
      projectId: parsed.projectId,
      priority: parsed.priority,
      recurrenceRule: parsed.recurrenceRule,
      notes: parsed.notes,
    })
    setText('')
    setAddedCount((n) => n + 1)
    setLastAdded({ id: task.id, title: task.title, dueDate: task.scheduledFor ?? task.dueDate })
    clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setLastAdded(null), 6000)
  }

  const undo = async () => {
    if (!lastAdded) return
    clearTimeout(undoTimer.current)
    await removeTask(lastAdded.id)
    setLastAdded(null)
  }

  const client = parsed?.clientId ? clients.find((c) => c.id === parsed.clientId) : undefined
  const chip = 'rounded-full px-2.5 py-0.5 font-medium'

  return (
    <div className="relative px-3 pt-2.5">
      {lastAdded && (
        <div className="pointer-events-none absolute inset-x-0 -top-12 z-30 flex justify-center">
          <div className="pop pointer-events-auto flex items-center gap-2 rounded-full bg-ink/90 py-1.5 pl-4 pr-1.5 shadow-float backdrop-blur">
            <span className="max-w-48 truncate text-[13px] text-paper">
              {lastAdded.dueDate
                ? `${formatDayLabel(lastAdded.dueDate)} — „${lastAdded.title}“`
                : `Do inboxu — „${lastAdded.title}“`}
            </span>
            {!lastAdded.dueDate && onShowUpcoming && (
              <button
                onClick={() => {
                  setLastAdded(null)
                  onShowUpcoming()
                }}
                className="rounded-full bg-paper/15 px-3 py-1 text-[13px] font-semibold text-paper transition-transform duration-150 active:scale-95"
              >
                Zobrazit
              </button>
            )}
            <button
              onClick={() => void undo()}
              className="rounded-full bg-paper/15 px-3 py-1 text-[13px] font-semibold text-paper transition-transform duration-150 active:scale-95"
            >
              Zpět
            </button>
          </div>
        </div>
      )}

      {mention && (
        <div className="rise -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" style={{ scrollbarWidth: 'none' }}>
          {mention.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onPointerDown={(e) => e.preventDefault() /* nebrat fokus inputu */}
              onClick={() => pickMention(item.name)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-well px-3 py-1.5 text-[13px] font-medium text-ink transition-transform duration-150 active:scale-95"
            >
              {item.color && <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />}
              {item.name}
            </button>
          ))}
        </div>
      )}

      {parsed && (parsed.dueDate || impliedToday || client || parsed.projectId || parsed.priority !== 'normal' || parsed.recurrenceRule || parsed.notes) && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2 text-[11px]">
          {(parsed.dueDate || impliedToday) && (
            <span key={`d:${parsed.dueDate ?? 'dnes'}`} className={`${chip} pop-soft inline-block bg-accent-wash text-accent-deep`}>
              {formatDayLabel(parsed.dueDate ?? todayISO())}
            </span>
          )}
          {parsed.recurrenceRule && (
            <span key={`r:${parsed.recurrenceRule}`} className={`${chip} pop-soft inline-block bg-accent-wash text-accent-deep`}>
              ↻ {humanizeRule(parsed.recurrenceRule)}
            </span>
          )}
          {/* při rozepsaném @/# chip skrýt — našeptávač by ho jen zdvojoval */}
          {client && mention?.marker !== '@' && (
            <span key={`c:${client.id}`} className={`${chip} pop-soft inline-flex items-center gap-1.5 bg-well text-ink-soft`}>
              <span className="h-2 w-2 rounded-full" style={{ background: client.color }} />
              {client.name}
            </span>
          )}
          {parsed.projectName && mention?.marker !== '#' && (
            <span key={`j:${parsed.projectId}`} className={`${chip} pop-soft inline-block bg-well text-ink-soft`}>
              ▸ {parsed.projectName}
            </span>
          )}
          {parsed.priority !== 'normal' && (
            <span key={`p:${parsed.priority}`} className={`${chip} pop-soft inline-block bg-well text-ink-soft`}>
              {PRIORITY_LABELS[parsed.priority]}
            </span>
          )}
          {parsed.notes && (
            <span key="n" className={`${chip} pop-soft inline-block max-w-40 truncate bg-well text-ink-soft`}>
              ✎ {parsed.notes}
            </span>
          )}
        </div>
      )}
      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Např. „ve čtvrtek poslat report @klient !vysoká“"
          enterKeyHint="done"
          className="min-w-0 flex-1 rounded-full border border-transparent bg-well px-4 py-2.5 text-[15px] text-ink outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent/50 focus:bg-card"
        />
        {/* key po přidání → pop; plus se při stisku pootočí (group-active) */}
        <button
          key={addedCount}
          type="submit"
          aria-label="Přidat úkol"
          disabled={!parsed?.title}
          className={`group flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-card shadow-float transition-transform duration-150 active:scale-90 disabled:opacity-30 ${
            addedCount > 0 ? 'pop' : ''
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 transition-transform duration-300 ease-spring group-active:rotate-90" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </form>
    </div>
  )
}
