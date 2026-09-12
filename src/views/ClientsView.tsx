import { useCallback, useEffect, useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { sharedClientIds } from '../sync/shares'
import type { Client, ClientKind, Project, Task } from '../db/types'
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
  reopenTask,
  sortTasks,
} from '../db/repo'
import {
  CHECK_FREQUENCY_LABELS,
  checkFrequencyOf,
  getClientCheckTask,
  setClientCheck,
  type CheckFrequency,
} from '../db/clientCheck'
import { COLOR_NAMES, KIND_LABELS, firstFreeColor } from '../lib/labels'
import { stavKlienta } from '../lib/clientStatus'
import { ColorPicker } from '../components/ColorPicker'
import { formatDayLabel, todayISO } from '../lib/dates'
import { parseQuickAdd } from '../lib/quickAdd'
import { Chip } from '../components/Chip'
import { KlientSheet } from '../components/KlientSheet'
import { ProjektSheet } from '../components/ProjektSheet'
import { useRozbaleno } from '../components/SbalenaSekce'
import { DisclosureContent } from '../components/ui/Disclosure'
import { TaskRow } from '../components/TaskRow'
import { TemplatesView } from './TemplatesView'
import { TextEffect } from '../components/ui/TextEffect'
import { Button } from '../components/ui/Button'

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
  // Dokud první dotaz nedoběhne, není to „žádní klienti" — jen se ještě
  // neví. Výzva k založení by na chvíli přebila plný seznam.
  const clientsRaw = useLiveQuery(activeClients, [])
  const clients = clientsRaw ?? []
  const archived = useLiveQuery(archivedClients, []) ?? []
  const open = useLiveQuery(openTasks, []) ?? []
  // Které klienty vidí i někdo další. Bez toho se od pohledu nepozná, co je
  // společná práce a co jen moje — a to je u sdílení ta nejdůležitější věc.
  const sdilene = useLiveQuery(sharedClientIds, [], new Set<string>())
  const [adding, setAdding] = useState(false)

  const counts = new Map<string, number>()
  for (const t of open) {
    if (t.clientId) counts.set(t.clientId, (counts.get(t.clientId) ?? 0) + 1)
  }

  // Stavová řádka klienta (`stavKlienta`): kolik hoří → ticho → kdy je
  // další práce → druh, sdíleno. Pořadí je pořadí důležitosti, protože
  // na úzkém displeji se ořezává zprava.
  const today = todayISO()
  const podleKlienta = new Map<string, Task[]>()
  for (const t of open) {
    if (!t.clientId) continue
    const uz = podleKlienta.get(t.clientId)
    if (uz) uz.push(t)
    else podleKlienta.set(t.clientId, [t])
  }
  const podtitul = (c: Client): React.ReactNode =>
    stavKlienta(c, podleKlienta.get(c.id) ?? [], { sdileno: sdilene.has(c.id) }, today).map((cast, i) => (
      <span
        key={cast.text}
        className={cast.tone === 'danger' ? 'font-medium text-danger' : cast.tone === 'note' ? 'font-medium text-note-ink' : undefined}
      >
        {i > 0 && <span className="text-ink-faint"> · </span>}
        {cast.text}
      </span>
    ))

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
        <TextEffect as="h1" per="char" preset="blur" className="display text-[2.1rem] font-semibold leading-tight">Klienti</TextEffect>
        <p className="text-sm text-ink-soft">Klienti i oblasti jako „Interní“ nebo „Osobní“</p>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Zavřít' : '+ Nový'}
          </Button>
          <Button variant="secondary" size="sm" className="text-ink-soft" onClick={onTemplates}>
            Šablony
          </Button>
        </div>
      </header>

      {adding && (
        <NewClientForm
          usedColors={clients.map((c) => c.color)}
          onDone={() => setAdding(false)}
        />
      )}

      {clientsRaw !== undefined && clients.length === 0 && !adding && (
        <p className="px-1 py-6 text-sm text-ink-faint">Zatím žádní klienti. Začni tlačítkem „+ Nový“.</p>
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
          className="-my-1.5 px-1 py-1.5 text-sm font-medium text-accent-deep"
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
  const [pickingColor, setPickingColor] = useState(false)
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
      {/* Barva sedí u jména, protože v seznamu je to jedna věc: tečka
          a text vedle ní. Ťuknutím se rozbalí paleta — do formuláře se
          nevejde jako trvalá dvouřádková mřížka, a hlavně tam nepatří:
          appka barvu přidělí sama a měnit se hodí až mezi ostatními. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPickingColor((v) => !v)}
          aria-label={`Barva klienta: ${COLOR_NAMES[color] ?? color}`}
          aria-expanded={pickingColor}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full transition-transform duration-150 active:scale-90"
        >
          <span className="h-5 w-5 rounded-full" style={{ background: color }} />
        </button>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jméno klienta"
          aria-label="Jméno klienta nebo oblasti"
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-[15px] outline-none focus:border-accent/60"
        />
      </div>
      {pickingColor && (
        <ColorPicker
          value={color}
          onPick={(c) => {
            setColor(c)
            setPickingColor(false)
          }}
        />
      )}
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

      <Button type="submit" disabled={!name.trim()} className="w-full">
        Vytvořit
      </Button>
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
  // hotové úkoly kvůli postupu projektů („3 z 8") a sbalené historii
  const everyTask = useLiveQuery(() => clientAllTasks(id), [id]) ?? []
  const checkTask = useLiveQuery(() => getClientCheckTask(id), [id])
  const sdilene = useLiveQuery(sharedClientIds, [], new Set<string>())
  const [taskText, setTaskText] = useState('')
  const [projName, setProjName] = useState('')
  const [addingProject, setAddingProject] = useState(false)
  const [nastaveni, setNastaveni] = useState(false)
  const [projekt, setProjekt] = useState<string | null>(null)
  const [hotovoOtevreno, prepniHotovo] = useRozbaleno(`klient-hotovo`)

  const todoistCount = everyTask.filter((t) => t.todoistId).length

  // Oba hooky musí stát NAD podmíněným returnem níž: `client` je z živého
  // dotazu, takže první vykreslení skončí dřív a druhé už ne — hook volaný
  // podmíněně shodí celou obrazovku („Rendered more hooks than…").
  //
  // Stabilní identita kvůli `memo` na `TaskRow`: nová funkce při každém
  // překreslení by memoizaci zrušila a řádky by se překreslily všechny.
  const toggle = useCallback((t: Task) => {
    void (t.status === 'done' ? reopenTask(t.id) : completeTask(t.id))
  }, [])
  // Mapa místo `find` v každém řádku — lineární hledání na řádek dělá
  // ze seznamu kvadratickou práci, jen aby dohledalo jeden projekt.
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  if (!client || client.deletedAt) return null

  // Úkoly uzavřeného (archivovaného) projektu by jinak zmizely úplně —
  // sekce projektu se nevykreslí a mezi „bez projektu" nespadnou. Padají
  // proto do obecných úkolů klienta.
  const visibleProjects = new Set(projects.map((p) => p.id))
  // Šablona generuje instance 30 dní dopředu a detail je ukazoval čtyřikrát
  // pod sebou („Kontrola kampaní" po 14. 9., po 21. 9., …). Tady stojí jen
  // nejbližší výskyt každé pravidelné položky — zbytek je v Plánu.
  const prvniVyskyt = new Map<string, Task>()
  for (const t of tasks) {
    if (!t.sourceTemplateItemId) continue
    const dosud = prvniVyskyt.get(t.sourceTemplateItemId)
    if (!dosud || (t.dueDate ?? '9999') < (dosud.dueDate ?? '9999')) prvniVyskyt.set(t.sourceTemplateItemId, t)
  }
  const otevrene = tasks.filter(
    (t) => !t.sourceTemplateItemId || prvniVyskyt.get(t.sourceTemplateItemId) === t,
  )
  const noProject = sortTasks(otevrene.filter((t) => !t.projectId || !visibleProjects.has(t.projectId)))
  const hotove = everyTask
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 30)

  const row = (t: Task) => (
    <TaskRow key={t.id} task={t} project={t.projectId ? projectMap.get(t.projectId) : undefined} onToggle={toggle} onOpen={onOpenTask} />
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

  const today = todayISO()
  const stav = stavKlienta(client, tasks, { sdileno: sdilene.has(id), todoist: todoistCount > 0 }, today)
  const kontrola = checkFrequencyOf(checkTask)
  const sablon = client.templateIds.length
  const otevreny = projekt ? projects.find((p) => p.id === projekt) : undefined
  const postup = (projectId: string) => {
    const all = everyTask.filter((t) => t.projectId === projectId)
    return { hotovo: all.filter((t) => t.status === 'done').length, celkem: all.length }
  }

  // Jeden seznam v jedné kartě: úkoly bez projektu nahoře, pak každý
  // projekt jako skupina s řádkou v hlavičce. Řádka projektu je odkaz
  // do jeho panelu — na obrazovce nezůstává žádné tlačítko, které by
  // něco uzavíralo nebo mazalo.
  const skupinaHlavicka = (p: Project) => {
    const { hotovo, celkem } = postup(p.id)
    const late = Boolean(p.dueDate && p.dueDate < today && hotovo < celkem)
    const zbyva = otevrene.filter((t) => t.projectId === p.id).length
    return (
      <li key={`p:${p.id}`} className="bg-well/50">
        <button
          type="button"
          onClick={() => setProjekt(p.id)}
          aria-label={`Projekt ${p.name}`}
          className="flex w-full items-center gap-2 px-4 py-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink-soft first-letter:uppercase">{p.name}</span>
            {(p.goal || p.dueDate || zbyva === 0) && (
              <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-ink-faint">
                {p.goal && <span className="truncate">{p.goal}</span>}
                {p.dueDate && (
                  <span className={late ? 'font-medium text-danger' : ''}>do {formatDayLabel(p.dueDate)}</span>
                )}
                {zbyva === 0 && <span>{celkem > 0 ? 'všechno hotovo' : 'zatím bez úkolů'}</span>}
              </span>
            )}
          </span>
          {celkem > 0 && (
            <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">
              {hotovo} z {celkem}
            </span>
          )}
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </li>
    )
  }

  const nic = tasks.length === 0 && hotove.length === 0 && projects.length === 0

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="-my-2 -ml-1 flex items-center gap-1 py-2 pl-1 pr-2 text-sm font-medium text-accent-deep">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Klienti
      </button>

      {/* Hlavička se uhýbá plovoucím ikonám vpravo nahoře (pr-24), aby
          jméno neběželo pod lupu a obláček. Pod jménem je jedna stavová
          řádka — táž, co v seznamu — a jedna řádka chipů: „Upravit" vede
          do nastavení, ostatní jen říkají, co je zapnuté, a vedou tamtéž. */}
      <header className="pr-24">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: client.color }} />
          <h1 className="min-w-0 truncate display text-[2.1rem] font-semibold leading-tight">{client.name}</h1>
        </div>
        <p className="mt-0.5 truncate text-sm text-ink-soft">
          {stav.map((cast, i) => (
            <span
              key={cast.text}
              className={cast.tone === 'danger' ? 'font-medium text-danger' : cast.tone === 'note' ? 'font-medium text-note-ink' : ''}
            >
              {i > 0 && <span className="text-ink-faint"> · </span>}
              {cast.text}
            </span>
          ))}
          {client.status === 'archived' && <span className="text-ink-faint"> · archivovaný</span>}
        </p>
      </header>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1" style={{ scrollbarWidth: 'none' }}>
        <Chip onClick={() => setNastaveni(true)}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
            <path d="M13.5 8.5l2 2" />
          </svg>
          Upravit
        </Chip>
        {kontrola && (
          <Chip onClick={() => setNastaveni(true)}>
            <span className="text-ink-soft">Kontrola</span> {CHECK_FREQUENCY_LABELS[kontrola].toLowerCase()}
          </Chip>
        )}
        {sablon > 0 && (
          <Chip onClick={() => setNastaveni(true)}>
            <span className="text-ink-soft">Šablony</span> {sablon}
          </Chip>
        )}
        {todoistCount > 0 && (
          <Chip tone="accent" onClick={() => setNastaveni(true)}>
            Todoist · {todoistCount}
          </Chip>
        )}
      </div>

      {/* Nový úkol jako v doku: tiché pole, plusko se vynoří až s textem
          — modré „Přidat" na 30 % svítilo přes celou šířku, i když
          nebylo co přidat. */}
      <form onSubmit={submitTask} className="relative">
        <input
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
          aria-label="Nový úkol pro klienta"
          placeholder={`Nový úkol pro ${client.name}…`}
          enterKeyHint="done"
          className="w-full appearance-none rounded-full border border-transparent bg-card py-2.5 pl-4 pr-12 text-[16px] text-ink shadow-card outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent/50 focus-visible:outline-none"
        />
        <button
          type="submit"
          aria-label="Přidat úkol"
          disabled={!taskText.trim()}
          className={`absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-card transition-[opacity,transform] duration-200 active:scale-90 ${
            taskText.trim() ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </form>

      <section>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="section-label">úkoly · {otevrene.length}</h2>
          <button
            type="button"
            onClick={() => setAddingProject((v) => !v)}
            className="-my-1.5 px-1 py-1.5 text-[13px] font-medium text-accent-deep"
          >
            {addingProject ? 'Zavřít' : '+ Projekt'}
          </button>
        </div>

        {addingProject && (
          <form onSubmit={submitProject} className="rise mb-2 flex gap-2">
            <input
              autoFocus
              value={projName}
              onChange={(e) => setProjName(e.target.value)}
              aria-label="Název nového projektu"
              placeholder="Název projektu"
              className="min-w-0 flex-1 rounded-full bg-card px-4 py-2 text-[16px] shadow-card outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            />
            <Button type="submit" disabled={!projName.trim()}>
              Založit
            </Button>
          </form>
        )}

        <div className="overflow-hidden rounded-2xl bg-card shadow-card">
          {nic ? (
            <p className="px-4 py-5 text-sm text-ink-faint">Zatím nic. Napiš první úkol nahoře — rozumí i „zítra" a „v pátek".</p>
          ) : (
            <ul className="divide-y divide-line">
              {noProject.length > 0 && projects.length > 0 && (
                <li className="bg-well/50 px-4 py-2 text-[13px] font-medium text-ink-soft">Bez projektu</li>
              )}
              {noProject.map(row)}
              {projects.map((p) => [
                skupinaHlavicka(p),
                ...sortTasks(otevrene.filter((t) => t.projectId === p.id)).map(row),
              ])}
            </ul>
          )}

          {/* Hotovo sbalené na konci karty — historie, ne práce. */}
          {hotove.length > 0 && (
            <>
              <button
                type="button"
                onClick={prepniHotovo}
                aria-expanded={hotovoOtevreno}
                className="flex w-full items-center justify-between border-t border-line px-4 py-2.5 text-left"
              >
                <span className="section-label !px-0">hotovo · {hotove.length}</span>
                <svg
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 shrink-0 text-ink-faint/70 transition-transform duration-200 ${hotovoOtevreno ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
              <DisclosureContent open={hotovoOtevreno}>
                <ul className="divide-y divide-line border-t border-line">{hotove.map(row)}</ul>
              </DisclosureContent>
            </>
          )}
        </div>
      </section>

      {nastaveni && (
        <KlientSheet
          client={client}
          checkTask={checkTask}
          todoistCount={todoistCount}
          onClose={() => setNastaveni(false)}
          onDeleted={onBack}
        />
      )}
      {otevreny && (
        <ProjektSheet
          project={otevreny}
          hotovo={postup(otevreny.id).hotovo}
          celkem={postup(otevreny.id).celkem}
          onClose={() => setProjekt(null)}
        />
      )}
    </div>
  )
}
