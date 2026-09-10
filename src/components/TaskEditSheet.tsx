// Detail úkolu — titulek, poznámka a jedna stavová řádka.
//
// Dřív to byl formulář: osm polí s popisky (Úkol, Klient, Projekt,
// Termín, Čas, Priorita, Opakování, Poznámky) v rozbalovátkách. Když
// pole potřebuje popisek a <select>, je to nastavení, ne úkol. Teď je
// nahoře název jako titulek a poznámka pod ním, a všechno ostatní nese
// stejná stavová řádka slotů jako zadávání v doku (`SlotChip`): prázdný
// slot nabízí, vyplněný ukazuje hodnotu, otevřený má pod řádkou panel
// s výběrem. Kdo se naučil zadávat, umí i upravovat.
//
// Ukládá se tlačítkem (a ⌘↩), jen checklist, špendlík a „kdo úkol
// vidí" hned — to jsou rozhodnutí o datech, ne rozepsaný text.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Priority, Project, Subtask, Task, TodoistComment } from '../db/types'
import {
  MAX_PINNED,
  activeClients,
  clientProjects,
  getTask,
  removeTask,
  restoreDeleted,
  togglePinned,
  updateTask,
} from '../db/repo'
import { Sheet } from './Sheet'
import { Button } from './ui/Button'
import { MonthPicker } from './MonthPicker'
import { SlotChip, pill } from './SlotChip'
import { cn } from '../lib/cn'
import { najdiOdkazy } from '../lib/links'
import { nabidniVraceni, ukazToast } from '../lib/toast'
import { TaskSharing } from './TaskSharing'
import { deleteBlockForTask } from '../sync/calendar'
import {
  addTodoistSubtask,
  deleteTodoistTask,
  loadTodoistComments,
  postTodoistComment,
  pushTodoistEdits,
  sendTaskToTodoist,
  setTodoistSubtaskDone,
} from '../sync/todoist'
import { SUB_PREFIX } from '../lib/todoistMap'
import { addDays, formatDayLabel, fromISODate, jePlatnyCas, nextMonday, toISODate, todayISO } from '../lib/dates'
import { PRIORITY_LABELS } from '../lib/labels'
import {
  MONTHS,
  PRESET_LABELS,
  WEEKDAYS,
  alignDueDate,
  humanizeRule,
  partsFromRule,
  ruleFromParts,
  ruleFromPreset,
  type RecurrencePreset,
  type RuleParts,
} from '../lib/rrule'

type Picker = 'date' | 'scheduled' | 'client' | 'project' | 'priority' | 'recurrence' | null

const QUICK_DAYS: { label: string; day: (today: string) => string }[] = [
  { label: 'Dnes', day: (t) => t },
  { label: 'Zítra', day: (t) => toISODate(addDays(fromISODate(t), 1)) },
  { label: 'Pondělí', day: (t) => toISODate(nextMonday(fromISODate(t))) },
]

const velkePismeno = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

// Textové pole, které roste s obsahem — titulek ani poznámka nemají mít
// posuvník uvnitř panelu, který sám roluje.
function AutoTextarea({ className, value, ...props }: React.ComponentProps<'textarea'>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={cn('block w-full resize-none bg-transparent outline-none placeholder:text-ink-faint', className)}
      {...props}
    />
  )
}

// Výběr dne: rychlé volby + kalendářík. Sdílí ho Termín i Naplánováno.
function VyberDne({
  value,
  bezPopisek,
  onChange,
  children,
}: {
  value: string
  bezPopisek: string
  onChange: (iso: string) => void
  children?: React.ReactNode
}) {
  const today = todayISO()
  return (
    <div>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5" style={{ scrollbarWidth: 'none' }}>
        {QUICK_DAYS.map(({ label, day }) => {
          const iso = day(today)
          const on = value === iso
          return (
            <button
              key={label}
              type="button"
              onClick={() => onChange(iso)}
              aria-pressed={on}
              className={`${pill} ${on ? 'bg-accent text-card' : 'bg-card text-ink'}`}
            >
              {label}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => onChange('')}
          aria-pressed={!value}
          className={`${pill} ${!value ? 'bg-accent text-card' : 'bg-card text-ink-soft'}`}
        >
          {bezPopisek}
        </button>
      </div>
      <MonthPicker value={value || undefined} onSelect={onChange} />
      {children}
    </div>
  )
}

export function TaskEditSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [clientId, setClientId] = useState(task.clientId ?? '')
  const [hiddenFrom, setHiddenFrom] = useState<string[]>(task.hiddenFrom ?? [])
  const [ptamSeNaTodoist, setPtamSeNaTodoist] = useState(false)
  const [projectId, setProjectId] = useState(task.projectId ?? '')
  const [priority, setPriority] = useState<Priority>(task.priority)
  const [picker, setPicker] = useState<Picker>(null)
  // Importovaný úkol se dá upravovat a změny letí zpátky do Todoistu.
  // Zamčené zůstává jen zařazení — přesouvat úkol mezi projekty klienta
  // patří do Todoistu, ne sem.
  const fromTodoist = Boolean(task.todoistId)
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | string>('idle')
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [dueTime, setDueTime] = useState(task.dueTime ?? '')
  const [scheduledFor, setScheduledFor] = useState(task.scheduledFor ?? '')
  // Opakování je pravidlo přímo (frekvence + den), ne předvolba odvozená
  // z termínu. null = neopakuje se. Pravidlo mimo předvolby (z parseru,
  // „každé 3 týdny") se nechá být a jen se ukáže.
  const [rule, setRule] = useState<string | null>(task.recurrenceRule ?? null)
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

  // U todoistího úkolu vznikne krok i tam, ať checklist sedí na obou
  // stranách. Když se to nepovede (offline), zůstane krok lokální —
  // stažení ho nesmaže, jen se nepropíše ven.
  const addSubtask = async () => {
    const title = newSub.trim()
    if (!title) return
    setNewSub('')
    const local = { id: crypto.randomUUID(), title, done: false }
    persistSubtasks([...subtasks, local])
    if (!task.todoistId) return
    const remoteId = await addTodoistSubtask(task.todoistId, title)
    if (!remoteId) return
    persistSubtasks(
      [...subtasks, local].map((s) => (s.id === local.id ? { ...s, id: `${SUB_PREFIX}${remoteId}` } : s)),
    )
  }

  const clients = useLiveQuery(activeClients, []) ?? []
  const client = clients.find((c) => c.id === clientId)
  // Klient s napojeným projektem — jen u něj má smysl nabízet odeslání.
  const todoistClient = client && (client.todoistProjectIds?.length ?? 0) > 0 ? client : undefined
  const projects =
    useLiveQuery(
      () => (clientId ? clientProjects(clientId) : Promise.resolve<Project[]>([])),
      [clientId],
    ) ?? []
  const project = projects.find((p) => p.id === projectId)

  // ⌘↩ uloží — na Macu se to čeká od každého formuláře. Handler visí
  // na okně (uvnitř panelu není jeden společný prvek, který by ho nesl),
  // a close() z renderu si půjčuje přes ref.
  const closeRef = useRef<() => void>(() => {})
  const saveRef = useRef<() => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      saveRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Odkazy z názvu i poznámky — Canva, Drive, brief. Bez tohohle by je
  // člověk z appky opisoval.
  const odkazy = najdiOdkazy(title, notes)

  const save = async (close: () => void) => {
    if (!title.trim()) return
    const hasDate = Boolean(dueDate || scheduledFor)
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
      recurrenceRule: rule ?? undefined,
      status: task.status === 'inbox' && hasDate ? 'active' : task.status,
    })
    // Úprava todoistího úkolu se označí jako neodeslaná a hned se zkusí
    // poslat; do té doby ji stažení nepřepíše.
    if (fromTodoist) {
      await updateTask(task.id, { todoistDirty: true })
      void pushTodoistEdits()
    }
    // Zrušené naplánování uvolní i blok v kalendáři „Todo".
    if (task.calendarEventId && !scheduledFor) void deleteBlockForTask(task)
    close()
  }

  // Smazání se nepotvrzuje, jde vrátit — systémový `confirm()` rozbíjel
  // dojem nativní appky a nechrání: kdo ho vidí pokaždé, odklepne ho po
  // očku. Mazání je tombstone, takže „Vrátit" je jen zrušení razítka.
  const del = async (close: () => void, iVTodoistu = false) => {
    // Tohle vrátit nejde — v Todoistu úkol zmizí i klientovi ve sdíleném
    // projektu. Proto se u todoistích úkolů ptá (viz níž), a jen na tohle.
    if (iVTodoistu) await deleteTodoistTask(task.id)
    if (task.calendarEventId) void deleteBlockForTask(task)
    const plan = await removeTask(task.id)
    close()
    if (iVTodoistu) ukazToast('Smazáno i v Todoistu')
    else nabidniVraceni('Úkol smazán', () => restoreDeleted(plan))
  }

  const otevri = (kind: Picker) => setPicker((p) => (p === kind ? null : kind))
  // Zařazení todoistího úkolu se mění v Todoistu — slot to řekne, místo
  // aby byl jen šedý.
  const zamceno = () => ukazToast('Zařazení úkolu z Todoistu se mění v Todoistu')

  const today = todayISO()
  const parts = rule ? partsFromRule(rule) : null
  const recurrenceLabel = rule ? velkePismeno(humanizeRule(rule)) : undefined

  // Změna pravidla srovná termín na první výskyt od dneška — „každou
  // neděli" na úkolu ze středy posune termín na nejbližší neděli. Bez
  // termínu se opakování nemá od čeho odvíjet, tak ho dostane vždycky.
  const nastavPravidlo = (r: string | null) => {
    setRule(r)
    if (!r) return
    const srovnany = alignDueDate(r, dueDate || undefined, today)
    if (srovnany && srovnany !== dueDate) setDueDate(srovnany)
  }
  const zvolPredvolbu = (p: RecurrencePreset) => {
    // den se bere z termínu (jako dřív), ale už zvolené dny v týdnu nebo
    // den v měsíci přepnutí frekvence nezahodí
    const zaklad = partsFromRule(ruleFromPreset(p, dueDate || today)) ?? { preset: p, byday: ['MO'], dom: 1, month: 1 }
    const tydenni = (x: RecurrencePreset) => x === 'weekly' || x === 'biweekly'
    const mesicni = (x: RecurrencePreset) => x === 'monthly' || x === 'quarterly' || x === 'yearly'
    const dalsi: RuleParts = {
      ...zaklad,
      preset: p,
      byday: parts && tydenni(parts.preset) && tydenni(p) ? parts.byday : zaklad.byday,
      dom: parts && mesicni(parts.preset) && mesicni(p) ? parts.dom : zaklad.dom,
      month: parts && parts.preset === 'yearly' && p === 'yearly' ? parts.month : zaklad.month,
    }
    nastavPravidlo(ruleFromParts(dalsi))
  }
  const prepniDen = (kod: string) => {
    if (!parts) return
    const dny = parts.byday.includes(kod) ? parts.byday.filter((d) => d !== kod) : [...parts.byday, kod]
    if (dny.length === 0) return // aspoň jeden den musí zůstat
    nastavPravidlo(ruleFromParts({ ...parts, byday: dny }))
  }

  return (
    <Sheet onClose={onClose} className="space-y-4">
      {(close) => {
        closeRef.current = close
        saveRef.current = () => void save(closeRef.current)
        return (
        <>
        <header className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-ink-soft">
            {fromTodoist ? 'Úkol z Todoistu' : task.status === 'done' ? 'Hotový úkol' : 'Úkol'}
            {task.todoistDirty && ' · změna čeká na odeslání'}
          </span>
          <button
            type="button"
            aria-label={pinnedFor === today ? 'Odepnout z Top 3 dne' : 'Připnout mezi Top 3 dne'}
            onClick={() => void pinToday()}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-[background-color,color,transform] duration-150 active:scale-95 ${
              pinnedFor === today ? 'bg-accent text-card' : 'bg-well text-ink-soft'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3.5h6l-.8 5.2 3.3 3.1H6.5l3.3-3.1z" />
              <path d="M12 11.8V20.5" />
            </svg>
            {pinnedFor === today ? 'Top 3 dne' : 'Připnout'}
          </button>
        </header>
        {pinFull && (
          <p className="pop rounded-2xl bg-note px-3 py-2 text-[13px] text-note-ink">
            Top {MAX_PINNED} je plná — nejdřív něco odepni. Míň priorit, víc hotovo.
          </p>
        )}

        {/* Název jako titulek, poznámka pod ním — bez rámečků a popisků.
            Enter v názvu nezalamuje, jde do poznámky. */}
        <div>
          <AutoTextarea
            id="pole-ukol"
            aria-label="Úkol"
            value={title}
            placeholder="Co je potřeba udělat?"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                document.getElementById('pole-poznamky')?.focus()
              }
            }}
            className="text-[22px] font-semibold leading-snug text-ink"
          />
          {/* Štítky z Todoistu jsou informace, ne pole k vyplnění —
              appka s nimi nic nedělá, ale schovávat je by bylo divné. */}
          {task.todoistLabels?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {task.todoistLabels.map((l) => (
                <span key={l} className="rounded-full bg-well px-2 py-0.5 text-[11px] text-ink-soft">
                  @{l}
                </span>
              ))}
            </div>
          ) : null}
          <AutoTextarea
            id="pole-poznamky"
            aria-label="Poznámky"
            value={notes}
            placeholder="Poznámka…"
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1.5 text-[15px] leading-relaxed text-ink-soft"
          />
          {odkazy.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2" data-odkazy>
              {odkazy.map((o) => (
                <a
                  key={o.url}
                  href={o.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-well px-3 text-[13px] font-medium text-accent-deep transition-transform duration-150 active:scale-95"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
                    <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
                  </svg>
                  {o.popisek}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Stavová řádka: stejné sloty jako v doku. Nezalamuje se, přetéká
            k okraji panelu. Naplánováno je vrstva navrch termínu (ranní
            návrh, uzávěrka) — proto stojí až na konci a vysvětluje se jen
            v otevřeném panelu, ne pod každým úkolem. */}
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4" style={{ scrollbarWidth: 'none' }}>
          <SlotChip
            slot="date"
            label="Termín"
            value={dueDate ? formatDayLabel(dueDate) + (dueTime ? ` ${dueTime}` : '') : undefined}
            open={picker === 'date'}
            onTap={() => otevri('date')}
            icon={<path d="M4.5 6.5h15v13h-15zM4.5 10h15M8.5 4v4M15.5 4v4" />}
          />
          <SlotChip
            slot="client"
            label="Klient"
            value={client?.name}
            dot={client?.color}
            open={picker === 'client'}
            onTap={fromTodoist ? zamceno : () => otevri('client')}
            icon={<><circle cx="12" cy="8.5" r="3.5" /><path d="M5.5 19.5c.8-3.4 3.4-5.25 6.5-5.25s5.7 1.85 6.5 5.25" /></>}
          />
          <SlotChip
            slot="project"
            label="Projekt"
            value={project?.name}
            open={picker === 'project'}
            onTap={fromTodoist ? zamceno : () => otevri('project')}
            icon={<path d="M4 7.5a2 2 0 012-2h4l2 2.5h6a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2z" />}
          />
          <SlotChip
            slot="priority"
            label="Priorita"
            value={priority !== 'normal' ? PRIORITY_LABELS[priority] : undefined}
            open={picker === 'priority'}
            onTap={() => otevri('priority')}
            icon={<path d="M12 5v9M12 17.5v1" />}
          />
          <SlotChip
            slot="recurrence"
            label="Opakování"
            value={recurrenceLabel}
            open={picker === 'recurrence'}
            onTap={() => otevri('recurrence')}
            icon={<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" />}
          />
          <SlotChip
            slot="scheduled"
            label="Naplánovat na jiný den"
            value={scheduledFor ? `Plán ${formatDayLabel(scheduledFor)}` : undefined}
            open={picker === 'scheduled'}
            onTap={() => otevri('scheduled')}
            icon={<path d="M12 6v6l3.5 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z" />}
          />
        </div>

        {/* Jediné místo, kde se cokoli rozbaluje — pod řádkou slotů. */}
        {picker && (
          <div className="rise rounded-2xl bg-well p-3">
            {picker === 'date' && (
              <VyberDne value={dueDate} bezPopisek="Bez termínu" onChange={setDueDate}>
                {dueDate && (
                  <div className="rise flex items-center gap-2 pt-1">
                    <span className="shrink-0 text-[13px] font-medium text-ink-soft">Čas</span>
                    <input
                      type="time"
                      aria-label="Čas termínu"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      className="min-w-0 flex-1 rounded-full border border-transparent bg-card px-3 py-2 text-[15px] font-medium text-ink outline-none focus:border-accent/50"
                    />
                    {dueTime && (
                      <button type="button" onClick={() => setDueTime('')} className={`${pill} bg-card text-ink-soft`}>
                        Bez času
                      </button>
                    )}
                  </div>
                )}
              </VyberDne>
            )}
            {picker === 'scheduled' && (
              <VyberDne value={scheduledFor} bezPopisek="Bez plánu" onChange={setScheduledFor}>
                <p className="pt-1 text-[12px] leading-relaxed text-ink-faint">
                  Den, kdy se tomu chceš věnovat — ten se ukáže na Dnes. Termín zůstává tím,
                  dokdy to musí být hotové.
                </p>
              </VyberDne>
            )}
            {picker === 'client' && (
              <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {clients.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={clientId === c.id}
                    onClick={() => {
                      setClientId(c.id)
                      if (project && project.clientId !== c.id) setProjectId('')
                      setPicker(null)
                    }}
                    className={`${pill} inline-flex items-center gap-1.5 ${clientId === c.id ? 'bg-accent text-card' : 'bg-card text-ink'}`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                    {c.name}
                  </button>
                ))}
                {clientId && (
                  <button
                    type="button"
                    onClick={() => {
                      setClientId('')
                      setProjectId('')
                      setPicker(null)
                    }}
                    className={`${pill} bg-card text-ink-soft`}
                  >
                    Bez klienta
                  </button>
                )}
                {clients.length === 0 && (
                  <span className="px-1 py-1.5 text-[13px] text-ink-faint">Zatím žádní klienti — založ je v záložce Klienti.</span>
                )}
              </div>
            )}
            {picker === 'project' && (
              <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={projectId === p.id}
                    onClick={() => {
                      setProjectId(p.id)
                      setPicker(null)
                    }}
                    className={`${pill} ${projectId === p.id ? 'bg-accent text-card' : 'bg-card text-ink'}`}
                  >
                    ▸ {p.name}
                  </button>
                ))}
                {projectId && (
                  <button
                    type="button"
                    onClick={() => {
                      setProjectId('')
                      setPicker(null)
                    }}
                    className={`${pill} bg-card text-ink-soft`}
                  >
                    Bez projektu
                  </button>
                )}
                {projects.length === 0 && (
                  <span className="px-1 py-1.5 text-[13px] text-ink-faint">
                    {client ? `${client.name} nemá projekty.` : 'Nejdřív vyber klienta.'}
                  </span>
                )}
              </div>
            )}
            {picker === 'priority' && (
              <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={priority === p}
                    onClick={() => {
                      setPriority(p)
                      setPicker(null)
                    }}
                    className={`${pill} ${priority === p ? 'bg-accent text-card' : 'bg-card text-ink'}`}
                  >
                    {PRIORITY_LABELS[p]}
                  </button>
                ))}
              </div>
            )}
            {picker === 'recurrence' && (
              <div className="space-y-2.5">
                {/* frekvence */}
                <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  <button
                    type="button"
                    aria-pressed={!rule}
                    onClick={() => {
                      nastavPravidlo(null)
                      setPicker(null)
                    }}
                    className={`${pill} ${!rule ? 'bg-accent text-card' : 'bg-card text-ink-soft'}`}
                  >
                    Neopakuje se
                  </button>
                  {(Object.keys(PRESET_LABELS) as RecurrencePreset[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={parts?.preset === p}
                      onClick={() => zvolPredvolbu(p)}
                      className={`${pill} ${parts?.preset === p ? 'bg-accent text-card' : 'bg-card text-ink'}`}
                    >
                      {PRESET_LABELS[p]}
                    </button>
                  ))}
                  {rule && !parts && (
                    <span className={`${pill} bg-accent text-card`}>Vlastní ({humanizeRule(rule)})</span>
                  )}
                </div>

                {/* den: u týdenních dny v týdnu (i víc naráz), u měsíčních
                    den v měsíci jako mřížka 7 × 4, u ročních ještě měsíc */}
                {parts && (parts.preset === 'weekly' || parts.preset === 'biweekly') && (
                  <div className="flex gap-1" role="group" aria-label="Dny v týdnu">
                    {WEEKDAYS.map(([kod, popisek]) => {
                      const on = parts.byday.includes(kod)
                      return (
                        <button
                          key={kod}
                          type="button"
                          aria-pressed={on}
                          onClick={() => prepniDen(kod)}
                          className={`h-10 min-w-0 flex-1 rounded-full text-[13px] font-medium transition-[background-color,color,transform] duration-150 active:scale-95 ${
                            on ? 'bg-accent text-card' : 'bg-card text-ink'
                          }`}
                        >
                          {popisek}
                        </button>
                      )
                    })}
                  </div>
                )}
                {parts && (parts.preset === 'monthly' || parts.preset === 'quarterly' || parts.preset === 'yearly') && (
                  <div className="grid grid-cols-7 gap-1" role="group" aria-label="Den v měsíci">
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={parts.dom === d}
                        onClick={() => nastavPravidlo(ruleFromParts({ ...parts, dom: d }))}
                        className={`h-9 rounded-full text-[14px] tabular-nums transition-[background-color,color,transform] duration-150 active:scale-95 ${
                          parts.dom === d ? 'bg-accent font-semibold text-card' : 'bg-card text-ink'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
                {parts && parts.preset === 'yearly' && (
                  <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }} role="group" aria-label="Měsíc">
                    {MONTHS.map((nazev, i) => (
                      <button
                        key={nazev}
                        type="button"
                        aria-pressed={parts.month === i + 1}
                        onClick={() => nastavPravidlo(ruleFromParts({ ...parts, month: i + 1 }))}
                        className={`${pill} ${parts.month === i + 1 ? 'bg-accent text-card' : 'bg-card text-ink'}`}
                      >
                        {nazev}
                      </button>
                    ))}
                  </div>
                )}

                {rule && (
                  <p className="px-1 text-[12px] leading-relaxed text-ink-faint">
                    {velkePismeno(humanizeRule(rule))}
                    {dueDate && ` · první výskyt ${formatDayLabel(dueDate)}`}. Po odškrtnutí se úkol sám založí na další termín.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Checklist — jedna karta, kroky a pole pro další v ní. */}
        <section>
          <h3 className="section-label mb-1.5">
            podúkoly
            {subtasks.length > 0 && ` · ${subtasks.filter((s) => s.done).length}/${subtasks.length}`}
          </h3>
          <div className="divide-y divide-line overflow-hidden rounded-2xl bg-well">
            {subtasks.map((s) => (
              <div key={s.id} className="flex items-center gap-2.5 px-3 py-2">
                <button
                  type="button"
                  aria-label={s.done ? `Vrátit podúkol ${s.title}` : `Dokončit podúkol ${s.title}`}
                  onClick={() => {
                    persistSubtasks(subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))
                    // krok z Todoistu se odškrtne i tam
                    void setTodoistSubtaskDone(s.id, !s.done)
                  }}
                  className="-m-1.5 shrink-0 p-1.5 transition-transform duration-150 active:scale-90"
                >
                  <span
                    key={String(s.done)}
                    className={`pop flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-200 ${
                      s.done ? 'border-accent bg-accent text-card' : 'border-edge text-transparent'
                    }`}
                  >
                    <svg viewBox="0 0 20 20" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4.5 10.5l3.8 3.8 7.2-8.6" />
                    </svg>
                  </span>
                </button>
                <span className={`min-w-0 flex-1 truncate text-[15px] ${s.done ? 'text-ink-faint line-through' : 'text-ink'}`}>
                  {s.title}
                </span>
                {/* Krok z Todoistu odsud mazat nejde — smazal by se
                    klientovi v jeho projektu a stejně by se vrátil. */}
                {s.id.startsWith(SUB_PREFIX) ? (
                  <span className="shrink-0 text-[11px] text-ink-faint" title="Krok z Todoistu">
                    Todoist
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Smazat podúkol ${s.title}`}
                    onClick={() => persistSubtasks(subtasks.filter((x) => x.id !== s.id))}
                    className="-m-2 shrink-0 p-2 text-ink-faint transition-transform duration-150 active:scale-90"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-2.5 px-3 py-1">
              <span className="h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-dashed border-edge" />
              <input
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] text-ink outline-none placeholder:text-ink-faint"
                aria-label="Přidat podúkol"
                placeholder="Přidat krok…"
                value={newSub}
                enterKeyHint="done"
                onChange={(e) => setNewSub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addSubtask()
                  }
                }}
              />
              {newSub.trim() && (
                <button
                  type="button"
                  aria-label="Přidat podúkol"
                  onClick={() => void addSubtask()}
                  className="pop flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-card transition-transform duration-150 active:scale-90"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Ukládá se hned při přepnutí, ne až tlačítkem: „kdo to vidí" je
            rozhodnutí o datech, ne rozepsaný text, a nemá čekat na Uložit. */}
        <TaskSharing
          taskId={task.id}
          clientId={clientId || undefined}
          hiddenFrom={hiddenFrom}
          onChange={setHiddenFrom}
        />

        {fromTodoist && (
          <section className="space-y-2">
            <p className="text-[13px] leading-relaxed text-ink-soft">
              Název, termín a priorita se odsud píšou i do Todoistu.
              {task.todoistRecurring && ' Opakuje se; odškrtnutím se posune na další termín.'}
            </p>
            <a
              href={`https://app.todoist.com/app/task/${task.todoistId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-deep"
            >
              Otevřít v Todoistu
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 5h5v5M19 5l-8 8M18 13.5V19H5V6h5.5" />
              </svg>
            </a>
            <TodoistTalk task={task} />
          </section>
        )}

        {/* Lokální úkol u klienta s napojeným Todoistem — jedním ťuknutím
            ho uvidí i klient. Nikdy se to nestane samo bez zapnutí. */}
        {!fromTodoist && todoistClient && (
          <Button
            variant="secondary"
            className="w-full justify-start"
            disabled={sendState === 'sending' || sendState === 'sent'}
            onClick={async () => {
              setSendState('sending')
              await updateTask(task.id, {
                title: title.trim(),
                notes: notes.trim() || undefined,
                priority,
                dueDate: dueDate || undefined,
                dueTime: dueDate && dueTime ? dueTime : undefined,
              })
              const err = await sendTaskToTodoist(task.id)
              setSendState(err ?? 'sent')
            }}
          >
            {sendState === 'sending'
              ? 'Posílám…'
              : sendState === 'sent'
                ? `Odesláno do Todoistu — ${todoistClient.name} to teď vidí`
                : sendState === 'idle'
                  ? `Poslat do Todoistu (${todoistClient.name})`
                  : sendState}
          </Button>
        )}

        {/* Jediná otázka, která zbyla: smazání v Todoistu vzít zpět nejde,
            protože úkol zmizí i klientovi ve sdíleném projektu. Ptá se
            přímo v panelu, ne systémovým dialogem. */}
        {ptamSeNaTodoist && (
          <div className="rise rounded-2xl bg-well p-3">
            <p className="text-[13px] text-ink-soft">
              Smazat úkol i v Todoistu? Tam zmizí i klientovi ve sdíleném projektu
              a zpátky ho nevrátíš.
            </p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPtamSeNaTodoist(false)}>
                Zrušit
              </Button>
              <Button variant="secondary" size="sm" className="bg-card" onClick={() => void del(close)}>
                Jen tady
              </Button>
              <Button size="sm" className="bg-danger" onClick={() => void del(close, true)}>
                I v Todoistu
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <Button
            variant="destructive"
            className="-ml-2"
            onClick={() => (fromTodoist ? setPtamSeNaTodoist(true) : void del(close))}
          >
            Smazat
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close}>
              Zrušit
            </Button>
            <Button disabled={!title.trim()} onClick={() => void save(close)}>
              Uložit
            </Button>
          </div>
        </div>
        </>
        )
      }}
    </Sheet>
  )
}

const commentFmt = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

// Konverzace u úkolu ve sdíleném projektu. Tady se s klientem doopravdy
// domlouvá, takže je to v appce k ničemu, když to musím číst jinde.
// Stahuje se až při otevření úkolu a ukládá se do něj — offline i na
// druhém zařízení je pak vidět, co bylo řečeno.
function TodoistTalk({ task }: { task: Task }) {
  const [comments, setComments] = useState<TodoistComment[]>(task.todoistComments ?? [])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void loadTodoistComments(task.id).then(async (err) => {
      if (!alive) return
      if (err) setError(err === 'offline' ? null : err)
      const fresh = await getTask(task.id)
      if (alive && fresh) setComments(fresh.todoistComments ?? [])
    })
    return () => {
      alive = false
    }
  }, [task.id])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    const err = await postTodoistComment(task.id, body)
    if (err) setError(err)
    else {
      setText('')
      const fresh = await getTask(task.id)
      setComments(fresh?.todoistComments ?? [])
    }
    setBusy(false)
  }

  return (
    <div>
      <h3 className="section-label mb-1.5">konverzace v Todoistu</h3>
      {comments.length > 0 && (
        <ul className="mb-1.5 space-y-1.5">
          {comments.map((c) => (
            <li key={c.id} className="rounded-2xl bg-well px-3 py-2">
              <p className="text-[11px] text-ink-faint">
                {c.author || 'někdo'}
                {/* datum komentáře je z Todoistu, tedy cizí vstup —
                    Intl na neplatném datu vyhodí výjimku a shodil by detail */}
                {jePlatnyCas(c.at) && ` · ${commentFmt.format(new Date(c.at))}`}
              </p>
              <p className="whitespace-pre-wrap text-[14px] text-ink">{c.text}</p>
              {c.attachment && (
                <p className="mt-0.5 text-[12px] text-ink-faint">📎 {c.attachment} (v Todoistu)</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {comments.length === 0 && (
        <p className="mb-1.5 px-1 text-[13px] text-ink-faint">Zatím nic. Napiš první.</p>
      )}
      <div className="flex items-center gap-2 rounded-full bg-well pl-4 pr-1">
        <input
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[16px] text-ink outline-none placeholder:text-ink-faint"
          aria-label="Odpověď na komentář"
          placeholder="Odpovědět…"
          value={text}
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button
          type="button"
          aria-label="Odeslat komentář"
          disabled={busy || !text.trim()}
          onClick={() => void send()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-card transition-transform duration-150 active:scale-90 disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  )
}
