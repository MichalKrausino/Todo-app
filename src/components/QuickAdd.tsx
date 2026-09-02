import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import type { CalendarEvent, Priority, Task } from '../db/types'
import { activeClients, addTask, allProjects, calendarCacheCount, calendarEventsOn, openTasks, removeTask } from '../db/repo'
import { addDays, formatDayLabel, formatEventRange, formatFullDate, fromISODate, nextMonday, toISODate, todayISO } from '../lib/dates'
import { WORK_END, WORK_START, freeMinutes, minutesToLabel, type BusyInterval } from '../lib/freeSlot'
import { PRIORITY_LABELS } from '../lib/labels'
import { foldToken, mentionToken, parseQuickAdd } from '../lib/quickAdd'
import { humanizeRule } from '../lib/rrule'
import { FETCH_WINDOW_DAYS } from '../sync/calendar'
import { MonthPicker } from './MonthPicker'

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n < 5 ? few : many


// Rozepsaný @klient / #projekt na konci textu → našeptávač nad polem.
const RE_MENTION = /(^|\s)([@#])(\S*)$/

// Ruční výběry z lišty (Termín/Klient/Projekt/Priorita) přebíjejí parser:
// undefined = neurčeno (platí text), null = vědomě odebráno.
interface Overrides {
  dueDate?: string | null
  dueTime?: string | null
  clientId?: string | null
  projectId?: string | null
  priority?: Priority | null
}

type PickerKind = 'date' | 'client' | 'project' | 'priority' | null

// Rychlé dny nad kalendářem — jedna definice, ať tlačítka nesou stav
// (vybraný den se vyplní) a nedublují se s chipem nad polem.
const QUICK_DAYS: { label: string; day: (today: string) => string }[] = [
  { label: 'Dnes', day: (t) => t },
  { label: 'Zítra', day: (t) => toISODate(addDays(fromISODate(t), 1)) },
  // „Pondělí" místo „Příští týden": kratší, a přesně to dělá — jinak se
  // řádka rychlých dnů ořezávala uprostřed slova „Bez termínu".
  { label: 'Pondělí', day: (t) => toISODate(nextMonday(fromISODate(t))) },
]

const pill = 'shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-transform duration-150 active:scale-95'
// Jeden tvar pro celou stavovou řádku — sloty i to, co vyčetl parser.
const slotBase =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium'

// defaultToToday: na obrazovce Dnes jde úkol bez data na dnešek (scheduledFor)
// — kdo píše na Dnes, myslí „udělám to dnes". Jinde bez data → inbox.
export function QuickAdd({
  onShowUpcoming,
  defaultToToday = false,
  autoFocus = false,
}: {
  onShowUpcoming?: () => void
  defaultToToday?: boolean
  /** rozbalené zadávání v doku si vyžádá fokus do pole */
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  // Výběr termínu potřebuje místo — kalendář zmáčknutý nad klávesnici je
  // k nepřečtení. Otevření proto klávesnici schová (psaní stejně nikdo
  // nepokračuje uprostřed vybírání dne) a panel se rozloží na celou výšku.
  // Ostatní výběry jsou jednořádkové, tam klávesnice zůstává.
  const openPicker = (kind: PickerKind) => {
    const zaviram = picker === kind
    setPicker(zaviram ? null : kind)
    if (kind !== 'date') return
    // Zavření termínu vrátí klávesnici, ať se dá rovnou psát dál.
    if (zaviram) inputRef.current?.focus()
    else inputRef.current?.blur()
  }
  const [overrides, setOverrides] = useState<Overrides>({})
  const [picker, setPicker] = useState<PickerKind>(null)
  // Počítadlo přidaných úkolů — mění key tlačítka, takže po každém
  // přidání proběhne potvrzovací pop (hmatová odezva bez haptiky).
  const [addedCount, setAddedCount] = useState(0)
  // Pojistka proti špatnému parsování: pár vteřin po přidání jde úkol vrátit.
  const [lastAdded, setLastAdded] = useState<{ id: string; title: string; dueDate?: string } | null>(
    null,
  )
  const [toastLeaving, setToastLeaving] = useState(false)
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const clients = useLiveQuery(activeClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []

  useEffect(() => () => clearTimeout(undoTimer.current), [])

  // Příklad z prázdného stavu na Dnes se vloží rovnou do pole a zaostří
  // ho — uživatel vidí, co parser z věty vytáhne, a jen odešle.
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])
  useEffect(() => {
    const fill = (e: Event) => {
      const text = (e as CustomEvent<string>).detail
      if (typeof text !== 'string') return
      setText(text)
      setOverrides({})
      inputRef.current?.focus()
    }
    window.addEventListener('todo:prefill', fill)
    return () => window.removeEventListener('todo:prefill', fill)
  }, [])

  const parsed = useMemo(
    () => (text.trim() ? parseQuickAdd(text, clients, new Date(), projects) : null),
    [text, clients, projects],
  )

  // Efektivní hodnoty: ruční výběr má přednost před textem.
  const effDueDate = overrides.dueDate === undefined ? parsed?.dueDate : (overrides.dueDate ?? undefined)
  const effDueTime = overrides.dueTime === undefined ? parsed?.dueTime : (overrides.dueTime ?? undefined)
  const effClientId = overrides.clientId === undefined ? parsed?.clientId : (overrides.clientId ?? undefined)
  const effProjectId = overrides.projectId === undefined ? parsed?.projectId : (overrides.projectId ?? undefined)
  const effPriority: Priority =
    (overrides.priority === undefined ? parsed?.priority : overrides.priority) ?? 'normal'

  const effClient = effClientId ? clients.find((c) => c.id === effClientId) : undefined
  const effProject = effProjectId ? projects.find((p) => p.id === effProjectId) : undefined
  const projectPool = effClientId ? projects.filter((p) => p.clientId === effClientId) : projects

  // Na Dnes dostane úkol bez data plán na dnešek — vidět předem jako chip.
  // Vědomé „bez termínu" z výběru (null) default vypíná.
  const impliedToday = Boolean(
    defaultToToday && parsed && !parsed.recurrenceRule && !effDueDate && overrides.dueDate === undefined,
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

  // Náhled vytížení vybraného dne (schůzky z kalendáře + už naplánované
  // úkoly + volno) — živě se mění při vybírání data. Dotazy běží jen
  // s otevřeným výběrem termínu.
  const previewDay = picker === 'date' ? (effDueDate ?? todayISO()) : null
  const previewEvents =
    useLiveQuery(
      () => (previewDay ? calendarEventsOn(previewDay) : Promise.resolve<CalendarEvent[]>([])),
      [previewDay],
    ) ?? []
  const previewOpen =
    useLiveQuery(
      () => (previewDay ? openTasks() : Promise.resolve<Task[]>([])),
      [previewDay],
    ) ?? []
  // úkoly dne = termín NEBO plán na ten den (ne jen „nejbližší den")
  const previewTasks = previewDay
    ? previewOpen.filter((t) => t.dueDate === previewDay || t.scheduledFor === previewDay)
    : []
  // agenda seřazená jak den poběží: celodenní → schůzky podle času
  const previewAgenda = [...previewEvents].sort((a, b) =>
    a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1,
  )
  // U dneška se volno počítá od teď (stejně jako na Dnes) — jinak by
  // stejný den hlásil na dvou místech dvě různá čísla.
  const previewFrom =
    previewDay === todayISO()
      ? Math.min(Math.max(new Date().getHours() * 60 + new Date().getMinutes(), WORK_START), WORK_END)
      : WORK_START
  const previewBusy: BusyInterval[] = previewEvents
    .filter((e) => !e.allDay)
    .map((e) => {
      const s = new Date(e.start)
      const en = new Date(e.end)
      return { startMin: s.getHours() * 60 + s.getMinutes(), endMin: en.getHours() * 60 + en.getMinutes() }
    })
  // cache kalendáře drží okno FETCH_WINDOW_DAYS — dál appka schůzky nevidí
  const beyondCalendarWindow = Boolean(
    previewDay && previewDay > toISODate(addDays(fromISODate(todayISO()), FETCH_WINDOW_DAYS)),
  )
  // prázdná cache = kalendář ještě není propojený — říct to na rovinu
  const calendarConnected = (useLiveQuery(calendarCacheCount, []) ?? 0) > 0

  // Shrnutí dne do jedné věty v hlavičce náhledu. Prázdný den řekne
  // „volný den" a nepotřebuje pod sebou další řádek, který totéž zopakuje.
  const previewSummary = (() => {
    const parts: string[] = []
    if (previewEvents.length > 0)
      parts.push(`${previewEvents.length} ${plural(previewEvents.length, 'schůzka', 'schůzky', 'schůzek')}`)
    if (previewTasks.length > 0)
      parts.push(`${previewTasks.length} ${plural(previewTasks.length, 'úkol', 'úkoly', 'úkolů')}`)
    if (parts.length === 0) return 'volný den'
    if (previewEvents.length > 0)
      parts.push(
        `${previewDay === todayISO() ? 'zbývá' : 'volno'} ~${minutesToLabel(freeMinutes(previewBusy, previewFrom))}`,
      )
    return parts.join(' · ')
  })()

  // Schůzky a úkoly dne v jednom seznamu, nejvýš tři řádky — kolik jich
  // je doopravdy, stojí v hlavičce, takže „…a N dalších" je jen šum.
  const previewRows = [
    ...previewAgenda.map((e) => ({
      id: e.id,
      when: formatEventRange(e),
      title: e.title,
      dot: 'color-mix(in oklab, var(--color-accent) 60%, transparent)',
    })),
    ...previewTasks.map((t) => ({
      id: t.id,
      when: 'úkol',
      title: t.title,
      dot:
        (t.clientId ? clients.find((c) => c.id === t.clientId)?.color : undefined) ??
        'var(--color-ink-faint)',
    })),
  ].slice(0, 3)

  const setOv = (patch: Overrides) => {
    setOverrides((o) => ({ ...o, ...patch }))
    setPicker(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed || !parsed.title) return
    const task = await addTask({
      title: parsed.title,
      dueDate: effDueDate,
      dueTime: effDueTime,
      scheduledFor: impliedToday ? todayISO() : undefined,
      clientId: effClientId,
      projectId: effProjectId,
      priority: effPriority,
      recurrenceRule: parsed.recurrenceRule,
      notes: parsed.notes,
    })
    setText('')
    setOverrides({})
    setPicker(null)
    setAddedCount((n) => n + 1)
    setToastLeaving(false)
    setLastAdded({ id: task.id, title: task.title, dueDate: task.scheduledFor ?? task.dueDate })
    clearTimeout(undoTimer.current)
    // toast odejde animovaně: nejdřív třída .toast-out, pak odmontování
    undoTimer.current = setTimeout(() => {
      setToastLeaving(true)
      undoTimer.current = setTimeout(() => setLastAdded(null), 300)
    }, 5700)
  }

  const undo = async () => {
    if (!lastAdded) return
    clearTimeout(undoTimer.current)
    await removeTask(lastAdded.id)
    setLastAdded(null)
  }

  const today = todayISO()
  const keepFocus = (e: React.PointerEvent) => e.preventDefault()
  // Popisky slotů: prázdný slot ukazuje, co umí; vyplněný rovnou hodnotu.
  // Jedna řádka místo dvou (náhled + lišta) — dřív totéž svítilo dvakrát
  // pod sebou a s každou volbou přibyl řádek, což posouvalo pole.
  const dateLabel = (effDueDate || impliedToday)
    ? formatDayLabel(effDueDate ?? today) + (effDueTime ? ` ${effDueTime}` : '')
    : undefined

  return (
    // pb: iOS kolem zaostřeného pole kreslí vlastní modrý prstenec kus za
    // jeho okrajem. Zadávání se kvůli skládací animaci ořezává, takže bez
    // téhle rezervy byl prstenec dole seříznutý.
    <div className="relative px-3 pt-2.5 pb-1.5">
      {lastAdded && createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3"
          style={{ bottom: 'calc(var(--dock-h, 9rem) + var(--vv-bottom, 0px) + 0.75rem)' }}
        >
          <div className={`${toastLeaving ? 'toast-out' : 'pop'} pointer-events-auto flex items-center gap-2 rounded-full bg-ink/90 py-1.5 pl-4 pr-1.5 shadow-float backdrop-blur`}>
            <span className="max-w-48 truncate text-[13px] text-paper">
              {lastAdded.dueDate
                ? `${formatDayLabel(lastAdded.dueDate)} — „${lastAdded.title}“`
                : `Do inboxu — „${lastAdded.title}“`}
            </span>
            {/* „Zobrazit" má smysl u všeho, co po přidání zmizí z očí —
                nejen u inboxu: úkol na zítřek se z obrazovky Dnes taky
                ztratí a bez odkazu není kam se za ním podívat. */}
            {lastAdded.dueDate !== today && onShowUpcoming && (
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
        </div>,
        document.body,
      )}

      {/* Jediné místo, kde se cokoli rozbaluje. Roste nahoru, pole pod ním
          zůstává na místě — dřív se s každým otevřeným výběrem posunulo
          a iOS nechal kurzor viset nad ním. */}
      {(mention || picker) && (
        <div className="rise mb-2 overflow-hidden rounded-2xl bg-well/60">
          {/* Strop podle toho, co je vidět (nad klávesnicí), ne podle celé
              obrazovky — s otevřeným kalendářem jinak zadávání přerostlo
              volné místo a vylezlo nad horní okraj. */}
          <div
            className="overflow-y-auto overscroll-contain p-2"
            style={{ maxHeight: 'max(8rem, calc(var(--vvh, 100dvh) - 12rem))' }}
          >
      {mention && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1" style={{ scrollbarWidth: 'none' }}>
          {mention.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onPointerDown={keepFocus}
              onClick={() => pickMention(item.name)}
              className={`${pill} inline-flex items-center gap-1.5 bg-card text-ink`}
            >
              {item.color && <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />}
              {item.name}
            </button>
          ))}
        </div>
      )}

      {/* výběr po ťuknutí na tlačítko lišty nebo chip */}
      {picker === 'date' && (
        <div className="max-h-[46vh] overflow-y-auto overflow-x-hidden overscroll-contain">
          {/* výběr dne nezavírá sekci — heatmapa i agenda se mění živě.
              Rychlé volby nesou i stav: vybraný den je plný, ne jen nabídka —
              jinak „Dnes" svítilo v doku dvakrát vedle sebe jako dvě různé věci. */}
          <div className="rise -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1.5" style={{ scrollbarWidth: 'none' }}>
            {QUICK_DAYS.map(({ label, day }) => {
              const iso = day(today)
              const on = (effDueDate ?? (impliedToday ? today : undefined)) === iso
              return (
                <button
                  key={label}
                  type="button"
                  onPointerDown={keepFocus}
                  onClick={() => setOverrides((o) => ({ ...o, dueDate: iso }))}
                  aria-pressed={on}
                  className={`${pill} ${on ? 'bg-accent text-card' : 'bg-card text-ink'}`}
                >
                  {label}
                </button>
              )
            })}
            {/* „Bez termínu" je tu vždycky a když termín není, je vybraná
                ona — jinak nešlo poznat, jestli jsem den ještě nevybral,
                nebo se jen výběr nikde neprojevil. */}
            <button
              type="button"
              onPointerDown={keepFocus}
              onClick={() => setOv({ dueDate: null, dueTime: null })}
              aria-pressed={!effDueDate && !impliedToday}
              className={`${pill} ${!effDueDate && !impliedToday ? 'bg-accent text-card' : 'bg-card text-ink-soft'}`}
            >
              Bez termínu
            </button>
          </div>

          {/* vlastní kalendářík s heatmapou vytížení dnů.
              Vybraný den se řídí i tichým „dnes" na obrazovce Dnes — jinak
              svítilo tlačítko Dnes vybrané, ale v kalendáři nebylo označeno nic. */}
          <MonthPicker
            value={effDueDate ?? (impliedToday ? today : undefined)}
            onSelect={(iso) => setOverrides((o) => ({ ...o, dueDate: iso }))}
          />

          {/* čas termínu — volitelný, a jen když už je vybraný den:
              čas bez dne nic neznamená a řádek navíc jen roztahoval dok */}
          {(effDueDate || impliedToday) && (
          <div className="rise -mx-1 mb-1.5 flex items-center gap-1.5 overflow-x-auto px-1" style={{ scrollbarWidth: 'none' }}>
            <span className="shrink-0 pl-1 text-[12px] font-medium text-ink-faint">Čas</span>
            {['9:00', '12:00', '14:00', '16:00'].map((t) => {
              const v = t.padStart(5, '0')
              return (
                <button
                  key={t}
                  type="button"
                  onPointerDown={keepFocus}
                  onClick={() =>
                    setOverrides((o) => ({
                      ...o,
                      dueTime: effDueTime === v ? null : v,
                      dueDate: effDueDate ?? today,
                    }))
                  }
                  className={`${pill} ${effDueTime === v ? 'bg-accent text-card' : 'bg-card text-ink'}`}
                >
                  {t}
                </button>
              )
            })}
            <input
              type="time"
              aria-label="Čas termínu"
              value={effDueTime ?? ''}
              onChange={(e) =>
                setOverrides((o) => ({
                  ...o,
                  dueTime: e.target.value || null,
                  dueDate: e.target.value ? (effDueDate ?? today) : effDueDate,
                }))
              }
              className="shrink-0 rounded-full border border-transparent bg-card px-3 py-1 text-[13px] font-medium text-ink outline-none focus:border-accent/50"
            />
            {effDueTime && (
              <button type="button" onPointerDown={keepFocus} onClick={() => setOverrides((o) => ({ ...o, dueTime: null }))} aria-label="Zrušit čas" className={`${pill} bg-card text-ink-soft`}>
                ✕
              </button>
            )}
          </div>
          )}

          {/* Náhled vybraného dne. Držet krátce: v doku nad klávesnicí je
              každý řádek drahý, a přesné počty jsou stejně v hlavičce —
              proto max tři řádky a žádné „…a N dalších". */}
          {previewDay && (
            <div className="rise mb-1 overflow-hidden rounded-2xl bg-card shadow-card">
              <div className="flex items-baseline justify-between gap-2 px-3 py-1.5">
                {/* plné datum, ne „Dnes" — to už svítí na vybraném tlačítku
                    nad kalendářem a dvakrát pod sebou působilo jako dvě věci */}
                <span className="text-[13px] font-semibold text-ink first-letter:uppercase">
                  {formatFullDate(fromISODate(previewDay))}
                </span>
                <span className="shrink-0 text-[12px] text-ink-soft">{previewSummary}</span>
              </div>

              {previewRows.length > 0 && (
                <div className="border-t border-line">
                  {previewRows.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 px-3 py-1 text-[13px]">
                      <span className="w-[5.5rem] shrink-0 whitespace-nowrap tabular-nums text-ink-soft">
                        {r.when}
                      </span>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.dot }} />
                      <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span>
                    </div>
                  ))}
                  <div className="h-1" />
                </div>
              )}

              {!calendarConnected && (
                <div className="border-t border-line px-3 py-1.5 text-[11px] text-ink-faint">
                  Schůzky se ukážou po propojení Google kalendáře (Synchronizace).
                </div>
              )}
              {calendarConnected && beyondCalendarWindow && (
                <div className="border-t border-line px-3 py-1.5 text-[11px] text-ink-faint">
                  Kalendář dohlédne ~{Math.round(FETCH_WINDOW_DAYS / 30)} měsíců dopředu —
                  úkoly platí, schůzky dál nemusí být vidět.
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {picker === 'client' && (
        <div className="rise -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" style={{ scrollbarWidth: 'none' }}>
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              onPointerDown={keepFocus}
              onClick={() => setOv({ clientId: c.id, projectId: effProject && effProject.clientId !== c.id ? null : overrides.projectId })}
              className={`${pill} inline-flex items-center gap-1.5 ${effClientId === c.id ? 'bg-accent text-card' : 'bg-card text-ink'}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
          {effClientId && (
            <button type="button" onPointerDown={keepFocus} onClick={() => setOv({ clientId: null, projectId: null })} className={`${pill} bg-card text-ink-soft`}>
              Bez klienta
            </button>
          )}
          {clients.length === 0 && (
            <span className="px-1 py-1.5 text-[13px] text-ink-faint">Zatím žádní klienti — založ je v záložce Klienti.</span>
          )}
        </div>
      )}
      {picker === 'project' && (
        <div className="rise -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" style={{ scrollbarWidth: 'none' }}>
          {projectPool.map((p) => (
            <button
              key={p.id}
              type="button"
              onPointerDown={keepFocus}
              onClick={() => setOv({ projectId: p.id, clientId: effClientId ?? p.clientId })}
              className={`${pill} ${effProjectId === p.id ? 'bg-accent text-card' : 'bg-card text-ink'}`}
            >
              ▸ {p.name}
            </button>
          ))}
          {effProjectId && (
            <button type="button" onPointerDown={keepFocus} onClick={() => setOv({ projectId: null })} className={`${pill} bg-card text-ink-soft`}>
              Bez projektu
            </button>
          )}
          {projectPool.length === 0 && (
            <span className="px-1 py-1.5 text-[13px] text-ink-faint">
              {effClient ? `${effClient.name} nemá projekty.` : 'Zatím žádné projekty.'}
            </span>
          )}
        </div>
      )}
      {picker === 'priority' && (
        <div className="rise -mx-1 flex gap-1.5 overflow-x-auto px-1" style={{ scrollbarWidth: 'none' }}>
          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
            <button
              key={p}
              type="button"
              onPointerDown={keepFocus}
              onClick={() => setOv({ priority: p === 'normal' ? null : p })}
              className={`${pill} ${effPriority === p ? 'bg-accent text-card' : 'bg-card text-ink'}`}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
      )}
          </div>
        </div>
      )}

      {/* Stav úkolu na jedné řádce: prázdný slot říká, co umí, vyplněný
          ukazuje hodnotu. Nikdy se nezalamuje (přeteče do strany), takže
          výška zadávání je pořád stejná a pole se nehýbe. */}
      <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1" style={{ scrollbarWidth: 'none' }}>
        <SlotChip
          slot="date"
          label="Termín"
          value={dateLabel}
          open={picker === 'date'}
          onTap={() => openPicker('date')}
          icon={<path d="M4.5 6.5h15v13h-15zM4.5 10h15M8.5 4v4M15.5 4v4" />}
        />
        <SlotChip
          slot="client"
          label="Klient"
          value={effClient?.name}
          dot={effClient?.color}
          open={picker === 'client'}
          onTap={() => openPicker('client')}
          icon={<><circle cx="12" cy="8.5" r="3.5" /><path d="M5.5 19.5c.8-3.4 3.4-5.25 6.5-5.25s5.7 1.85 6.5 5.25" /></>}
        />
        <SlotChip
          slot="project"
          label="Projekt"
          value={effProject?.name}
          open={picker === 'project'}
          onTap={() => openPicker('project')}
          icon={<path d="M4 7.5a2 2 0 012-2h4l2 2.5h6a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2z" />}
        />
        <SlotChip
          slot="priority"
          label="Priorita"
          value={effPriority !== 'normal' ? PRIORITY_LABELS[effPriority] : undefined}
          open={picker === 'priority'}
          onTap={() => openPicker('priority')}
          icon={<path d="M12 5v9M12 17.5v1" />}
        />
        {/* co vyčetl parser a nemá vlastní slot — jen na ukázání */}
        {parsed?.recurrenceRule && (
          <span key={`r:${parsed.recurrenceRule}`} className={`${slotBase} pop-soft bg-accent-wash text-accent-deep`}>
            ↻ {humanizeRule(parsed.recurrenceRule)}
          </span>
        )}
        {parsed?.notes && (
          <span key="n" className={`${slotBase} pop-soft max-w-40 truncate bg-accent-wash text-accent-deep`}>
            ✎ {parsed.notes}
          </span>
        )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Napiš úkol…"
          enterKeyHint="done"
          className="min-w-0 flex-1 appearance-none rounded-full border border-transparent bg-well px-4 py-2.5 text-[16px] text-ink outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent/50 focus:bg-card focus-visible:outline-none"
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

// Slot stavu úkolu. Tři stavy, aby bylo na první pohled jasné, co platí:
// prázdný (tichý, jen nabízí), vyplněný (akcentní, ukazuje hodnotu)
// a otevřený (plný akcent — patří k němu panel nad polem).
function SlotChip({
  slot,
  label,
  value,
  dot,
  open,
  onTap,
  icon,
}: {
  slot: string
  label: string
  value?: string
  dot?: string
  open: boolean
  onTap: () => void
  icon: React.ReactNode
}) {
  const tone = open
    ? 'bg-accent text-card'
    : value
      ? 'bg-accent-wash text-accent-deep'
      : 'bg-well/60 text-ink-soft'
  return (
    <button
      type="button"
      data-slot={slot}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onTap}
      aria-label={value ? `${label}: ${value}` : label}
      aria-pressed={open}
      className={`${slotBase} ${tone} transition-[background-color,color,transform] duration-150 active:scale-95`}
    >
      {dot ? (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
      ) : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      )}
      <span className="max-w-32 truncate">{value ?? label}</span>
    </button>
  )
}
