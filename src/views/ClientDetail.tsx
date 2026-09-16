// Detail klienta — hlavička, chipy, jeden seznam.
//
// Obrazovka dřív skládala pod sebe napojení na Todoist, pole pro úkol,
// šablony, každý projekt jako sekci s trvale viditelným „Uzavřít ·
// Smazat", hlídání, sdílení a mazání — tedy nastavení mezi polem
// a seznamem, do kterého úkol padá. Nastavení je teď v panelu
// (KlientSheet) a tady zůstala práce.

import { useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { sharedClientIds } from '../sync/shares'
import type { Project, Task } from '../db/types'
import {
  addProject,
  addTask,
  clientAllTasks,
  clientOpenTasks,
  clientProjects,
  completeTask,
  getClient,
  reopenTask,
  sortTasks,
} from '../db/repo'
import { CHECK_FREQUENCY_LABELS, checkFrequencyOf, getClientCheckTask } from '../db/clientCheck'
import { stavKlienta } from '../lib/clientStatus'
import { formatDayLabel, todayISO } from '../lib/dates'
import { parseQuickAdd } from '../lib/quickAdd'
import { Chip } from '../components/Chip'
import { KlientSheet } from '../components/KlientSheet'
import { ProjektSheet } from '../components/ProjektSheet'
import { useRozbaleno } from '../components/SbalenaSekce'
import { DisclosureContent } from '../components/ui/Disclosure'
import { TaskRow } from '../components/TaskRow'
import { jeMuj, kdoMa } from '../lib/tymUkoly'
import { useJa, useLide } from '../lib/useTym'
import { Button } from '../components/ui/Button'

export function ClientDetail({
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

  // Detail klienta je společná pracovní plocha: jsou tu úkoly obou a u
  // cizích stojí jméno. Dnes a Plán naopak ukazují jen moje — tam se
  // odpovídá na „co mám dělat já", tady na „jak na tom klient je".
  const ja = useJa()
  const lide = useLide()
  const kdoJmeno = (t: Task): string | undefined =>
    jeMuj(t, ja) ? undefined : (lide.get(kdoMa(t, ja) ?? '') ?? 'někdo další')

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
    <TaskRow
      key={t.id}
      task={t}
      project={t.projectId ? projectMap.get(t.projectId) : undefined}
      onToggle={toggle}
      onOpen={onOpenTask}
      kdoMaJmeno={kdoJmeno(t)}
    />
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
      <li key={`p:${p.id}`} className="skupina-li">
        <button
          type="button"
          onClick={() => setProjekt(p.id)}
          aria-label={`Projekt ${p.name}`}
          className="flex w-full items-center gap-2 px-4 pb-1.5 pt-3 text-left active:bg-well/50"
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

      {/* Hlavička se uhýbá plovoucím ikonám vpravo nahoře — ale místo si
          bere jen PRVNÍ řádka jména (plovoucí rozpěrka vysoká 1 px), ne
          celá hlavička. Dokud se uhýbalo `pr-24`, ubíralo se 96 px i tam,
          kde žádná ikona není: „Ondra Fréhar" se na 320 px zalomil na dvě
          řádky a druhá zůstala z poloviny prázdná. Pod jménem je jedna
          stavová řádka — táž, co v seznamu — a jedna řádka chipů:
          „Upravit" vede do nastavení, ostatní jen říkají, co je zapnuté. */}
      <header>
        {/* Jméno se zalomí, neuřízne. Uříznuté („Ondra Fré…") je jméno
            člověka zmrzačené kvůli 20 px, a to na obrazovce, kde je jinak
            místa dost — na 390 px se do jediné řádky vedle plovoucích
            ikon vejde 234 px. Tečka se drží první řádky, ne středu
            dvouřádkového jména. */}
        <div className="flex items-start gap-3">
          <span className="mt-[13px] h-4 w-4 shrink-0 rounded-full" style={{ background: client.color }} />
          <h1 className="display min-w-0 text-[2.1rem] font-semibold leading-tight [overflow-wrap:anywhere]">
            <span aria-hidden="true" className="float-right h-px w-[84px]" />
            {client.name}
          </h1>
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

      <div className="radka-mizi -mx-4 flex gap-2 overflow-x-auto px-4 py-1" style={{ scrollbarWidth: 'none' }}>
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

        <div className="seznam-na-papire">
          {nic ? (
            <p className="px-4 py-5 text-sm text-ink-faint">Zatím nic. Napiš první úkol nahoře — rozumí i „zítra" a „v pátek".</p>
          ) : (
            <ul className="divide-y divide-line">
              {noProject.length > 0 && projects.length > 0 && (
                <li className="skupina-li">
                  <span className="block px-4 pb-1 pt-3 text-[13px] font-medium text-ink-soft">Bez projektu</span>
                </li>
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
