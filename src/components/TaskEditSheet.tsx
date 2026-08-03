import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Priority, Project, Task } from '../db/types'
import { activeClients, clientProjects, removeTask, updateTask } from '../db/repo'
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

const field = 'w-full rounded-lg border border-line bg-card px-3 py-2 text-[15px] outline-none focus:border-accent/60'
const label = 'mb-1 block text-xs font-medium text-ink-soft'

export function TaskEditSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [clientId, setClientId] = useState(task.clientId ?? '')
  const [projectId, setProjectId] = useState(task.projectId ?? '')
  const [priority, setPriority] = useState<Priority>(task.priority)
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [scheduledFor, setScheduledFor] = useState(task.scheduledFor ?? '')
  // 'none' | předvolba | 'custom' (existující pravidlo mimo předvolby zachovat)
  const initialRecurrence = task.recurrenceRule ? presetFromRule(task.recurrenceRule) : 'none'
  const [recurrence, setRecurrence] = useState<string>(initialRecurrence)

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
        <header>
          <h2 className="text-lg font-bold">Upravit úkol</h2>
        </header>
        <div>
          <label className={label}>Úkol</label>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Klient</label>
            <select
              className={field}
              value={clientId}
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
              disabled={!clientId}
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
            <input type="date" className={field} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
            <select className={field} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
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
