// Plán = kalendář a agenda vybraného dne.
//
// Dřív: pás čtrnácti dnů s tečkami a pod ním sekce na každý den, na
// kterém něco leželo — až třicet karet pod sebou, „bez termínu" a
// ohlédnutí úplně dole. Prázdný den nešel ani vybrat, natož na něj něco
// naplánovat, a týden ani měsíc nebyly nikde vidět. Teď: (1) hlavička
// se souhrnem týdne; (2) řádka chipů pro to, co není den — bez termínu,
// ohlédnutí, skok na dnešek; (3) kalendář (týden, rozbalitelný na měsíc,
// listuje se šipkami i švihnutím); (4) agenda vybraného dne v jedné
// kartě — schůzky, úkoly, a pod ní tiché pole „nový úkol na ten den"
// a výběr z úkolů bez termínu. Plánuje se tak, jak se plánuje: napřed
// den, pak co na něj. Minulý den ukáže, co se ten den dodělalo.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { CalendarEvent, Task } from '../db/types'
import {
  addTask,
  allClients,
  allProjects,
  calendarEventsBetween,
  completeTask,
  doneOn,
  openTasks,
  reopenTask,
  sortTasks,
} from '../db/repo'
import { plannedMinutes } from '../lib/capacity'
import { addDays, formatEventRange, formatFullDate, fromISODate, mondayOf, toISODate, todayISO } from '../lib/dates'
import { minutesToLabel } from '../lib/freeSlot'
import { plural } from '../lib/labels'
import { parseQuickAdd } from '../lib/quickAdd'
import { ukazToast } from '../lib/toast'
import { TaskRow } from '../components/TaskRow'
import { DlouhySeznam } from '../components/DlouhySeznam'
import { Chip } from '../components/Chip'
import { BezTerminuSheet } from '../components/BezTerminuSheet'
import { PlanKalendar, dnyObdobi, kotvaPro, type PlanRezim } from '../components/PlanKalendar'
import { TextEffect } from '../components/ui/TextEffect'

const effectiveDate = (t: Task): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

const REZIM_KLIC = 'todo.plan.rezim'
const nactiRezim = (): PlanRezim => {
  try {
    return localStorage.getItem(REZIM_KLIC) === 'mesic' ? 'mesic' : 'tyden'
  } catch {
    return 'tyden'
  }
}

export function UpcomingView({
  onOpenTask,
  onOpenReview,
}: {
  onOpenTask: (t: Task) => void
  onOpenReview?: () => void
}) {
  const today = todayISO()
  const [vybrany, setVybrany] = useState(today)
  const [rezim, setRezimStav] = useState<PlanRezim>(nactiRezim)
  const [kotva, setKotva] = useState(() => kotvaPro(today, nactiRezim()))
  const [inbox, setInbox] = useState<null | { cil?: string }>(null)
  const [novy, setNovy] = useState('')

  const setRezim = (r: PlanRezim) => {
    setRezimStav(r)
    setKotva(kotvaPro(vybrany, r))
    try {
      localStorage.setItem(REZIM_KLIC, r)
    } catch {
      /* soukromé okno */
    }
  }
  const vyber = (iso: string) => {
    setVybrany(iso)
    setKotva(kotvaPro(iso, rezim))
  }

  // Než první dotaz doběhne, není to „volný den" — jen se ještě neví.
  const openRaw = useLiveQuery(openTasks, [])
  const open = openRaw ?? []
  const clients = useLiveQuery(allClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []
  const clientMap = new Map(clients.map((c) => [c.id, c]))
  const projectMap = new Map(projects.map((p) => [p.id, p]))

  // Schůzky pro celé zobrazené období i vybraný den (ten může být mimo,
  // když se listuje pryč). Vícedenní událost patří do KAŽDÉHO svého dne.
  const dny = dnyObdobi(kotva, rezim)
  const od = vybrany < dny[0] ? vybrany : dny[0]
  const doo = vybrany > dny[dny.length - 1] ? vybrany : dny[dny.length - 1]
  const events = useLiveQuery(() => calendarEventsBetween(od, doo), [od, doo]) ?? []
  const eventsPerDay = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    if (e.isTodoBlock) continue
    let d = e.startDay < od ? od : e.startDay
    const end = (e.endDay ?? e.startDay) > doo ? doo : (e.endDay ?? e.startDay)
    let guard = 0
    while (d <= end && guard++ < 45) {
      eventsPerDay.set(d, [...(eventsPerDay.get(d) ?? []), e])
      d = toISODate(addDays(fromISODate(d), 1))
    }
  }

  const podleDne = new Map<string, Task[]>()
  for (const t of open) {
    const d = effectiveDate(t)
    if (!d) continue
    podleDne.set(d, [...(podleDne.get(d) ?? []), t])
  }
  const bezTerminu = sortTasks(open.filter((t) => !effectiveDate(t)))

  // Tečky v kalendáři: úkoly + schůzky. Propadlé se počítají na svůj den,
  // ne na dnešek — kalendář je mapa, ne triáž.
  const zatizeni = new Map<string, number>()
  for (const d of dny) {
    const n = (podleDne.get(d)?.length ?? 0) + (eventsPerDay.get(d)?.length ?? 0)
    if (n > 0) zatizeni.set(d, n)
  }

  // Minulý den ukazuje, co se ten den dodělalo — ne co na něm propadlo.
  const minuly = vybrany < today
  const hotoveVDen = useLiveQuery(() => (minuly ? doneOn(vybrany) : Promise.resolve<Task[]>([])), [minuly, vybrany]) ?? []
  const dayTasks = minuly ? hotoveVDen : sortTasks(podleDne.get(vybrany) ?? [])
  const dayEvents = [...(eventsPerDay.get(vybrany) ?? [])].sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start),
  )
  const workMin = minuly ? 0 : plannedMinutes(dayTasks)

  // Souhrn týdne vybraného dne do hlavičky.
  const pondeli = mondayOf(vybrany)
  const tyden = Array.from({ length: 7 }, (_, i) => toISODate(addDays(fromISODate(pondeli), i)))
  const tydenUkoly = tyden.flatMap((d) => podleDne.get(d) ?? [])
  const tydenSchuzky = tyden.reduce((n, d) => n + (eventsPerDay.get(d)?.length ?? 0), 0)
  const tydenMin = plannedMinutes(tydenUkoly)
  const tentoTyden = pondeli === mondayOf(today)
  const souhrn = [
    tentoTyden ? 'tento týden' : `týden od ${fromISODate(pondeli).getDate()}. ${fromISODate(pondeli).getMonth() + 1}.`,
    tydenUkoly.length > 0
      ? `${tydenUkoly.length} ${plural(tydenUkoly.length, 'úkol', 'úkoly', 'úkolů')}`
      : 'bez úkolů',
    tydenMin > 0 ? `~${minutesToLabel(tydenMin)}` : '',
    tydenSchuzky > 0 ? `${tydenSchuzky} ${plural(tydenSchuzky, 'schůzka', 'schůzky', 'schůzek')}` : '',
  ].filter(Boolean)

  // Neděle a pondělí — stejné okno, v jakém chodí nedělní push notifikace.
  const reviewDay = [0, 1].includes(fromISODate(today).getDay())

  const toggle = (t: Task) => {
    void (t.status === 'done' ? reopenTask(t.id) : completeTask(t.id))
  }
  const row = (t: Task) => (
    <TaskRow
      key={t.id}
      task={t}
      client={t.clientId ? clientMap.get(t.clientId) : undefined}
      project={t.projectId ? projectMap.get(t.projectId) : undefined}
      onToggle={toggle}
      onOpen={onOpenTask}
      showDate={false}
    />
  )

  // Nový úkol rovnou na vybraný den — parser dál rozumí klientovi,
  // prioritě i času; den je daný kalendářem.
  const pridej = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseQuickAdd(novy, clients, new Date(), projects)
    if (!parsed.title) return
    const task = await addTask({
      title: parsed.title,
      dueDate: vybrany,
      dueTime: parsed.dueTime,
      priority: parsed.priority,
      clientId: parsed.clientId,
      projectId: parsed.projectId,
      recurrenceRule: parsed.recurrenceRule,
      notes: parsed.notes,
    })
    setNovy('')
    ukazToast(`${nazevDne} — „${task.title}"`)
  }

  const nazevDne = vybrany === today ? 'Dnes' : formatFullDate(fromISODate(vybrany))
  const nadpisDne = [
    nazevDne,
    dayTasks.length > 0
      ? `${dayTasks.length} ${minuly ? plural(dayTasks.length, 'hotový', 'hotové', 'hotových') : plural(dayTasks.length, 'úkol', 'úkoly', 'úkolů')}`
      : '',
    workMin > 0 ? `~${minutesToLabel(workMin)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="space-y-5">
      <header className="rise">
        <TextEffect as="h1" per="char" preset="blur" className="display text-[2.1rem] font-semibold leading-tight">Plán</TextEffect>
        <p className="text-sm text-ink-soft first-letter:uppercase">{souhrn.join(' · ')}</p>
      </header>

      {/* Co není den: úkoly bez termínu, ohlédnutí, návrat na dnešek. */}
      {(bezTerminu.length > 0 || (onOpenReview && reviewDay) || vybrany !== today) && (
        <div className="rise -mx-4 flex gap-2 overflow-x-auto px-4 py-1" style={{ scrollbarWidth: 'none' }}>
          {vybrany !== today && (
            <Chip tone="accent" onClick={() => vyber(today)}>
              Dnes
            </Chip>
          )}
          {bezTerminu.length > 0 && (
            <Chip onClick={() => setInbox({})}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20M4 13.5V18a1 1 0 001 1h14a1 1 0 001-1v-4.5M4 13.5L6.5 6h11l2.5 7.5" />
              </svg>
              Bez termínu · {bezTerminu.length}
            </Chip>
          )}
          {onOpenReview && reviewDay && (
            <Chip onClick={onOpenReview}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5V13M10 19.5V8M16 19.5v-9M20.5 19.5H3.5" />
              </svg>
              Týdenní ohlédnutí
            </Chip>
          )}
        </div>
      )}

      <div className="rise" style={{ '--stagger': 1 } as React.CSSProperties}>
        <PlanKalendar
          kotva={kotva}
          rezim={rezim}
          vybrany={vybrany}
          zatizeni={zatizeni}
          onVyber={setVybrany}
          onKotva={setKotva}
          onRezim={setRezim}
        />
      </div>

      <section className="rise" style={{ '--stagger': 2 } as React.CSSProperties}>
        <h2 className="section-label mb-2 first-letter:uppercase">{nadpisDne}</h2>
        <div className="overflow-hidden rounded-2xl bg-card shadow-card">
          {dayEvents.length > 0 && (
            <ul className={`divide-y divide-line bg-well/30 ${dayTasks.length > 0 ? 'border-b border-line' : ''}`}>
              {dayEvents.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-24 shrink-0 text-[13px] tabular-nums text-ink-soft">{formatEventRange(e)}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{e.title}</span>
                </li>
              ))}
            </ul>
          )}
          {dayTasks.length > 0 && (
            <DlouhySeznam polozky={dayTasks} radek={row} davka={12} className="divide-y divide-line" />
          )}
          {openRaw !== undefined && dayTasks.length === 0 && dayEvents.length === 0 && (
            <p className="px-4 py-5 text-sm text-ink-faint">
              {minuly ? 'Ten den se nic nedodělalo.' : 'Volný den. Napiš, co na něj patří.'}
            </p>
          )}
        </div>

        {!minuly && (
          <div className="mt-3 space-y-2">
            {/* Tiché pole jako v detailu klienta: plusko se vynoří až s textem. */}
            <form onSubmit={pridej} className="relative">
              <input
                value={novy}
                onChange={(e) => setNovy(e.target.value)}
                aria-label="Nový úkol na vybraný den"
                placeholder={`Nový úkol na ${vybrany === today ? 'dnešek' : formatFullDate(fromISODate(vybrany))}…`}
                enterKeyHint="done"
                className="w-full appearance-none rounded-full border border-transparent bg-card py-2.5 pl-4 pr-12 text-[16px] text-ink shadow-card outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent/50 focus-visible:outline-none"
              />
              <button
                type="submit"
                aria-label="Přidat úkol"
                disabled={!novy.trim()}
                className={`absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-card transition-[opacity,transform] duration-200 active:scale-90 ${
                  novy.trim() ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </form>
            {bezTerminu.length > 0 && (
              <button
                type="button"
                onClick={() => setInbox({ cil: vybrany })}
                className="px-1 py-1 text-[13px] font-medium text-accent-deep"
              >
                + Vybrat z úkolů bez termínu · {bezTerminu.length}
              </button>
            )}
          </div>
        )}
      </section>

      {inbox && (
        <BezTerminuSheet
          ukoly={bezTerminu}
          clients={clientMap}
          cilovyDen={inbox.cil}
          onOpenTask={onOpenTask}
          onClose={() => setInbox(null)}
        />
      )}
    </div>
  )
}
