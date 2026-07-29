import { useState } from 'react'
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
import { CLIENT_COLORS, KIND_LABELS } from '../lib/labels'
import { parseQuickAdd } from '../lib/quickAdd'
import { TaskRow } from '../components/TaskRow'

export function ClientsView({ onOpenTask }: { onOpenTask: (t: Task) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (selectedId) {
    return <ClientDetail id={selectedId} onBack={() => setSelectedId(null)} onOpenTask={onOpenTask} />
  }
  return <ClientList onSelect={setSelectedId} />
}

function ClientList({ onSelect }: { onSelect: (id: string) => void }) {
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
        className="flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-left shadow-sm"
      >
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{c.name}</span>
          <span className="text-xs text-slate-400">{KIND_LABELS[c.kind]}</span>
        </span>
        {(counts.get(c.id) ?? 0) > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {counts.get(c.id)}
          </span>
        )}
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </li>
  )

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Klienti</h1>
          <p className="text-sm text-slate-500">Klienti i oblasti jako „Interní“ nebo „Osobní“</p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="rounded-full bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white"
        >
          {adding ? 'Zavřít' : '+ Nový'}
        </button>
      </header>

      {adding && <NewClientForm onDone={() => setAdding(false)} />}

      {clients.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-sm text-slate-400">
          Zatím žádní klienti. Začni tlačítkem „+ Nový“.
        </div>
      )}

      <ul className="space-y-2">{clients.map(item)}</ul>

      {archived.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Archivované · {archived.length}
          </h2>
          <ul className="space-y-2 opacity-60">{archived.map(item)}</ul>
        </section>
      )}
    </div>
  )
}

function NewClientForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ClientKind>('client')
  const [color, setColor] = useState(CLIENT_COLORS[7])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await addClient({ name: name.trim(), kind, color })
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-white p-3 shadow-sm">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Jméno klienta nebo oblasti"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[15px] outline-none focus:border-indigo-400"
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as ClientKind)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] outline-none focus:border-indigo-400"
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
            className={`h-7 w-7 rounded-full ${color === c ? 'ring-2 ring-slate-800 ring-offset-2' : ''}`}
            style={{ background: c }}
          />
        ))}
      </div>
      <button
        type="submit"
        disabled={!name.trim()}
        className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-30"
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
  const [taskText, setTaskText] = useState('')
  const [projName, setProjName] = useState('')
  const [addingProject, setAddingProject] = useState(false)

  if (!client || client.deletedAt) return null

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
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-medium text-indigo-600">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Klienti
      </button>

      <header className="flex items-center gap-3">
        <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: client.color }} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{client.name}</h1>
          <p className="text-sm text-slate-500">
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
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] outline-none focus:border-indigo-400"
        />
        <button
          type="submit"
          disabled={!taskText.trim()}
          className="rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white disabled:opacity-30"
        >
          Přidat
        </button>
      </form>

      {noProject.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Úkoly</h2>
          <ul className="space-y-2">{noProject.map(row)}</ul>
        </section>
      )}

      {projects.map((p) => {
        const projectTasks = sortTasks(tasks.filter((t) => t.projectId === p.id))
        return (
          <section key={p.id}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {p.name}
                {p.goal && <span className="ml-2 font-normal normal-case text-slate-400">{p.goal}</span>}
              </h2>
              <button className="text-xs text-slate-300" onClick={() => void delProject(p.id, p.name)}>
                Smazat
              </button>
            </div>
            {projectTasks.length > 0 ? (
              <ul className="space-y-2">{projectTasks.map(row)}</ul>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-400">
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
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] outline-none focus:border-indigo-400"
          />
          <button
            type="submit"
            disabled={!projName.trim()}
            className="rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white disabled:opacity-30"
          >
            OK
          </button>
        </form>
      ) : (
        <button onClick={() => setAddingProject(true)} className="text-sm font-medium text-indigo-600">
          + Nový projekt
        </button>
      )}

      <footer className="flex gap-4 border-t border-slate-200 pt-4">
        <button onClick={archiveToggle} className="text-sm font-medium text-slate-500">
          {client.status === 'archived' ? 'Obnovit' : 'Archivovat'}
        </button>
        <button onClick={() => void del()} className="text-sm font-medium text-red-600">
          Smazat klienta
        </button>
      </footer>
    </div>
  )
}
