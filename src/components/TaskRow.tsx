import { useRef, useState } from 'react'
import type { Client, Priority, Project, Task } from '../db/types'
import { updateTask } from '../db/repo'
import { deleteBlockForTask } from '../sync/calendar'
import { addDays, formatDayLabel, fromISODate, toISODate, todayISO } from '../lib/dates'

// Priorita jako barevná pilulka — čitelnější než prostý text.
const PRIO_BADGE: Partial<Record<Priority, { label: string; cls: string }>> = {
  critical: {
    label: 'kritická',
    cls: 'rounded-full bg-danger-wash px-2 py-px text-[11px] font-semibold text-danger',
  },
  high: {
    label: 'vysoká',
    cls: 'rounded-full bg-note px-2 py-px text-[11px] font-medium text-note-ink',
  },
  low: { label: 'nízká', cls: 'rounded-full bg-well px-2 py-px text-[11px] text-ink-faint' },
}

// Prodleva mezi ťuknutím a skutečným dokončením (jako iOS Připomínky):
// fajfka se nakreslí a titulek škrtne hned, řádek odpluje až potom —
// druhé ťuknutí v mezičase dokončení vrátí.
const COMPLETE_DELAY_MS = 600

// Swipe gesta (jako iOS Mail): doprava = hotovo, doleva = odhalit
// akce Zítra/Jindy; dlouhé přetažení doleva rovnou odloží na zítřek.
const SWIPE_COMMIT = 64 // doprava: odsud se počítá dokončení
const SWIPE_OPEN = 148 // šířka odhalených akcí (2 × 74px)
const SWIPE_FULL = 176 // doleva: odsud plné přetažení = rovnou Zítra
// za hranicí klade posun odpor (rubber band)
const rubber = (v: number, limit: number) =>
  Math.abs(v) <= limit ? v : Math.sign(v) * (limit + (Math.abs(v) - limit) * 0.4)

// Řádek seskupeného seznamu ve stylu iOS — oddělovače řeší rodičovský
// <ul> přes divide-y, zaoblení a pozadí drží kontejner skupiny.
export function TaskRow({
  task,
  client,
  project,
  onToggle,
  onOpen,
  showDate = true,
  showPin = true,
}: {
  task: Task
  client?: Client
  project?: Project
  onToggle: (task: Task) => void
  onOpen: (task: Task) => void
  showDate?: boolean
  showPin?: boolean
}) {
  const done = task.status === 'done'
  const [pendingDone, setPendingDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Vizuálně hotovo hned po ťuknutí; zápis do DB až po prodlevě.
  const visualDone = done || pendingDone

  const handleToggle = () => {
    if (done) {
      onToggle(task) // vrácení mezi nehotové — bez prodlevy
      return
    }
    if (pendingDone) {
      clearTimeout(timer.current) // rozmyšleno — dokončení se ruší
      setPendingDone(false)
      return
    }
    setPendingDone(true)
    timer.current = setTimeout(() => onToggle(task), COMPLETE_DELAY_MS)
  }

  // Odklad na zítřek — stejná logika jako Uzávěrka dne: posouvá se to
  // pole, které úkol na den váže; blok v kalendáři „Todo" se uvolní.
  const postponeTomorrow = () => {
    const tomorrow = toISODate(addDays(fromISODate(todayISO()), 1))
    if (task.calendarEventId) void deleteBlockForTask(task)
    void updateTask(task.id, {
      ...(task.scheduledFor ? { scheduledFor: tomorrow } : { dueDate: tomorrow }),
      ...(task.status === 'inbox' ? { status: 'active' as const } : {}),
    })
  }

  // --- swipe stav ---
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; base: number; raw: number; active: boolean } | null>(
    null,
  )
  const wasDrag = useRef(false)
  const open = dx !== 0 && !dragging

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, base: dx, raw: dx, active: false }
    wasDrag.current = false
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const ddx = e.clientX - d.x
    const ddy = e.clientY - d.y
    if (!d.active) {
      // rozhodnout záměr: vodorovný tah přebíráme, svislý necháme scrollu
      if (Math.abs(ddx) < 8 || Math.abs(ddx) < Math.abs(ddy) * 1.2) return
      d.active = true
      wasDrag.current = true
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    let raw = d.base + ddx
    if (done) raw = Math.max(0, raw) // hotové úkoly nemají co odkládat
    d.raw = raw
    setDx(raw > 0 ? rubber(raw, 88) : Math.max(rubber(raw, SWIPE_OPEN + 40), -SWIPE_FULL - 72))
  }

  const settle = () => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (!d) return
    // prosté ťuknutí neřešíme tady — zavření odhalených akcí dělá
    // onClickCapture, který běží až po pointerup a viděl by už zavřeno
    if (!d.active) return
    // první opravdové gesto → nápovědný tip na Dnes už není potřeba
    localStorage.setItem('todo.gestureTipSeen', '1')
    if (d.raw > SWIPE_COMMIT) {
      handleToggle()
      setDx(0)
    } else if (d.raw < -SWIPE_FULL && !done) {
      postponeTomorrow() // plné přetažení — rovnou zítra
      setDx(0)
    } else if (d.raw < -SWIPE_COMMIT * 0.9 && !done) {
      setDx(-SWIPE_OPEN) // zaparkovat na odhalených akcích
    } else {
      setDx(0)
    }
  }

  // po tahu spolknout klik; ťuknutí při odhalených akcích jen zavře
  const onClickCapture = (e: React.MouseEvent) => {
    if (wasDrag.current) {
      wasDrag.current = false
      e.preventDefault()
      e.stopPropagation()
    } else if (open) {
      e.preventDefault()
      e.stopPropagation()
      setDx(0)
    }
  }

  // Prošlé je i dnešní datum s deadlinem, který už minul (do 14:00 v 15:10).
  const nowHM = new Date().toTimeString().slice(0, 5)
  const overdue =
    !visualDone &&
    !!task.dueDate &&
    (task.dueDate < todayISO() ||
      (task.dueDate === todayISO() && !!task.dueTime && task.dueTime <= nowHM))
  const prio = PRIO_BADGE[task.priority]
  const subs = task.subtasks ?? []
  const subsDone = subs.filter((s) => s.done).length
  const fullPull = dragging && dx < -SWIPE_FULL // Zítra expanduje přes celou šířku

  return (
    <li className="rise relative overflow-hidden bg-card" style={{ touchAction: 'pan-y' }}>
      {/* podklad swipe doprava — fajfka roste s jistotou gesta */}
      {dx > 0 && (
        <div className="absolute inset-0 flex items-center bg-moss px-5 text-card">
          <svg
            viewBox="0 0 20 20"
            className="h-5 w-5 transition-transform duration-150"
            style={{ transform: dx > SWIPE_COMMIT ? 'scale(1.15)' : 'scale(0.85)' }}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4.5 10.5l3.8 3.8 7.2-8.6" />
          </svg>
        </div>
      )}
      {/* akce swipe doleva — Zítra u kraje, plné přetažení ji roztáhne */}
      {dx < 0 && (
        <div
          className="absolute inset-y-0 right-0 flex justify-end bg-accent"
          style={{ width: Math.max(SWIPE_OPEN, -dx) }}
        >
          <button
            type="button"
            onClick={() => {
              setDx(0)
              onOpen(task)
            }}
            className="flex items-center justify-center overflow-hidden bg-well text-[13px] font-medium text-ink transition-[width] duration-200"
            style={{ width: fullPull ? 0 : 74 }}
          >
            Jindy
          </button>
          <button
            type="button"
            onClick={() => {
              setDx(0)
              postponeTomorrow()
            }}
            className="flex flex-1 items-center justify-center text-[13px] font-semibold text-card"
          >
            Zítra
          </button>
        </div>
      )}

      <div
        className="press-row relative flex items-start gap-3 bg-card px-4 py-3 hover:bg-well/40 active:bg-well/60"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 0.35s var(--ease-spring)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={settle}
        onPointerCancel={settle}
        onClickCapture={onClickCapture}
      >
        <button
          aria-label={visualDone ? 'Vrátit mezi nehotové' : 'Označit jako hotové'}
          onClick={handleToggle}
          className="-m-2 shrink-0 p-2 transition-transform duration-150 active:scale-90"
        >
          <span
            className={`relative flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-200 ${
              visualDone
                ? 'check-drawn pop border-accent bg-accent text-card'
                : 'border-ink-faint text-transparent'
            }`}
          >
            {/* záblesk prstence při dokončení (nový element na každé odškrtnutí) */}
            {visualDone && <span key="burst" className="ring-burst" />}
            <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <path className="check-path" d="M4.5 10.5l3.8 3.8 7.2-8.6" />
            </svg>
          </span>
        </button>

        <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(task)}>
          <div
            className={`title-strike text-[16px] leading-snug ${
              visualDone ? 'is-done text-ink-faint' : 'text-ink'
            }`}
          >
            {/* špendlík „Top 3 dne" — jen mimo sekci Na čem záleží,
                tam by se opakoval u každého řádku */}
            {task.pinnedFor === todayISO() && !visualDone && showPin && (
              <svg viewBox="0 0 24 24" className="mr-1 inline-block h-3.5 w-3.5 -translate-y-px text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3.5h6l-.8 5.2 3.3 3.1H6.5l3.3-3.1z" />
                <path d="M12 11.8V20.5" />
              </svg>
            )}
            {task.title}
          </div>
          {(client || project || (showDate && task.dueDate) || task.dueTime || subs.length > 0 || prio || task.recurrenceRule || task.sourceTemplateItemId) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
              {client && (
                <span className="inline-flex items-center gap-1.5 text-ink-soft">
                  <span className="h-2 w-2 rounded-full" style={{ background: client.color }} />
                  {client.name}
                </span>
              )}
              {project && <span className="text-ink-faint">{project.name}</span>}
              {showDate && task.dueDate && !visualDone && (
                <span className={overdue ? 'font-medium text-danger' : 'text-ink-soft'}>
                  {formatDayLabel(task.dueDate)}
                  {task.dueTime ? ` do ${task.dueTime}` : ''}
                </span>
              )}
              {/* na Dnes (datum se neukazuje) stojí čas deadlineu samostatně */}
              {!(showDate && task.dueDate) && task.dueTime && !visualDone && (
                <span className={overdue ? 'font-medium text-danger' : 'text-ink-soft'}>
                  do {task.dueTime}
                </span>
              )}
              {/* progres checklistu — zelený, jakmile je celý hotový */}
              {subs.length > 0 && !visualDone && (
                <span
                  className={`inline-flex items-center gap-1 ${subsDone === subs.length ? 'text-moss' : 'text-ink-soft'}`}
                  title="Podúkoly"
                >
                  {/* jednoduchá fajfka v rámečku — víc čar je v 13 px kaše */}
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="4" />
                    <path d="M8.5 12.3l2.5 2.5 4.5-5.2" />
                  </svg>
                  {subsDone}/{subs.length}
                </span>
              )}
              {(task.recurrenceRule || task.sourceTemplateItemId) && (
                <span className="text-ink-faint" title="Opakuje se">
                  ↻
                </span>
              )}
              {prio && <span className={prio.cls}>{prio.label}</span>}
            </div>
          )}
        </button>
      </div>
    </li>
  )
}
