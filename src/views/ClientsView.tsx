import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Client, ClientKind, Task } from '../db/types'
import {
  activeClients,
  addClient,
  addProject,
  addTask,
  archivedClients,
  clientOpenTasks,
  clientProjects,
  completeTask,
  getClient,
  openTasks,
  removeClient,
  removeProject,
  reopenTask,
  sortTasks,
  updateClient,
} from '../db/repo'
import { activeTemplates, deployTemplate, undeployTemplate } from '../db/templates'
import {
  CHECK_FREQUENCY_LABELS,
  checkFrequencyOf,
  getClientCheckTask,
  setClientCheck,
  type CheckFrequency,
} from '../db/clientCheck'
import { CLIENT_COLORS, KIND_LABELS } from '../lib/labels'
import { daysSince, formatDayLabel } from '../lib/dates'
import { parseQuickAdd } from '../lib/quickAdd'
import { neglectedDays } from '../lib/signals'
import { TaskRow } from '../components/TaskRow'
import { TemplatesView } from './TemplatesView'

export function ClientsView({
  onOpenTask,
  focusClientId,
  onFocusConsumed,
}: {
  onOpenTask: (t: Task) => void
  focusClientId?: string | null
  onFocusConsumed?: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(focusClientId ?? null)
  const [showTemplates, setShowTemplates] = useState(false)

  useEffect(() => {
    if (focusClientId) {
      setSelectedId(focusClientId)
      setShowTemplates(false)
      onFocusConsumed?.()
    }
  }, [focusClientId, onFocusConsumed])

  if (selectedId) {
    return <ClientDetail id={selectedId} onBack={() => setSelectedId(null)} onOpenTask={onOpenTask} />
  }
  if (showTemplates) {
    return <TemplatesView onBack={() => setShowTemplates(false)} />
  }
  return <ClientList onSelect={setSelectedId} onTemplates={() => setShowTemplates(true)} />
}

function ClientList({
  onSelect,
  onTemplates,
}: {
  onSelect: (id: string) => void
  onTemplates: () => void
}) {
  const clients = useLiveQuery(activeClients, []) ?? []
  const archived = useLiveQuery(archivedClients, []) ?? []
  const open = useLiveQuery(openTasks, []) ?? []
  const [adding, setAdding] = useState(false)

  const counts = new Map<string, number>()
  for (const t of open) {
    if (t.clientId) counts.set(t.clientId, (counts.get(t.clientId) ?? 0) + 1)
  }

  const item = (c: Client) => (
    <li key={c.id}>
      <button
        onClick={() => onSelect(c.id)}
        className="flex w-full items-center gap-3 bg-card px-4 py-3 text-left transition-colors duration-150 active:bg-well/60"
      >
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{c.name}</span>
          <span className="text-xs text-ink-faint">{KIND_LABELS[c.kind]}</span>
        </span>
        {neglectedDays(c) !== null && (
          <span className="rounded-full bg-note px-2 py-0.5 text-xs font-semibold text-note-ink">
            ⚠ {neglectedDays(c)} dní
          </span>
        )}
        {(counts.get(c.id) ?? 0) > 0 && (
          <span className="rounded-full bg-well px-2 py-0.5 text-xs font-medium text-ink-soft">
            {counts.get(c.id)}
          </span>
        )}
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-faint/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </li>
  )

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between pr-12">
        <div>
          <h1 className="display text-[2.1rem] font-semibold leading-tight">Klienti</h1>
          <p className="text-sm text-ink-soft">Klienti i oblasti jako „Interní“ nebo „Osobní“</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            onClick={onTemplates}
            className="rounded-full border border-line bg-card px-3.5 py-2 text-sm font-medium text-ink-soft"
          >
            Šablony
          </button>
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded-full bg-accent px-3.5 py-2 text-sm font-medium text-card"
          >
            {adding ? 'Zavřít' : '+ Nový'}
          </button>
        </div>
      </header>

      {adding && <NewClientForm onDone={() => setAdding(false)} />}

      {clients.length === 0 && !adding && (
        <div className="rounded-2xl border border-dashed border-line bg-card/60 px-4 py-8 text-center text-sm text-ink-faint">
          Zatím žádní klienti. Začni tlačítkem „+ Nový“.
        </div>
      )}

      <ul className="rise divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">{clients.map(item)}</ul>

      {archived.length > 0 && (
        <section>
          <h2 className="mb-2 section-label">
            Archivované · {archived.length}
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card opacity-60 shadow-card">{archived.map(item)}</ul>
        </section>
      )}
    </div>
  )
}

function NewClientForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ClientKind>('client')
  const [color, setColor] = useState(CLIENT_COLORS[6])
  const [checkOn, setCheckOn] = useState(false)
  const [checkFreq, setCheckFreq] = useState<CheckFrequency>('weekly')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const client = await addClient({ name: name.trim(), kind, color })
    if (checkOn) await setClientCheck(client, checkFreq)
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-3 shadow-card">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Jméno klienta nebo oblasti"
        className="w-full rounded-lg border border-line px-3 py-2 text-[15px] outline-none focus:border-accent/60"
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as ClientKind)}
        className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[15px] outline-none focus:border-accent/60"
      >
        {(Object.keys(KIND_LABELS) as ClientKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        {CLIENT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Barva ${c}`}
            onClick={() => setColor(c)}
            className={`h-7 w-7 rounded-full ${color === c ? 'ring-2 ring-accent ring-offset-2' : ''}`}
            style={{ background: c }}
          />
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-line">
        <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5">
          <span className="text-[15px]">
            Pravidelná připomínka kontroly
            <span className="block text-xs text-ink-soft">
              Úkol „Zkontrolovat klienta“ se sám vrací na Dnes
            </span>
          </span>
          <input
            type="checkbox"
            checked={checkOn}
            onChange={(e) => setCheckOn(e.target.checked)}
            className="h-5 w-5 shrink-0"
          />
        </label>
        {checkOn && (
          <div className="border-t border-line px-3 py-2.5">
            <select
              value={checkFreq}
              onChange={(e) => setCheckFreq(e.target.value as CheckFrequency)}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[15px] outline-none focus:border-accent/60"
            >
              {(Object.keys(CHECK_FREQUENCY_LABELS) as CheckFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {CHECK_FREQUENCY_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={!name.trim()}
        className="w-full rounded-lg bg-accent py-2 text-sm font-medium text-card disabled:opacity-30"
      >
        Vytvořit
      </button>
    </form>
  )
}

function ClientDetail({
  id,
  onBack,
  onOpenTask,
}: {
  id: string
  onBack: () => void
  onOpenTask: (t: Task) => void
}) {
  const client = useLiveQuery(() => getClient(id), [id])
  const projects = useLiveQuery(() => clientProjects(id), [id]) ?? []
  const tasks = useLiveQuery(() => clientOpenTasks(id), [id]) ?? []
  const templates = useLiveQuery(activeTemplates, []) ?? []
  const checkTask = useLiveQuery(() => getClientCheckTask(id), [id])
  const [taskText, setTaskText] = useState('')
  const [projName, setProjName] = useState('')
  const [addingProject, setAddingProject] = useState(false)

  if (!client || client.deletedAt) return null

  const toggleTemplate = (templateId: string) => {
    void (client.templateIds.includes(templateId)
      ? undeployTemplate(id, templateId)
      : deployTemplate(id, templateId))
  }

  const setWatch = (value: string) => {
    const n = Number(value)
    void updateClient(id, { checkIntervalDays: n > 0 ? n : undefined })
  }

  const noProject = sortTasks(tasks.filter((t) => !t.projectId))

  const toggle = (t: Task) => {
    void (t.status === 'done' ? reopenTask(t.id) : completeTask(t.id))
  }

  const row = (t: Task) => (
    <TaskRow key={t.id} task={t} onToggle={toggle} onOpen={onOpenTask} />
  )

  const submitTask = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseQuickAdd(taskText, [])
    if (!parsed.title) return
    await addTask({
      title: parsed.title,
      dueDate: parsed.dueDate,
      priority: parsed.priority,
      clientId: id,
    })
    setTaskText('')
  }

  const submitProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projName.trim()) return
    await addProject({ clientId: id, name: projName.trim() })
    setProjName('')
    setAddingProject(false)
  }

  const archiveToggle = () => {
    void updateClient(id, { status: client.status === 'archived' ? 'active' : 'archived' })
  }

  const del = async () => {
    if (confirm(`Smazat klienta „${client.name}“ včetně projektů a úkolů?`)) {
      await removeClient(id)
      onBack()
    }
  }

  const delProject = async (projectId: string, name: string) => {
    if (confirm(`Smazat projekt „${name}“? Úkoly zůstanou pod klientem.`)) {
      await removeProject(projectId)
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-medium text-accent">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Klienti
      </button>

      <header className="flex items-center gap-3 pr-10">
        <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: client.color }} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate display text-[2.1rem] font-semibold leading-tight">{client.name}</h1>
          <p className="text-sm text-ink-soft">
            {KIND_LABELS[client.kind]}
            {client.status === 'archived' && ' · archivovaný'}
          </p>
        </div>
      </header>

      <form onSubmit={submitTask} className="flex gap-2">
        <input
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
          placeholder="Nový úkol (např. „zítra kontrola kampaní“)"
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-[15px] outline-none focus:border-accent/60"
        />
        <button
          type="submit"
          disabled={!taskText.trim()}
          className="rounded-lg bg-accent px-3 text-sm font-medium text-card disabled:opacity-30"
        >
          Přidat
        </button>
      </form>

      {templates.length > 0 && (
        <section>
          <h2 className="mb-2 section-label">Šablony</h2>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => {
              const deployed = client.templateIds.includes(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => toggleTemplate(t.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    deployed
                      ? 'bg-accent text-card'
                      : 'border border-line bg-card text-ink-soft'
                  }`}
                >
                  {deployed ? '✓ ' : '+ '}
                  {t.name}
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="text-sm">
            <div className="font-medium">Pravidelná kontrola</div>
            <div className="text-xs text-ink-faint">
              {checkTask?.dueDate
                ? `Příště ${formatDayLabel(checkTask.dueDate).toLowerCase()}`
                : 'Připomínka se vrací sama na Dnes'}
            </div>
          </div>
          <select
            value={checkFrequencyOf(checkTask) ?? ''}
            onChange={(e) =>
              void setClientCheck(client, (e.target.value || null) as CheckFrequency | null)
            }
            className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-accent/60"
          >
            <option value="">Vypnuto</option>
            {(Object.keys(CHECK_FREQUENCY_LABELS) as CheckFrequency[]).map((f) => (
              <option key={f} value={f}>
                {CHECK_FREQUENCY_LABELS[f]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="text-sm">
            <div className="font-medium">Hlídat zanedbání</div>
            <div className="text-xs text-ink-faint">
              {client.lastActivityAt
                ? `Poslední aktivita před ${daysSince(client.lastActivityAt)} dny`
                : 'Zatím žádná aktivita'}
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-sm text-ink-soft">
            po
            <input
              type="number"
              min="0"
              inputMode="numeric"
              defaultValue={client.checkIntervalDays ?? ''}
              onBlur={(e) => setWatch(e.target.value)}
              className="w-16 rounded-lg border border-line px-2 py-1.5 text-center text-[15px] outline-none focus:border-accent/60"
            />
            dnech
          </label>
        </div>
      </section>

      {noProject.length > 0 && (
        <section>
          <h2 className="mb-2 section-label">Úkoly</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">{noProject.map(row)}</ul>
        </section>
      )}

      {projects.map((p) => {
        const projectTasks = sortTasks(tasks.filter((t) => t.projectId === p.id))
        return (
          <section key={p.id}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="section-label">
                {p.name}
                {p.goal && <span className="ml-2 font-normal normal-case text-ink-faint">{p.goal}</span>}
              </h2>
              <button className="text-xs text-ink-faint/70" onClick={() => void delProject(p.id, p.name)}>
                Smazat
              </button>
            </div>
            {projectTasks.length > 0 ? (
              <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">{projectTasks.map(row)}</ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-line px-3 py-3 text-xs text-ink-faint">
                Zatím bez úkolů — přiřaď je úkolu v detailu.
              </p>
            )}
          </section>
        )
      })}

      {addingProject ? (
        <form onSubmit={submitProject} className="flex gap-2">
          <input
            autoFocus
            value={projName}
            onChange={(e) => setProjName(e.target.value)}
            placeholder="Název projektu"
            className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-[15px] outline-none focus:border-accent/60"
          />
          <button
            type="submit"
            disabled={!projName.trim()}
            className="rounded-lg bg-accent px-3 text-sm font-medium text-card disabled:opacity-30"
          >
            OK
          </button>
        </form>
      ) : (
        <button onClick={() => setAddingProject(true)} className="text-sm font-medium text-accent">
          + Nový projekt
        </button>
      )}

      <footer className="flex gap-4 border-t border-line pt-4">
        <button onClick={archiveToggle} className="text-sm font-medium text-ink-soft">
          {client.status === 'archived' ? 'Obnovit' : 'Archivovat'}
        </button>
        <button onClick={() => void del()} className="text-sm font-medium text-danger">
          Smazat klienta
        </button>
      </footer>
    </div>
  )
}
