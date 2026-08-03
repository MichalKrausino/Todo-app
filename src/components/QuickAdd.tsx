import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { CalendarEvent, Priority, Task } from '../db/types'
import { activeClients, addTask, allProjects, calendarEventsOn, openTasks, removeTask } from '../db/repo'
import { formatDayLabel, fromISODate, addDays, nextMonday, toISODate, todayISO } from '../lib/dates'
import { freeMinutes, minutesToLabel, type BusyInterval } from '../lib/freeSlot'
import { PRIORITY_LABELS } from '../lib/labels'
import { foldToken, mentionToken, parseQuickAdd } from '../lib/quickAdd'
import { humanizeRule } from '../lib/rrule'

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n < 5 ? few : many

// Rozepsaný @klient / #projekt na konci textu → našeptávač nad polem.
const RE_MENTION = /(^|\s)([@#])(\S*)$/

// Ruční výběry z lišty (Termín/Klient/Projekt/Priorita) přebíjejí parser:
// undefined = neurčeno (platí text), null = vědomě odebráno.
interface Overrides {
  dueDate?: string | null
  clientId?: string | null
  projectId?: string | null
  priority?: Priority | null
}

type PickerKind = 'date' | 'client' | 'project' | 'priority' | null

const pill = 'shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-transform duration-150 active:scale-95'
const chip = 'rounded-full px-2.5 py-0.5 font-medium'

// defaultToToday: na obrazovce Dnes jde úkol bez data na dnešek (scheduledFor)
// — kdo píše na Dnes, myslí „udělám to dnes". Jinde bez data → inbox.
export function QuickAdd({
  onShowUpcoming,
  defaultToToday = false,
}: {
  onShowUpcoming?: () => void
  defaultToToday?: boolean
}) {
  const [text, setText] = useState('')
  const [overrides, setOverrides] = useState<Overrides>({})
  const [picker, setPicker] = useState<PickerKind>(null)
  // Počítadlo přidaných úkolů — mění key tlačítka, takže po každém
  // přidání proběhne potvrzovací pop (hmatová odezva bez haptiky).
  const [addedCount, setAddedCount] = useState(0)
  // Pojistka proti špatnému parsování: pár vteřin po přidání jde úkol vrátit.
  const [lastAdded, setLastAdded] = useState<{ id: string; title: string; dueDate?: string } | null>(
    null,
  )
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const clients = useLiveQuery(activeClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []

  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const parsed = useMemo(
    () => (text.trim() ? parseQuickAdd(text, clients, new Date(), projects) : null),
    [text, clients, projects],
  )

  // Efektivní hodnoty: ruční výběr má přednost před textem.
  const effDueDate = overrides.dueDate === undefined ? parsed?.dueDate : (overrides.dueDate ?? undefined)
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
  const previewTasks = previewDay
    ? previewOpen.filter((t) => {
        const d = [t.scheduledFor, t.dueDate].filter(Boolean).sort()[0]
        return d === previewDay
      })
    : []
  const previewBusy: BusyInterval[] = previewEvents
    .filter((e) => !e.allDay)
    .map((e) => {
      const s = new Date(e.start)
      const en = new Date(e.end)
      return { startMin: s.getHours() * 60 + s.getMinutes(), endMin: en.getHours() * 60 + en.getMinutes() }
    })
  // cache kalendáře drží jen 14denní okno — dál appka schůzky nevidí
  const beyondCalendarWindow = Boolean(
    previewDay && previewDay > toISODate(addDays(fromISODate(todayISO()), 14)),
  )

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
    setLastAdded({ id: task.id, title: task.title, dueDate: task.scheduledFor ?? task.dueDate })
    clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setLastAdded(null), 6000)
  }

  const undo = async () => {
    if (!lastAdded) return
    clearTimeout(undoTimer.current)
    await removeTask(lastAdded.id)
    setLastAdded(null)
  }

  const today = todayISO()
  const keepFocus = (e: React.PointerEvent) => e.preventDefault()
  const hasChips =
    effDueDate || impliedToday || effClient || effProject || effPriority !== 'normal' ||
    parsed?.recurrenceRule || parsed?.notes

  return (
    <div className="relative px-3 pt-2.5">
      {lastAdded && (
        <div className="pointer-events-none absolute inset-x-0 -top-12 z-30 flex justify-center">
          <div className="pop pointer-events-auto flex items-center gap-2 rounded-full bg-ink/90 py-1.5 pl-4 pr-1.5 shadow-float backdrop-blur">
            <span className="max-w-48 truncate text-[13px] text-paper">
              {lastAdded.dueDate
                ? `${formatDayLabel(lastAdded.dueDate)} — „${lastAdded.title}“`
                : `Do inboxu — „${lastAdded.title}“`}
            </span>
            {!lastAdded.dueDate && onShowUpcoming && (
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
        </div>
      )}

      {mention && (
        <div className="rise -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" style={{ scrollbarWidth: 'none' }}>
          {mention.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onPointerDown={keepFocus}
              onClick={() => pickMention(item.name)}
              className={`${pill} inline-flex items-center gap-1.5 bg-well text-ink`}
            >
              {item.color && <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />}
              {item.name}
            </button>
          ))}
        </div>
      )}

      {/* náhled — chipy jsou klikací, ťuknutí otevře příslušný výběr */}
      {hasChips && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2 text-[11px]">
          {(effDueDate || impliedToday) && (
            <button
              type="button"
              onPointerDown={keepFocus}
              onClick={() => setPicker(picker === 'date' ? null : 'date')}
              key={`d:${effDueDate ?? 'dnes'}`}
              className={`${chip} pop-soft inline-block bg-accent-wash text-accent-deep`}
            >
              {formatDayLabel(effDueDate ?? today)}
            </button>
          )}
          {parsed?.recurrenceRule && (
            <span key={`r:${parsed.recurrenceRule}`} className={`${chip} pop-soft inline-block bg-accent-wash text-accent-deep`}>
              ↻ {humanizeRule(parsed.recurrenceRule)}
            </span>
          )}
          {effClient && mention?.marker !== '@' && (
            <button
              type="button"
              onPointerDown={keepFocus}
              onClick={() => setPicker(picker === 'client' ? null : 'client')}
              key={`c:${effClient.id}`}
              className={`${chip} pop-soft inline-flex items-center gap-1.5 bg-well text-ink-soft`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: effClient.color }} />
              {effClient.name}
            </button>
          )}
          {effProject && mention?.marker !== '#' && (
            <button
              type="button"
              onPointerDown={keepFocus}
              onClick={() => setPicker(picker === 'project' ? null : 'project')}
              key={`j:${effProject.id}`}
              className={`${chip} pop-soft inline-block bg-well text-ink-soft`}
            >
              ▸ {effProject.name}
            </button>
          )}
          {effPriority !== 'normal' && (
            <button
              type="button"
              onPointerDown={keepFocus}
              onClick={() => setPicker(picker === 'priority' ? null : 'priority')}
              key={`p:${effPriority}`}
              className={`${chip} pop-soft inline-block bg-well text-ink-soft`}
            >
              {PRIORITY_LABELS[effPriority]}
            </button>
          )}
          {parsed?.notes && (
            <span key="n" className={`${chip} pop-soft inline-block max-w-40 truncate bg-well text-ink-soft`}>
              ✎ {parsed.notes}
            </span>
          )}
        </div>
      )}

      {/* výběr po ťuknutí na tlačítko lišty nebo chip */}
      {picker === 'date' && (
        <>
          {/* výběr dne nezavírá řádek — náhled vytížení níže se mění živě */}
          <div className="rise -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-2" style={{ scrollbarWidth: 'none' }}>
            <button type="button" onPointerDown={keepFocus} onClick={() => setOverrides((o) => ({ ...o, dueDate: today }))} className={`${pill} bg-accent-wash text-accent-deep`}>
              Dnes
            </button>
            <button type="button" onPointerDown={keepFocus} onClick={() => setOverrides((o) => ({ ...o, dueDate: toISODate(addDays(fromISODate(today), 1)) }))} className={`${pill} bg-accent-wash text-accent-deep`}>
              Zítra
            </button>
            <button type="button" onPointerDown={keepFocus} onClick={() => setOverrides((o) => ({ ...o, dueDate: toISODate(nextMonday(fromISODate(today))) }))} className={`${pill} bg-accent-wash text-accent-deep`}>
              Příští týden
            </button>
            {/* iOS posílá change průběžně už během výběru — řádek se proto
                NESMÍ hned zavřít (zavřel by i systémový kalendář navázaný
                na tenhle input). Zavírá se až po dokončení výběru (blur). */}
            <input
              type="date"
              aria-label="Vybrat datum"
              value={effDueDate ?? ''}
              onChange={(e) =>
                e.target.value && setOverrides((o) => ({ ...o, dueDate: e.target.value }))
              }
              onBlur={() => setPicker(null)}
              className="h-8 shrink-0 rounded-full border border-line bg-card px-2.5 text-[13px] text-ink outline-none"
            />
            {(effDueDate || impliedToday) && (
              <button type="button" onPointerDown={keepFocus} onClick={() => setOv({ dueDate: null })} className={`${pill} bg-well text-ink-soft`}>
                ✕ Bez termínu
              </button>
            )}
          </div>

          {/* co už v ten den mám: schůzky z Google kalendáře + úkoly + volno */}
          {previewDay && (
            <div className="rise mb-2 rounded-xl bg-well/60 px-3 py-2.5 text-[13px]">
              <div className="font-medium text-ink first-letter:uppercase">
                {formatDayLabel(previewDay)}
                {' · '}
                {previewEvents.length > 0
                  ? `${previewEvents.length} ${plural(previewEvents.length, 'schůzka', 'schůzky', 'schůzek')}`
                  : beyondCalendarWindow
                    ? 'kalendář dohlédne jen 14 dní'
                    : 'bez schůzek'}
                {' · '}
                {previewTasks.length > 0
                  ? `${previewTasks.length} ${plural(previewTasks.length, 'úkol', 'úkoly', 'úkolů')}`
                  : 'zatím bez úkolů'}
                {previewEvents.length > 0 && ` · volno ~${minutesToLabel(freeMinutes(previewBusy))}`}
              </div>
              {previewEvents.slice(0, 3).map((e) => (
                <div key={e.id} className="mt-1 flex gap-2 text-ink-soft">
                  <span className="w-24 shrink-0 whitespace-nowrap tabular-nums">
                    {e.allDay
                      ? 'celý den'
                      : `${new Date(e.start).getHours()}:${String(new Date(e.start).getMinutes()).padStart(2, '0')}–${new Date(e.end).getHours()}:${String(new Date(e.end).getMinutes()).padStart(2, '0')}`}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                </div>
              ))}
              {previewEvents.length > 3 && (
                <div className="mt-1 text-ink-faint">…a {previewEvents.length - 3} dalších</div>
              )}
              {previewTasks.length > 0 && (
                <div className="mt-1 truncate text-ink-faint">
                  Úkoly: {previewTasks.slice(0, 3).map((t) => t.title).join(' · ')}
                  {previewTasks.length > 3 && ` …+${previewTasks.length - 3}`}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {picker === 'client' && (
        <div className="rise -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" style={{ scrollbarWidth: 'none' }}>
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              onPointerDown={keepFocus}
              onClick={() => setOv({ clientId: c.id, projectId: effProject && effProject.clientId !== c.id ? null : overrides.projectId })}
              className={`${pill} inline-flex items-center gap-1.5 ${effClientId === c.id ? 'bg-ink text-paper' : 'bg-well text-ink'}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
          {effClientId && (
            <button type="button" onPointerDown={keepFocus} onClick={() => setOv({ clientId: null, projectId: null })} className={`${pill} bg-well text-ink-soft`}>
              ✕ Bez klienta
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
              className={`${pill} ${effProjectId === p.id ? 'bg-ink text-paper' : 'bg-well text-ink'}`}
            >
              ▸ {p.name}
            </button>
          ))}
          {effProjectId && (
            <button type="button" onPointerDown={keepFocus} onClick={() => setOv({ projectId: null })} className={`${pill} bg-well text-ink-soft`}>
              ✕ Bez projektu
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
        <div className="rise -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" style={{ scrollbarWidth: 'none' }}>
          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
            <button
              key={p}
              type="button"
              onPointerDown={keepFocus}
              onClick={() => setOv({ priority: p === 'normal' ? null : p })}
              className={`${pill} ${effPriority === p ? 'bg-ink text-paper' : 'bg-well text-ink'}`}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
      )}

      {/* lišta rychlých voleb — vše na jedno ťuknutí, bez znalosti syntaxe */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" style={{ scrollbarWidth: 'none' }}>
        <ToolbarButton
          label="Termín"
          active={picker === 'date' || Boolean(effDueDate)}
          onTap={() => setPicker(picker === 'date' ? null : 'date')}
          icon={<path d="M4.5 6.5h15v13h-15zM4.5 10h15M8.5 4v4M15.5 4v4" />}
        />
        <ToolbarButton
          label="Klient"
          active={picker === 'client' || Boolean(effClientId)}
          onTap={() => setPicker(picker === 'client' ? null : 'client')}
          icon={<><circle cx="12" cy="8.5" r="3.5" /><path d="M5.5 19.5c.8-3.4 3.4-5.25 6.5-5.25s5.7 1.85 6.5 5.25" /></>}
        />
        <ToolbarButton
          label="Projekt"
          active={picker === 'project' || Boolean(effProjectId)}
          onTap={() => setPicker(picker === 'project' ? null : 'project')}
          icon={<path d="M4 7.5a2 2 0 012-2h4l2 2.5h6a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2z" />}
        />
        <ToolbarButton
          label="Priorita"
          active={picker === 'priority' || effPriority !== 'normal'}
          onTap={() => setPicker(picker === 'priority' ? null : 'priority')}
          icon={<path d="M12 5v9M12 17.5v1" />}
        />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Např. „zítra poslat report @klient“"
          enterKeyHint="done"
          className="min-w-0 flex-1 rounded-full border border-transparent bg-well px-4 py-2.5 text-[15px] text-ink outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent/50 focus:bg-card"
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

function ToolbarButton({
  label,
  active,
  onTap,
  icon,
}: {
  label: string
  active: boolean
  onTap: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.preventDefault()}
      onClick={onTap}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition-[background-color,color,transform] duration-150 active:scale-95 ${
        active ? 'bg-accent-wash text-accent-deep' : 'bg-well/70 text-ink-soft'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {icon}
      </svg>
      {label}
    </button>
  )
}
