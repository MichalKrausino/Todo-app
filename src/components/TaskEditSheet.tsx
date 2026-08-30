import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Priority, Project, Subtask, Task } from '../db/types'
import { MAX_PINNED, activeClients, clientProjects, removeTask, togglePinned, updateTask } from '../db/repo'
import { Sheet } from './Sheet'
import { deleteBlockForTask } from '../sync/calendar'
import { todayISO } from '../lib/dates'
import { PRIORITY_LABELS } from '../lib/labels'
import {
  PRESET_LABELS,
  humanizeRule,
  presetFromRule,
  ruleFromPreset,
  type RecurrencePreset,
} from '../lib/rrule'

const field = 'w-full rounded-lg border border-line bg-card px-3 py-2 text-[16px] outline-none focus:border-accent/60 disabled:bg-well disabled:text-ink-soft'
const label = 'mb-1 block text-xs font-medium text-ink-soft'

export function TaskEditSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [clientId, setClientId] = useState(task.clientId ?? '')
  const [projectId, setProjectId] = useState(task.projectId ?? '')
  const [priority, setPriority] = useState<Priority>(task.priority)
  // Importovaný úkol: název, zařazení, termín a priorita patří Todoistu.
  // Ruční úprava by při dalším stažení stejně zmizela, tak radši zamčeno.
  const fromTodoist = Boolean(task.todoistId)
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [dueTime, setDueTime] = useState(task.dueTime ?? '')
  const [scheduledFor, setScheduledFor] = useState(task.scheduledFor ?? '')
  // 'none' | předvolba | 'custom' (existující pravidlo mimo předvolby zachovat)
  const initialRecurrence = task.recurrenceRule ? presetFromRule(task.recurrenceRule) : 'none'
  const [recurrence, setRecurrence] = useState<string>(initialRecurrence)
  // Checklist se ukládá hned při každé změně (jako iOS Připomínky) —
  // odškrtnutí podúkolu nesmí čekat na „Uložit". Save ho neposílá,
  // Dexie update mění jen zaslaná pole.
  const [subtasks, setSubtasks] = useState<Subtask[]>(task.subtasks ?? [])
  const [newSub, setNewSub] = useState('')
  // Špendlík „Top 3 dne" se ukládá hned (jako checklist) — je to
  // rozhodnutí o dnešku, ne editace, kterou by šlo zahodit přes Zrušit.
  const [pinnedFor, setPinnedFor] = useState(task.pinnedFor)
  const [pinFull, setPinFull] = useState(false)

  const pinToday = async () => {
    const day = todayISO()
    const okPin = await togglePinned(task.id, day)
    if (!okPin) {
      setPinFull(true)
      setTimeout(() => setPinFull(false), 2600)
      return
    }
    setPinnedFor(pinnedFor === day ? undefined : day)
  }

  const persistSubtasks = (list: Subtask[]) => {
    setSubtasks(list)
    void updateTask(task.id, { subtasks: list })
  }

  const addSubtask = () => {
    const title = newSub.trim()
    if (!title) return
    persistSubtasks([...subtasks, { id: crypto.randomUUID(), title, done: false }])
    setNewSub('')
  }

  const clients = useLiveQuery(activeClients, []) ?? []
  const projects =
    useLiveQuery(
      () => (clientId ? clientProjects(clientId) : Promise.resolve<Project[]>([])),
      [clientId],
    ) ?? []

  const save = async (close: () => void) => {
    if (!title.trim()) return
    const hasDate = Boolean(dueDate || scheduledFor)
    let recurrenceRule: string | undefined
    if (recurrence === 'custom') recurrenceRule = task.recurrenceRule
    else if (recurrence !== 'none') {
      recurrenceRule = ruleFromPreset(recurrence as RecurrencePreset, dueDate || scheduledFor || todayISO())
    }
    await updateTask(task.id, {
      title: title.trim(),
      notes: notes.trim() || undefined,
      clientId: clientId || undefined,
      projectId: projectId || undefined,
      priority,
      dueDate: dueDate || undefined,
      // čas bez data nedává smysl — deadline s časem se váže na den
      dueTime: dueDate && dueTime ? dueTime : undefined,
      scheduledFor: scheduledFor || undefined,
      recurrenceRule,
      status: task.status === 'inbox' && hasDate ? 'active' : task.status,
    })
    // Zrušené naplánování uvolní i blok v kalendáři „Todo".
    if (task.calendarEventId && !scheduledFor) void deleteBlockForTask(task)
    close()
  }

  const del = async (close: () => void) => {
    if (confirm('Smazat úkol?')) {
      if (task.calendarEventId) void deleteBlockForTask(task)
      await removeTask(task.id)
      close()
    }
  }

  return (
    <Sheet onClose={onClose} className="space-y-3">
      {(close) => (
        <>
        <header className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">Upravit úkol</h2>
          <button
            type="button"
            aria-label={pinnedFor === todayISO() ? 'Odepnout z Top 3 dne' : 'Připnout mezi Top 3 dne'}
            onClick={() => void pinToday()}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-[background-color,color,transform] duration-150 active:scale-95 ${
              pinnedFor === todayISO() ? 'bg-accent text-card' : 'bg-well text-ink-soft'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3.5h6l-.8 5.2 3.3 3.1H6.5l3.3-3.1z" />
              <path d="M12 11.8V20.5" />
            </svg>
            {pinnedFor === todayISO() ? 'Top 3 dne' : 'Připnout'}
          </button>
        </header>
        {pinFull && (
          <p className="pop rounded-lg bg-note px-3 py-2 text-[13px] text-note-ink">
            Top {MAX_PINNED} je plná — nejdřív něco odepni. Míň priorit, víc hotovo.
          </p>
        )}
        {fromTodoist && (
          <p className="rounded-lg bg-well px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
            Úkol je z Todoistu. Název, zařazení, termín a priorita se řídí tam —
            tady se dá naplánovat den, připnout do Top 3 a odškrtnout.
          </p>
        )}
        <div>
          <label className={label}>Úkol</label>
          <input
            className={field}
            value={title}
            disabled={fromTodoist}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Klient</label>
            <select
              className={field}
              value={clientId}
              disabled={fromTodoist}
              onChange={(e) => {
                setClientId(e.target.value)
                setProjectId('')
              }}
            >
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Projekt</label>
            <select
              className={field}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={fromTodoist || !clientId}
            >
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Termín (dokdy)</label>
            <input
              type="date"
              className={field}
              value={dueDate}
              disabled={fromTodoist}
              onChange={(e) => setDueDate(e.target.value)}
            />
            {/* čas patří k termínu — bez popisku vypadal jako osiřelé pole */}
            <label className="mt-1.5 flex items-center gap-2">
              <span className="shrink-0 text-xs font-medium text-ink-soft">Čas</span>
              <input
                type="time"
                aria-label="Čas termínu"
                className={`${field} min-w-0 flex-1`}
                value={dueTime}
                disabled={fromTodoist}
                onChange={(e) => {
                  setDueTime(e.target.value)
                  // čas na prázdném datu doplní dnešek, ať se neztratí
                  if (e.target.value && !dueDate) setDueDate(todayISO())
                }}
              />
            </label>
          </div>
          <div>
            <label className={label}>Naplánováno na</label>
            <input
              type="date"
              className={field}
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Priorita</label>
            <select
              className={field}
              value={priority}
              disabled={fromTodoist}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Opakování</label>
            <select className={field} value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
              <option value="none">Neopakuje se</option>
              {(Object.keys(PRESET_LABELS) as RecurrencePreset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
              {initialRecurrence === 'custom' && task.recurrenceRule && (
                <option value="custom">Vlastní ({humanizeRule(task.recurrenceRule)})</option>
              )}
            </select>
          </div>
        </div>

        <div>
          <label className={label}>
            Podúkoly
            {subtasks.length > 0 && ` · ${subtasks.filter((s) => s.done).length}/${subtasks.length}`}
          </label>
          {subtasks.length > 0 && (
            <ul className="mb-1.5 divide-y divide-line overflow-hidden rounded-lg border border-line">
              {subtasks.map((s) => (
                <li key={s.id} className="flex items-center gap-2.5 bg-card px-3 py-2">
                  <button
                    type="button"
                    aria-label={s.done ? `Vrátit podúkol ${s.title}` : `Dokončit podúkol ${s.title}`}
                    onClick={() =>
                      persistSubtasks(
                        subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)),
                      )
                    }
                    className="-m-1.5 shrink-0 p-1.5 transition-transform duration-150 active:scale-90"
                  >
                    <span
                      key={String(s.done)}
                      className={`pop flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-200 ${
                        s.done ? 'border-accent bg-accent text-card' : 'border-ink-faint text-transparent'
                      }`}
                    >
                      <svg viewBox="0 0 20 20" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4.5 10.5l3.8 3.8 7.2-8.6" />
                      </svg>
                    </span>
                  </button>
                  <span
                    className={`min-w-0 flex-1 truncate text-[14px] ${
                      s.done ? 'text-ink-faint line-through' : 'text-ink'
                    }`}
                  >
                    {s.title}
                  </span>
                  <button
                    type="button"
                    aria-label={`Smazat podúkol ${s.title}`}
                    onClick={() => persistSubtasks(subtasks.filter((x) => x.id !== s.id))}
                    className="-m-1 shrink-0 p-1 text-ink-faint transition-transform duration-150 active:scale-90"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1.5">
            <input
              className={`${field} min-w-0 flex-1`}
              placeholder="Přidat podúkol…"
              value={newSub}
              enterKeyHint="done"
              onChange={(e) => setNewSub(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSubtask()
                }
              }}
            />
            <button
              type="button"
              aria-label="Přidat podúkol"
              disabled={!newSub.trim()}
              onClick={addSubtask}
              className="flex w-10 shrink-0 items-center justify-center rounded-lg bg-well text-ink-soft transition-transform duration-150 active:scale-90 disabled:opacity-30"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>

        <div>
          <label className={label}>Poznámky</label>
          <textarea className={field} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            className="px-2 py-2 text-sm font-medium text-danger transition-transform duration-150 active:scale-95"
            onClick={() => void del(close)}
          >
            Smazat
          </button>
          <div className="flex gap-2">
            <button
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-soft transition-transform duration-150 active:scale-95"
              onClick={close}
            >
              Zrušit
            </button>
            <button
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-card transition-transform duration-150 active:scale-95 disabled:opacity-30"
              disabled={!title.trim()}
              onClick={() => void save(close)}
            >
              Uložit
            </button>
          </div>
        </div>
        </>
      )}
    </Sheet>
  )
}
