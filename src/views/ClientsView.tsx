import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Client, ClientKind, Task } from '../db/types'
import {
  activeClients,
  addClient,
  addProject,
  addTask,
  allProjects,
  allTasks,
  archivedClients,
  clientAllTasks,
  clientOpenTasks,
  clientProjects,
  completeTask,
  ensureAreaClient,
  getClient,
  openTasks,
  removeClient,
  removeProject,
  reopenTask,
  sortTasks,
  updateClient,
  updateProject,
} from '../db/repo'
import { activeTemplates, deployTemplate, undeployTemplate } from '../db/templates'
import {
  CHECK_FREQUENCY_LABELS,
  checkFrequencyOf,
  getClientCheckTask,
  setClientCheck,
  type CheckFrequency,
} from '../db/clientCheck'
import { CLIENT_COLORS, KIND_LABELS, firstFreeColor, plural } from '../lib/labels'
import { formatDayLabel, formatDaysAgo, todayISO } from '../lib/dates'
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

  // Nejbližší den, na který u klienta něco leží. Druhý řádek u klienta
  // dřív nesl jen slovo „Klient" — u seznamu samých klientů to byl sloupec
  // téhož slova. Kdy se k němu zase dostanu, je informace, kvůli které se
  // na seznam kouká.
  const nextDay = new Map<string, string>()
  for (const t of open) {
    const den = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d)).sort()[0]
    if (!t.clientId || !den) continue
    const dosud = nextDay.get(t.clientId)
    if (!dosud || den < dosud) nextDay.set(t.clientId, den)
  }

  // Samotný den, bez uvozovacího slova: to by se na každém řádku opakovalo
  // stejně jako dřív slovo „Klient", kdežto datum se liší. Pod jménem
  // klienta a vedle počtu úkolů se „dnes" čte jako „kdy" samo od sebe.
  const podtitul = (c: Client): string => {
    // U oblastí („Interní", „Osobní") se druh hlásí — u klienta je zbytečný.
    const druh = c.kind === 'client' ? '' : `${KIND_LABELS[c.kind]} · `
    const pocet = counts.get(c.id) ?? 0
    if (pocet === 0) return `${druh}žádné úkoly`
    const den = nextDay.get(c.id)
    return den ? `${druh}${formatDayLabel(den).toLowerCase()}` : `${druh}nic naplánováno`
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
          <span className="block truncate text-xs text-ink-faint">{podtitul(c)}</span>
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
    <div className="space-y-5">
      {/* Titulek přes celou šířku jako na Dnes a v Plánu. Dřív stál vedle
          sloupce dvou tlačítek, takže se podtitulek mačkal do dvou řádků
          a lámal se pod „+ Nový" — vypadalo to jako popisek tlačítka.
          Akce teď stojí na vlastním řádku pod ním. */}
      <header>
        <h1 className="display text-[2.1rem] font-semibold leading-tight">Klienti</h1>
        <p className="text-sm text-ink-soft">Klienti i oblasti jako „Interní“ nebo „Osobní“</p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded-full bg-accent px-3.5 py-2 text-sm font-medium text-card transition-transform duration-150 active:scale-95"
          >
            {adding ? 'Zavřít' : '+ Nový'}
          </button>
          <button
            onClick={onTemplates}
            className="rounded-full border border-line bg-card px-3.5 py-2 text-sm font-medium text-ink-soft transition-transform duration-150 active:scale-95"
          >
            Šablony
          </button>
        </div>
      </header>

      {adding && (
        <NewClientForm
          usedColors={clients.map((c) => c.color)}
          onDone={() => setAdding(false)}
        />
      )}

      {clients.length === 0 && !adding && (
        <div className="rounded-2xl border border-dashed border-line bg-card/60 px-4 py-8 text-center text-sm text-ink-faint">
          Zatím žádní klienti. Začni tlačítkem „+ Nový“.
        </div>
      )}

      {/* Celá sekce až od prvního klienta: prázdný <ul> má pořád bg-card
          a shadow-card, a ten nese 1px prstenec — na prázdné obrazovce
          z toho byla osamocená čárka pod výzvou k založení. */}
      {clients.length > 0 && (
        <>
          <h2 className="section-label mb-2">klienti a oblasti</h2>
          <ul className="rise divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">{clients.map(item)}</ul>
        </>
      )}

      {/* Přehled projektů je druhý pohled na tytéž věci, takže patří AŽ za
          seznam klientů. Projekt se navíc zakládá pod klienta, takže když
          žádný projekt není, nemá se tu co nabízet — dřív nad seznamem
          viselo osamocené „+ Nový projekt" bez vysvětlení, k čemu patří. */}
      {clients.length > 0 && <ProjectsOverview clients={clients} open={open} onSelect={onSelect} />}

      {archived.length > 0 && (
        <section>
          <h2 className="mb-2 section-label">
            Archivované · {archived.length}
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card opacity-60 shadow-card">{archived.map(item)}</ul>
        </section>
      )}
    </div>
  )
}

// Přehled rozjetých projektů napříč klienty i oblastmi — projekty jsou
// vidět bez proklikávání do detailů. Odsud jde založit projekt „bez
// klienta": vybere se oblast Interní/Osobní a ta se případně tiše založí.
function ProjectsOverview({
  clients,
  open,
  onSelect,
}: {
  clients: Client[]
  open: Task[]
  onSelect: (clientId: string) => void
}) {
  const projects = useLiveQuery(allProjects, []) ?? []
  // i hotové úkoly — postup projektu bez nich nedává smysl
  const every = useLiveQuery(allTasks, []) ?? []
  const [adding, setAdding] = useState(false)

  const clientById = new Map(clients.map((c) => [c.id, c]))
  const active = projects
    .filter((p) => p.status === 'active' && clientById.has(p.clientId))
    .sort(
      (a, b) =>
        clientById.get(a.clientId)!.name.localeCompare(clientById.get(b.clientId)!.name, 'cs') ||
        a.order - b.order,
    )

  const openByProject = new Map<string, number>()
  for (const t of open) {
    if (t.projectId) openByProject.set(t.projectId, (openByProject.get(t.projectId) ?? 0) + 1)
  }
  const doneByProject = new Map<string, number>()
  const totalByProject = new Map<string, number>()
  for (const t of every) {
    if (!t.projectId) continue
    totalByProject.set(t.projectId, (totalByProject.get(t.projectId) ?? 0) + 1)
    if (t.status === 'done') doneByProject.set(t.projectId, (doneByProject.get(t.projectId) ?? 0) + 1)
  }
  const today = todayISO()

  // Bez jediného projektu se blok neukáže vůbec: projekt vzniká v detailu
  // klienta, kde je jasné, komu patří, a samotný odkaz nad seznamem klientů
  // jen mátl.
  if (active.length === 0 && !adding) return null

  return (
    <section className="rise">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="section-label">rozjeté projekty · {active.length}</h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="px-1 text-sm font-medium text-accent"
        >
          {adding ? 'Zavřít' : '+ Nový'}
        </button>
      </div>

      {adding && <NewProjectForm clients={clients} onDone={() => setAdding(false)} />}

      {active.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
          {active.map((p) => {
            const client = clientById.get(p.clientId)!
            const openCount = openByProject.get(p.id) ?? 0
            const done = doneByProject.get(p.id) ?? 0
            const total = totalByProject.get(p.id) ?? 0
            const late = Boolean(p.dueDate && p.dueDate < today && done < total)
            return (
              <li key={p.id}>
                <button
                  onClick={() => onSelect(p.clientId)}
                  className="flex w-full items-center gap-3 bg-card px-4 py-3 text-left transition-colors duration-150 active:bg-well/60"
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: client.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{p.name}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs">
                      <span className="text-ink-faint">{client.name}</span>
                      {p.dueDate && (
                        <span className={late ? 'font-medium text-danger' : 'text-ink-soft'}>
                          do {formatDayLabel(p.dueDate)}
                        </span>
                      )}
                      {total > 0 && (
                        <span className="text-ink-faint">
                          {done} z {total}
                        </span>
                      )}
                    </span>
                    {total > 0 && (
                      <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-well">
                        <span
                          className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-glide"
                          style={{ width: `${Math.round((done / total) * 100)}%` }}
                        />
                      </span>
                    )}
                  </span>
                  {openCount > 0 ? (
                    <span className="rounded-full bg-well px-2 py-0.5 text-xs font-medium text-ink-soft">
                      {openCount}
                    </span>
                  ) : (
                    <span className="rounded-full bg-note px-2 py-0.5 text-xs font-semibold text-note-ink">
                      chybí další krok
                    </span>
                  )}
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// Založení projektu odkudkoli: cílem je klient, nebo oblast Interní/Osobní
// (když oblast neexistuje, ensureAreaClient ji tiše vytvoří).
function NewProjectForm({ clients, onDone }: { clients: Client[]; onDone: () => void }) {
  const [name, setName] = useState('')
  const hasInternal = clients.some((c) => c.kind === 'internal')
  const hasPersonal = clients.some((c) => c.kind === 'personal')
  const [target, setTarget] = useState(clients[0]?.id ?? '__internal')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    let clientId = target
    if (target === '__internal' || target === '__personal') {
      clientId = (await ensureAreaClient(target === '__internal' ? 'internal' : 'personal')).id
    }
    await addProject({ clientId, name: name.trim() })
    setName('')
    onDone()
  }

  return (
    <form onSubmit={submit} className="rise mb-3 space-y-2 rounded-2xl bg-card p-3 shadow-card">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Název projektu"
        className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[15px] outline-none focus:border-accent/60"
      />
      <div className="flex gap-2">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-2 text-[15px] outline-none focus:border-accent/60"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.kind !== 'client' ? ` (${KIND_LABELS[c.kind].toLowerCase()})` : ''}
            </option>
          ))}
          {!hasInternal && <option value="__internal">Interní (oblast se založí)</option>}
          {!hasPersonal && <option value="__personal">Osobní (oblast se založí)</option>}
        </select>
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-lg bg-accent px-4 text-sm font-medium text-card transition-transform duration-150 active:scale-95 disabled:opacity-30"
        >
          OK
        </button>
      </div>
    </form>
  )
}

function NewClientForm({ usedColors, onDone }: { usedColors: Array<string | undefined>; onDone: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ClientKind>('client')
  const [color, setColor] = useState(() => firstFreeColor(usedColors))
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
  // hotové úkoly jen kvůli postupu projektů („3 z 8 hotovo")
  const everyTask = useLiveQuery(() => clientAllTasks(id), [id]) ?? []
  const templates = useLiveQuery(activeTemplates, []) ?? []
  const checkTask = useLiveQuery(() => getClientCheckTask(id), [id])
  const [taskText, setTaskText] = useState('')
  const [projName, setProjName] = useState('')
  const [addingProject, setAddingProject] = useState(false)
  // Přejmenování klienta: dřív šlo klienta jen smazat — i s projekty
  // a úkoly. Překlep ve jméně tak stál celou historii.
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [editProject, setEditProject] = useState<string | null>(null)
  const [draftProject, setDraftProject] = useState('')
  const [draftGoal, setDraftGoal] = useState('')
  const [draftDue, setDraftDue] = useState('')

  const todoistCount = everyTask.filter((t) => t.todoistId && !t.deletedAt).length

  if (!client || client.deletedAt) return null

  const startRename = () => {
    setDraftName(client.name)
    setRenaming(true)
  }

  const saveRename = () => {
    const name = draftName.trim()
    if (name && name !== client.name) void updateClient(id, { name })
    setRenaming(false)
  }

  const toggleTemplate = (templateId: string) => {
    void (client.templateIds.includes(templateId)
      ? undeployTemplate(id, templateId)
      : deployTemplate(id, templateId))
  }

  const setWatch = (value: string) => {
    const n = Number(value)
    void updateClient(id, { checkIntervalDays: n > 0 ? n : undefined })
  }

  // Úkoly uzavřeného (archivovaného) projektu by jinak zmizely úplně —
  // sekce projektu se nevykreslí a mezi „bez projektu" nespadnou. Padají
  // proto do obecných úkolů klienta.
  const visibleProjects = new Set(projects.map((p) => p.id))
  const noProject = sortTasks(
    tasks.filter((t) => !t.projectId || !visibleProjects.has(t.projectId)),
  )

  const toggle = (t: Task) => {
    void (t.status === 'done' ? reopenTask(t.id) : completeTask(t.id))
  }

  const row = (t: Task) => (
    <TaskRow key={t.id} task={t} onToggle={toggle} onOpen={onOpenTask} />
  )

  const submitTask = async (e: React.FormEvent) => {
    e.preventDefault()
    // Parser rozumí i času, opakování a poznámce — zahazovat je jen
    // proto, že se úkol zadává u klienta, nedávalo smysl.
    const parsed = parseQuickAdd(taskText, [], new Date(), projects)
    if (!parsed.title) return
    await addTask({
      title: parsed.title,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      priority: parsed.priority,
      recurrenceRule: parsed.recurrenceRule,
      notes: parsed.notes,
      projectId: parsed.projectId,
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

  const saveProject = (projectId: string) => {
    const name = draftProject.trim()
    if (!name) {
      setEditProject(null)
      return
    }
    void updateProject(projectId, {
      name,
      goal: draftGoal.trim() || undefined,
      dueDate: draftDue || undefined,
    })
    setEditProject(null)
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

      <header className="pr-24">
        {renaming ? (
          <div className="rise space-y-2 rounded-2xl bg-card p-3 shadow-card">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename()
                if (e.key === 'Escape') setRenaming(false)
              }}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[16px] outline-none focus:border-accent/60"
            />
            <div className="flex flex-wrap gap-1.5">
              {CLIENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Barva ${c}`}
                  onClick={() => void updateClient(id, { color: c })}
                  className={`h-7 w-7 rounded-full transition-transform duration-150 active:scale-90 ${
                    client.color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-card' : ''
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenaming(false)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft transition-transform duration-150 active:scale-95"
              >
                Hotovo
              </button>
              <button
                onClick={saveRename}
                disabled={!draftName.trim()}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-card transition-transform duration-150 active:scale-95 disabled:opacity-30"
              >
                Uložit název
              </button>
            </div>
          </div>
        ) : (
          <button onClick={startRename} className="flex w-full items-center gap-3 text-left">
            <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: client.color }} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate display text-[2.1rem] font-semibold leading-tight">{client.name}</h1>
              <p className="text-sm text-ink-soft">
                {KIND_LABELS[client.kind]}
                {client.status === 'archived' && ' · archivovaný'}
                <span className="text-ink-faint"> · ťukni pro úpravu</span>
              </p>
            </div>
          </button>
        )}
      </header>

      {/* Napojení na Todoist patří i sem — do nastavení kvůli jednomu
          klientovi nikdo lézt nebude. */}
      {(client.todoistProjectIds?.length ?? 0) > 0 && (
        <div className="space-y-1.5 rounded-2xl bg-well px-3 py-2.5">
          <p className="text-[13px] text-ink-soft">
            Napojeno na Todoist
            {todoistCount > 0 &&
              ` · ${todoistCount} ${plural(todoistCount, 'úkol', 'úkoly', 'úkolů')} odtamtud`}
          </p>
          <label className="flex items-start gap-2 text-[12px] leading-snug text-ink-soft">
            <input
              type="checkbox"
              checked={Boolean(client.todoistPushSince)}
              onChange={(e) =>
                void updateClient(id, {
                  todoistPushSince: e.target.checked ? new Date().toISOString() : undefined,
                })
              }
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
            />
            <span>
              Nové úkoly zakládat i v Todoistu
              <span className="block text-ink-faint">Klient je pak uvidí ve sdíleném projektu.</span>
            </span>
          </label>
        </div>
      )}

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

      {noProject.length > 0 && (
        <section>
          <h2 className="mb-2 section-label">Úkoly</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">{noProject.map(row)}</ul>
        </section>
      )}

      {projects.map((p) => {
        const projectTasks = sortTasks(tasks.filter((t) => t.projectId === p.id))
        // postup počítá i hotové úkoly — jinak by projekt ke konci
        // vypadal jako prázdný místo jako dotažený
        const allOfProject = everyTask.filter((t) => t.projectId === p.id)
        const projectDone = allOfProject.filter((t) => t.status === 'done').length
        const projectTotal = allOfProject.length
        const projectLate = Boolean(p.dueDate && p.dueDate < todayISO() && projectDone < projectTotal)
        return (
          <section key={p.id}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              {editProject === p.id ? (
                // projekt šel dřív jen založit a smazat — překlep v názvu
                // znamenal rozpad vazby na úkoly
                <div className="min-w-0 flex-1 space-y-1.5">
                  <input
                    autoFocus
                    aria-label="Název projektu"
                    value={draftProject}
                    onChange={(e) => setDraftProject(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveProject(p.id)
                      if (e.key === 'Escape') setEditProject(null)
                    }}
                    className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[16px] outline-none focus:border-accent/60"
                  />
                  <input
                    aria-label="Cíl projektu"
                    placeholder="Cíl — čeho chceš dosáhnout"
                    value={draftGoal}
                    onChange={(e) => setDraftGoal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveProject(p.id)
                      if (e.key === 'Escape') setEditProject(null)
                    }}
                    className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[16px] outline-none focus:border-accent/60"
                  />
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-medium text-ink-soft">Termín</span>
                    <input
                      type="date"
                      aria-label="Termín projektu"
                      value={draftDue}
                      onChange={(e) => setDraftDue(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[16px] outline-none focus:border-accent/60"
                    />
                    <button
                      onClick={() => saveProject(p.id)}
                      className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-card transition-transform duration-150 active:scale-95"
                    >
                      Uložit
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setDraftProject(p.name)
                    setDraftGoal(p.goal ?? '')
                    setDraftDue(p.dueDate ?? '')
                    setEditProject(p.id)
                  }}
                >
                  <h2 className="section-label truncate">{p.name}</h2>
                  {(p.goal || p.dueDate || projectTasks.length > 0 || projectDone > 0) && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] normal-case">
                      {p.goal && <span className="text-ink-soft">{p.goal}</span>}
                      {p.dueDate && (
                        <span className={projectLate ? 'font-medium text-danger' : 'text-ink-soft'}>
                          do {formatDayLabel(p.dueDate)}
                        </span>
                      )}
                      {projectTotal > 0 && (
                        <span className="text-ink-faint">
                          {projectDone} z {projectTotal} hotovo
                        </span>
                      )}
                    </span>
                  )}
                </button>
              )}
              <div className="flex shrink-0 gap-2.5">
                {/* uzavření projektu — hotová věc nemá zabírat místo */}
                <button
                  className="text-xs text-ink-faint/70"
                  onClick={() => void updateProject(p.id, { status: 'archived' })}
                >
                  Uzavřít
                </button>
                <button className="text-xs text-ink-faint/70" onClick={() => void delProject(p.id, p.name)}>
                  Smazat
                </button>
              </div>
            </div>
            {projectTasks.length > 0 ? (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">{projectTasks.map(row)}</ul>
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
          {projects.length === 0 ? '+ Rozdělit práci do projektu' : '+ Nový projekt'}
        </button>
      )}

      {/* Hlídání klienta patří dolů: nastaví se jednou a pak se na něj
          nesahá, kdežto úkoly jsou to, kvůli čemu sem člověk chodí. Dřív
          stálo mezi polem pro nový úkol a seznamem, do kterého úkol padá. */}
      <section>
        <h2 className="mb-2 section-label">hlídání klienta</h2>
      <section className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
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
                ? `Poslední aktivita ${formatDaysAgo(client.lastActivityAt)}`
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
              placeholder="14"
              onBlur={(e) => setWatch(e.target.value)}
              className="w-16 rounded-lg border border-line px-2 py-1.5 text-center text-[15px] outline-none focus:border-accent/60"
            />
            dnech
          </label>
        </div>
      </section>
      </section>

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
