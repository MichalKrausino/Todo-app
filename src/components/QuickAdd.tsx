import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { activeClients, addTask } from '../db/repo'
import { formatDayLabel } from '../lib/dates'
import { PRIORITY_LABELS } from '../lib/labels'
import { parseQuickAdd } from '../lib/quickAdd'
import { humanizeRule } from '../lib/rrule'

export function QuickAdd() {
  const [text, setText] = useState('')
  const clients = useLiveQuery(activeClients, []) ?? []

  const parsed = useMemo(
    () => (text.trim() ? parseQuickAdd(text, clients) : null),
    [text, clients],
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed || !parsed.title) return
    await addTask({
      title: parsed.title,
      dueDate: parsed.dueDate,
      clientId: parsed.clientId,
      priority: parsed.priority,
      recurrenceRule: parsed.recurrenceRule,
    })
    setText('')
  }

  const client = parsed?.clientId ? clients.find((c) => c.id === parsed.clientId) : undefined
  const chip = 'rounded-full px-2.5 py-0.5 font-medium'

  return (
    <div className="px-3 pt-2.5">
      {parsed && (parsed.dueDate || client || parsed.priority !== 'normal' || parsed.recurrenceRule) && (
        <div className="rise flex flex-wrap gap-1.5 px-1 pb-2 text-[11px]">
          {parsed.dueDate && (
            <span className={`${chip} bg-accent-wash text-accent-deep`}>
              {formatDayLabel(parsed.dueDate)}
            </span>
          )}
          {parsed.recurrenceRule && (
            <span className={`${chip} bg-accent-wash text-accent-deep`}>
              ↻ {humanizeRule(parsed.recurrenceRule)}
            </span>
          )}
          {client && (
            <span className={`${chip} inline-flex items-center gap-1.5 bg-well text-ink-soft`}>
              <span className="h-2 w-2 rounded-full" style={{ background: client.color }} />
              {client.name}
            </span>
          )}
          {parsed.priority !== 'normal' && (
            <span className={`${chip} bg-well text-ink-soft`}>{PRIORITY_LABELS[parsed.priority]}</span>
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
        <button
          type="submit"
          aria-label="Přidat úkol"
          disabled={!parsed?.title}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-card shadow-float transition-transform duration-150 active:scale-90 disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </form>
    </div>
  )
}
