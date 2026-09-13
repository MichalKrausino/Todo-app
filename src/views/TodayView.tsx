import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Client, Task } from '../db/types'
import {
  allClients,
  allProjects,
  calendarEventsOn,
  completeTask,
  doneOn,
  getDayPlan,
  openTasks,
  reopenTask,
  sortTasks,
} from '../db/repo'
import { isOverloaded, plannedMinutes } from '../lib/capacity'
import { formatFullDate, todayISO } from '../lib/dates'
import { WORK_END, WORK_START, freeGaps, freeMinutes, minutesToLabel, type BusyInterval } from '../lib/freeSlot'
import { computeSignals } from '../lib/signals'
import { plural } from '../lib/labels'
import { Chip } from '../components/Chip'
import { HelpSheet } from '../components/HelpSheet'
import { ShutdownSheet } from '../components/ShutdownSheet'
import { TriageSheet } from '../components/TriageSheet'
import { NavrhSheet, type Odpocivajici } from '../components/NavrhSheet'
import { useNavrhPamet } from '../lib/navrhPamet'
import { KalendarSheet, minutesOfDay, untilLabel } from '../components/KalendarSheet'
import { SignalySheet, signalRadky } from '../components/SignalySheet'
import { TaskRow } from '../components/TaskRow'
import { useRozbaleno } from '../components/SbalenaSekce'
import { TextEffect } from '../components/ui/TextEffect'
import { AnimatedNumber } from '../components/ui/AnimatedNumber'
import { AnimatedBackground } from '../components/ui/AnimatedBackground'
import { BlurText } from '../components/ui/BlurText'
import { BorderBeam } from '../components/ui/BorderBeam'
import { DisclosureContent } from '../components/ui/Disclosure'
import { Ripple } from '../components/ui/Ripple'
import confetti from 'canvas-confetti'

// Obrazovka Dnes je jedna odpověď na „co teď?": nahoře hlavička, pod ní
// JEDNA řádka kontextu (nejbližší schůzka, ranní návrh, uzávěrka, signály,
// inbox — každé je chip, každé se otevře v panelu) a pod tím JEDEN seznam
// úkolů v jedné kartě: připnuté, propadlé, dnešní; hotové sbalené na
// konci. Dřív tu stálo až jedenáct bloků pod sebou a každý s vlastním
// nadpisem — obrazovka odpovídala jedenáctkrát a pokaždé jinak.

// Nejbližší relevantní den úkolu — dřívější z „naplánováno“ a „termín“.
const effectiveDate = (t: Task): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

// Kaskáda nástupu sekcí (proměnnou čte animace .rise v index.css).
const stagger = (i: number) => ({ '--stagger': i }) as React.CSSProperties

// Příklady do prázdného stavu — každý ukazuje jinou schopnost parseru.
const EXAMPLES = ['zítra poslat report', 'v pátek fakturace !!', 'zavolat Pepovi do 14:00']

// Kratší okno než půl hodiny nemá cenu nabízet jako volný slot.
const MIN_GAP_MIN = 30
// Kolik řádků seznamu se vykreslí napoprvé a po kolika se dobírá.
const DAVKA = 30
// obvod kroužku postupu (r = 7,5 ve viewBoxu 20)
const RING = 2 * Math.PI * 7.5

// Řazení seznamu: podle naléhavosti (připnuté, propadlé, dnešní), nebo
// seskupené po klientech — jeden klient v kuse, míň přepínání kontextu.
type Razeni = 'priorita' | 'klient'
const RAZENI_KLIC = 'todo.dnes.razeni'

interface Polozka {
  task: Task
  showDate: boolean
}

// Kontextový chip: jedna řádka nad seznamem, každý chip otevře panel.
export function TodayView({
  onOpenTask,
  onOpenClient,
  onOpenInbox,
}: {
  onOpenTask: (t: Task) => void
  onOpenClient: (id: string) => void
  onOpenInbox: () => void
}) {
  const today = todayISO()
  const [navrhOpen, setNavrhOpen] = useState(false)
  const [kalendarOpen, setKalendarOpen] = useState(false)
  const [signalyOpen, setSignalyOpen] = useState(false)
  const [shutdownOpen, setShutdownOpen] = useState(false)
  const [triageOpen, setTriageOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // Jednorázový tip na swipe gesta — jinak je nikdo neobjeví. Zmizí
  // navždy po zavření nebo po prvním použití gesta.
  const [gestureTip, setGestureTip] = useState(() => localStorage.getItem('todo.gestureTipSeen') !== '1')
  const dismissTip = () => {
    localStorage.setItem('todo.gestureTipSeen', '1')
    setGestureTip(false)
  }
  const [dayClosed, setDayClosed] = useState(() => localStorage.getItem('todo.dayClosed') === todayISO())
  const [razeni, setRazeni] = useState<Razeni>(() =>
    localStorage.getItem(RAZENI_KLIC) === 'klient' ? 'klient' : 'priorita',
  )
  const zmenRazeni = (r: Razeni) => {
    localStorage.setItem(RAZENI_KLIC, r)
    setRazeni(r)
  }
  const [hotovoOpen, prepniHotovo] = useRozbaleno('hotovo')
  const [limit, setLimit] = useState(DAVKA)
  // Živý čas — nejbližší schůzka a volno musí stárnout samy od sebe.
  // Minutová kadence stačí; při návratu do popředí se dorovná okamžitě.
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  })
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setNowMin(d.getHours() * 60 + d.getMinutes())
    }
    const id = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  // Deep-link #shutdown z podvečerní notifikace otevře uzávěrku dne.
  // (#review řeší App — týdenní ohlédnutí bydlí v Plánu.)
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== '#shutdown') return
      setShutdownOpen(true)
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])

  // `useLiveQuery` vrací `undefined`, dokud první dotaz nedoběhne — a to
  // není totéž co „nic tu není". Když se rozdíl setře na `?? []`, appka po
  // startu na chvíli tvrdí „Čistý stůl", i když je den plný; změřeno,
  // úkoly naskočily až o 30 ms později (na telefonu se studenou databází
  // násobně víc). První, co člověk po otevření vidí, nemá být nepravda.
  const openRaw = useLiveQuery(openTasks, [])
  const doneRaw = useLiveQuery(() => doneOn(today), [today])
  const nacteno = openRaw !== undefined && doneRaw !== undefined
  const open = openRaw ?? []
  const done = doneRaw ?? []
  const clients = useLiveQuery(allClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []
  const dayPlan = useLiveQuery(() => getDayPlan(today), [today])
  const pamet = useNavrhPamet()
  const events = useLiveQuery(() => calendarEventsOn(today), [today]) ?? []

  // Odvozená data se počítají ze VSTUPŮ, ne při každém překreslení.
  // Obrazovka se překresluje i když se jen otevře panel nebo tikne minuta —
  // a bez `useMemo` se při každém takovém překreslení znovu procházelo
  // a třídilo všech 400 úkolů. `useLiveQuery` vrací tutéž referenci,
  // dokud se dotaz znovu nespustí, takže závislosti drží.
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const { overdue, todays, inbox } = useMemo(
    () => ({
      overdue: sortTasks(
        open.filter((t) => {
          const d = effectiveDate(t)
          return d !== undefined && d < today
        }),
      ),
      todays: sortTasks(open.filter((t) => effectiveDate(t) === today)),
      inbox: sortTasks(open.filter((t) => !effectiveDate(t))),
    }),
    [open, today],
  )

  const planned = todays.length + done.length
  const progress = planned > 0 ? done.length / planned : 0
  const allDone = planned > 0 && done.length === planned && overdue.length === 0

  // Kapacita dne: tichý součet odhadů vs. volno v kalendáři (když je).
  const unfinished = useMemo(() => [...overdue, ...todays], [overdue, todays])
  const busy: BusyInterval[] = useMemo(
    () =>
      events
        .filter((e) => !e.allDay)
        .map((e) => {
          const s = new Date(e.start)
          const en = new Date(e.end)
          return { startMin: s.getHours() * 60 + s.getMinutes(), endMin: en.getHours() * 60 + en.getMinutes() }
        }),
    [events],
  )
  // Volno se počítá od TEĎ do konce pracovní doby — ve dvě odpoledne
  // nemá smysl hlásit celodenních osm hodin. Po pracovní době je nula.
  const restStart = Math.min(Math.max(nowMin, WORK_START), WORK_END)
  const freeMin = events.length > 0 ? freeMinutes(busy, restStart) : null
  const workMin = useMemo(() => plannedMinutes(unfinished), [unfinished])
  const overloaded = isOverloaded(workMin, freeMin)
  // Volná okna zbývající do konce pracovní doby (pro panel kalendáře).
  const gaps = freeGaps(busy, restStart).filter((g) => g.endMin - g.startMin >= MIN_GAP_MIN && g.endMin > nowMin)

  // Splněný den slaví konfety přes celou obrazovku (canvas-confetti, jak
  // ho zapojuje magicui) — jednou za den, ne při každém překreslení, a v
  // klidovém režimu vůbec (disableForReducedMotion).
  useEffect(() => {
    if (!allDone) return
    if (localStorage.getItem('todo.konfety') === today) return
    localStorage.setItem('todo.konfety', today)
    const css = getComputedStyle(document.documentElement)
    const barvy = ['--color-accent', '--color-moss', '--color-amber', '--color-accent-deep'].map((t) => css.getPropertyValue(t).trim())
    void confetti({
      particleCount: 90,
      spread: 70,
      startVelocity: 32,
      gravity: 0.9,
      ticks: 180,
      origin: { x: 0.5, y: 0.35 },
      colors: barvy,
      disableForReducedMotion: true,
      zIndex: 60,
    })
  }, [allDone, today])

  const isEvening = new Date().getHours() >= 16
  const closeDay = () => {
    localStorage.setItem('todo.dayClosed', today)
    setDayClosed(true)
  }

  // Stabilní obsluha: `TaskRow` je přes `memo`, takže nová funkce při
  // každém překreslení by mu memoizaci zrušila a překreslilo by se všech
  // třicet řádků kvůli otevření panelu.
  const toggle = useCallback((t: Task) => {
    void (t.status === 'done' ? reopenTask(t.id) : completeTask(t.id))
  }, [])

  const row = (t: Task, showDate = true) => (
    <TaskRow
      key={t.id}
      task={t}
      client={t.clientId ? clientMap.get(t.clientId) : undefined}
      project={t.projectId ? projectMap.get(t.projectId) : undefined}
      onToggle={toggle}
      onOpen={onOpenTask}
      showDate={showDate}
    />
  )

  // Pořadí v seznamu: připnuté (Top 3 dne), propadlé, dnešní. Připnuté
  // nese špendlík na řádku, propadlé červené datum — vlastní sekce
  // s nadpisem k tomu nepotřebují.
  const { visOverdue, poradi } = useMemo(() => {
    const isPinned = (t: Task) => t.pinnedFor === today
    const pinned = sortTasks(unfinished.filter(isPinned))
    const vo = overdue.filter((t) => !isPinned(t))
    const vt = todays.filter((t) => !isPinned(t))
    return {
      visOverdue: vo,
      poradi: [
        ...pinned.map((t) => ({ task: t, showDate: effectiveDate(t) !== today })),
        ...vo.map((t) => ({ task: t, showDate: true })),
        ...vt.map((t) => ({ task: t, showDate: false })),
      ] as Polozka[],
    }
  }, [unfinished, overdue, todays, today])
  const otevrene = poradi.length
  const viditelne = useMemo(() => poradi.slice(0, limit), [poradi, limit])
  const zbyva = otevrene - viditelne.length

  // Seskupení po klientech (jen když jich dnes je víc než jeden).
  const klientiDnes = useMemo(
    () => [...new Set(poradi.map((p) => p.task.clientId).filter((id): id is string => !!id && clientMap.has(id)))],
    [poradi, clientMap],
  )
  const skupiny: Array<{ client?: Client; polozky: Polozka[] }> = useMemo(() => {
    if (razeni !== 'klient' || klientiDnes.length < 2) return [{ polozky: viditelne }]
    const map = new Map<string, Polozka[]>()
    for (const p of viditelne) {
      const k = p.task.clientId && clientMap.has(p.task.clientId) ? p.task.clientId : ''
      // `push`, ne kopie celého pole při každé položce — to je kvadratické.
      const uz = map.get(k)
      if (uz) uz.push(p)
      else map.set(k, [p])
    }
    return [...map.entries()]
      .sort((a, b) => {
        if (!a[0]) return 1
        if (!b[0]) return -1
        return clientMap.get(a[0])!.name.localeCompare(clientMap.get(b[0])!.name, 'cs')
      })
      .map(([id, polozky]) => ({ client: id ? clientMap.get(id) : undefined, polozky }))
  }, [razeni, klientiDnes, viditelne, clientMap])

  // Kontext: ranní návrh, nejbližší schůzka, uzávěrka, signály, inbox.
  const taskById = useMemo(() => new Map(open.map((t) => [t.id, t])), [open])
  const navrhy = (dayPlan?.suggestions ?? [])
    .filter((s) => s.decision === 'ignored' && taskById.has(s.taskId))
    .map((s) => ({ task: taskById.get(s.taskId)!, reason: s.reason }))
  // Paměť návrhu: co se vrací z odložení a co zrovna odpočívá (s dnem návratu).
  const odpocivajici: Odpocivajici[] = [...pamet.odpociva]
    .filter(([id]) => taskById.has(id))
    .map(([id, doKdy]) => ({ task: taskById.get(id)!, do: doKdy }))
    .sort((a, b) => a.do.localeCompare(b.do))
  const bezici = events.find((e) => !e.allDay && minutesOfDay(e.start) <= nowMin && nowMin < minutesOfDay(e.end))
  const dalsi = events
    .filter((e) => !e.allDay && minutesOfDay(e.start) > nowMin)
    .sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start))[0]
  // `computeSignals` projde několikrát všechny úkoly i klienty — nejdražší
  // výpočet obrazovky. Na otevřeném panelu ani na tiknutí minuty nezávisí,
  // takže se drží stranou od překreslení.
  const signalyData = useMemo(
    () => computeSignals(clients, projects, [...open, ...done], today),
    [clients, projects, open, done, today],
  )
  const signaly = signalRadky(signalyData, { onOpenClient, onOpenTask, onOpenInbox })
  const timeFmt = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-5">
      <header className="rise">
        <TextEffect as="h1" per="char" preset="blur" className="display text-[2.1rem] font-semibold leading-tight">Dnes</TextEffect>
        {/* Jedna tichá řádka pod titulkem: kroužek postupu, datum a počet;
            odhad práce má vlastní řádku — jediné, co tu smí mít barvu, je
            přetížení dne. */}
        <div className="relative mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-ink-soft">
          {planned > 0 && (
            <svg key={done.length} viewBox="0 0 20 20" className="pop-soft h-[18px] w-[18px] shrink-0 -rotate-90" aria-hidden="true">
              <circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--color-line)" strokeWidth="3" />
              <circle
                cx="10"
                cy="10"
                r="7.5"
                fill="none"
                stroke={allDone ? 'var(--color-moss)' : 'var(--color-accent)'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={RING}
                strokeDashoffset={RING * (1 - progress)}
                style={{ transition: 'stroke-dashoffset 0.7s var(--ease-glide), stroke 0.4s' }}
              />
            </svg>
          )}
          <span className="inline-block first-letter:uppercase">{formatFullDate(new Date())}</span>
          {planned > 0 && (
            <span className="font-medium">
              · <AnimatedNumber value={done.length} /> z {planned}
            </span>
          )}
        </div>
        {unfinished.length > 0 && (
          <p className={`mt-1 flex items-start gap-1.5 text-[13px] leading-snug ${overloaded ? 'font-medium text-note-ink' : 'text-ink-soft'}`}>
            {/* tečka drží u první řádky i při zalomení na úzkém displeji */}
            <span className={`mt-[6px] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${overloaded ? 'bg-note-ink' : 'bg-moss'}`} />
            <span>
            {overloaded && <>na den je toho moc · </>}
            práce ~{minutesToLabel(workMin)}
            {freeMin !== null && <> · zbývá ~{minutesToLabel(freeMin)}</>}
            </span>
          </p>
        )}
      </header>

      {/* Kontext: jedna vodorovná řádka chipů. Nic z toho není dnešní
          práce, každé je na jedno ťuknutí v panelu. Pořadí podle toho, co
          se dnes mění: návrh (ráno), schůzka (během dne), uzávěrka
          (večer), signály a inbox (kdykoli). */}
      {(navrhy.length > 0 || events.length > 0 || (isEvening && unfinished.length > 0) || signaly.length > 0 || inbox.length > 0) && (
        <div className="rise -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none', ...stagger(1) }}>
          {navrhy.length > 0 && (
            <Chip tone="accent" className="relative overflow-hidden" onClick={() => setNavrhOpen(true)}>
              {/* BorderBeam (magicui): světlo obíhá jediný chip, který napsal server */}
              <BorderBeam size={48} duration={5} />
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z" />
              </svg>
              Návrh · {navrhy.length}
            </Chip>
          )}
          {events.length > 0 && (
            <Chip onClick={() => setKalendarOpen(true)}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <rect x="4" y="5.5" width="16" height="15" rx="3" />
                <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
              </svg>
              {bezici ? (
                <>
                  <span className="text-accent-deep">Teď</span>
                  <span className="max-w-[9rem] truncate">{bezici.title}</span>
                </>
              ) : dalsi ? (
                <>
                  <span className="tabular-nums text-ink-soft">{timeFmt.format(new Date(dalsi.start))}</span>
                  <span className="max-w-[9rem] truncate">{dalsi.title}</span>
                  <span className="text-accent-deep">{untilLabel(minutesOfDay(dalsi.start) - nowMin)}</span>
                </>
              ) : (
                <span className="text-ink-soft">
                  {events.length} {plural(events.length, 'schůzka', 'schůzky', 'schůzek')} · po všech
                </span>
              )}
            </Chip>
          )}
          {isEvening && unfinished.length > 0 && !dayClosed && (
            <Chip onClick={() => setShutdownOpen(true)}>
              <svg viewBox="0 0 24 24" className="breathe h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
              </svg>
              Uzávěrka dne
            </Chip>
          )}
          {isEvening && unfinished.length > 0 && dayClosed && (
            <Chip tone="moss" disabled className="opacity-100">
              ✓ Den uzavřen
            </Chip>
          )}
          {signaly.length > 0 && (
            <Chip tone="note" onClick={() => setSignalyOpen(true)}>
              <span className="inline-block h-2 w-2 rounded-full bg-amber" />
              Signály · {signaly.length}
            </Chip>
          )}
          {inbox.length > 0 && (
            <Chip onClick={onOpenInbox} className="text-ink-soft">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 13l2.5-7h11L20 13v6H4z" />
                <path d="M4 13h5l1.5 2h3L15 13h5" />
              </svg>
              Bez termínu · {inbox.length}
            </Chip>
          )}
        </div>
      )}

      {/* JEDEN seznam v JEDNÉ kartě. Uvnitř: řádka triáže, když něco
          propadlo; řádky úkolů (připnuté → propadlé → dnešní, nebo po
          klientech); hotové sbalené na konci. */}
      <section className="rise" style={stagger(2)}>
        {otevrene > 0 ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="section-label">dnes · {otevrene}</h2>
              {klientiDnes.length >= 2 && (
                <div className="flex gap-0.5 rounded-full bg-well p-0.5">
                  {/* AnimatedBackground (motion-primitives): pilulka mezi volbami plyne */}
                  <AnimatedBackground value={razeni} onValueChange={(id) => zmenRazeni(id as Razeni)} className="rounded-full bg-card shadow-card">
                    <button data-id="priorita" className="h-8 rounded-full px-2.5 text-[12px] font-medium text-ink-soft data-[checked=true]:text-ink">
                      Priorita
                    </button>
                    <button data-id="klient" className="h-8 rounded-full px-2.5 text-[12px] font-medium text-ink-soft data-[checked=true]:text-ink">
                      Klient
                    </button>
                  </AnimatedBackground>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl bg-card shadow-card">
              {visOverdue.length > 0 && (
                // Řádka triáže: u stovky propadlých je seznam slepá ulička —
                // průchod po jednom je jediná cesta ven.
                <button
                  onClick={() => setTriageOpen(true)}
                  className="flex w-full items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-left transition-colors duration-150 active:bg-well/60"
                >
                  <span className="text-[13px] font-medium text-danger first-letter:uppercase">
                    po termínu · {visOverdue.length}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-accent-deep">
                    Projít
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </span>
                </button>
              )}

              <ul className="divide-y divide-line">
                {skupiny.map((sk, i) => (
                  <Fragment key={sk.client?.id ?? `bez-${i}`}>
                    {skupiny.length > 1 && (
                      <li className="flex items-center gap-1.5 bg-well/40 px-4 py-1.5 text-[12px] font-medium text-ink-soft">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sk.client?.color ?? 'var(--color-edge)' }} />
                        {sk.client?.name ?? 'bez klienta'}
                      </li>
                    )}
                    {sk.polozky.map((p) => row(p.task, p.showDate))}
                  </Fragment>
                ))}
              </ul>

              {zbyva > 0 && (
                <button
                  onClick={() => setLimit((l) => l + DAVKA)}
                  className="w-full border-t border-line py-2.5 text-center text-sm font-medium text-accent-deep transition-colors duration-150 active:bg-well/60"
                >
                  {`Zobrazit ${Math.min(zbyva, DAVKA)} ${plural(Math.min(zbyva, DAVKA), 'další', 'další', 'dalších')}`}
                  {zbyva > DAVKA && ` (zbývá ${zbyva})`}
                </button>
              )}

              {done.length > 0 && (
                <>
                  <button
                    onClick={prepniHotovo}
                    aria-expanded={hotovoOpen}
                    className="flex w-full items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-left transition-colors duration-150 active:bg-well/60"
                  >
                    <span className="text-[13px] font-medium text-ink-soft first-letter:uppercase">hotovo · {done.length}</span>
                    <svg
                      viewBox="0 0 24 24"
                      className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${hotovoOpen ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                  <DisclosureContent open={hotovoOpen}>
                    <ul className="divide-y divide-line border-t border-line">{done.map((t) => row(t))}</ul>
                  </DisclosureContent>
                </>
              )}
            </div>

            {gestureTip && (
              <p className="mt-2 flex items-start gap-2 px-1 text-[12px] text-ink-faint">
                <span className="min-w-0 flex-1">
                  Přejeď po úkolu doprava = hotovo, doleva = odložit na zítra.
                </span>
                <button aria-label="Skrýt tip" onClick={dismissTip} className="-m-2 shrink-0 p-2 transition-transform duration-150 active:scale-90">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </p>
            )}
          </>
        ) : (
          // `nacteno` schválně až tady, ne kolem celé obrazovky: hlavička
          // a dok musí naskočit hned, ať appka nezačíná prázdnou plochou.
          nacteno && (
            <>
              <div className="relative overflow-hidden rounded-2xl bg-card px-5 py-8 text-center shadow-card">
                {/* Ripple (magicui): klidná hladina za sluníčkem */}
                <Ripple className="-translate-y-6" />
                <svg viewBox="0 0 48 48" className="breathe relative mx-auto h-12 w-12 text-accent/70" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="24" cy="24" r="15" />
                  <path d="M24 4v5M24 39v5M4 24h5M39 24h5M9.9 9.9l3.5 3.5M34.6 34.6l3.5 3.5M9.9 38.1l3.5-3.5M34.6 13.4l3.5-3.5" />
                </svg>
                <BlurText text={done.length > 0 ? 'Všechno hotovo' : 'Čistý stůl'} className="display relative mt-3 text-lg font-medium" />
                <p className="mt-1 text-sm text-ink-soft">
                  {done.length > 0 ? `${done.length} ${plural(done.length, 'úkol', 'úkoly', 'úkolů')} dnes odškrtnuto.` : 'Na dnešek nic neplánuješ.'}
                </p>

                {/* Učící prázdný stav: příklady se ťuknutím vloží do pole,
                    takže se syntaxe rychlého zadávání naučí sama od sebe. */}
                {open.length === 0 && done.length === 0 && (
                  <>
                    <p className="mt-4 text-[13px] font-medium text-ink-soft">Zkus napsat třeba:</p>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {EXAMPLES.map((ex) => (
                        <button
                          key={ex}
                          onClick={() => window.dispatchEvent(new CustomEvent('todo:prefill', { detail: ex }))}
                          className="rounded-full bg-well px-3 py-2 text-[13px] text-ink transition-transform duration-150 active:scale-95"
                        >
                          „{ex}"
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <button
                  onClick={() => setHelpOpen(true)}
                  className="mt-4 text-[13px] font-medium text-accent-deep transition-transform duration-150 active:scale-95"
                >
                  Jak to funguje
                </button>
              </div>

              {done.length > 0 && (
                <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-card">
                  <button
                    onClick={prepniHotovo}
                    aria-expanded={hotovoOpen}
                    className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors duration-150 active:bg-well/60"
                  >
                    <span className="text-[13px] font-medium text-ink-soft first-letter:uppercase">hotovo · {done.length}</span>
                    <svg
                      viewBox="0 0 24 24"
                      className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${hotovoOpen ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                  <DisclosureContent open={hotovoOpen}>
                    <ul className="divide-y divide-line border-t border-line">{done.map((t) => row(t))}</ul>
                  </DisclosureContent>
                </div>
              )}
            </>
          )
        )}
      </section>

      {navrhOpen && dayPlan && (
        <NavrhSheet
          planId={dayPlan.id}
          navrhy={navrhy}
          clients={clientMap}
          pamet={pamet}
          odpocivajici={odpocivajici}
          onClose={() => setNavrhOpen(false)}
        />
      )}
      {kalendarOpen && (
        <KalendarSheet
          events={events}
          tasks={[...open, ...done]}
          gaps={gaps}
          nowMin={nowMin}
          restStart={restStart}
          today={today}
          freeMin={freeMin !== null && restStart < WORK_END ? freeMin : null}
          onOpenTask={onOpenTask}
          onClose={() => setKalendarOpen(false)}
        />
      )}
      {signalyOpen && <SignalySheet radky={signaly} onClose={() => setSignalyOpen(false)} />}
      {triageOpen && <TriageSheet ukoly={visOverdue} clients={clientMap} onClose={() => setTriageOpen(false)} />}
      {helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}
      {shutdownOpen && (
        <ShutdownSheet tasks={unfinished} onOpenTask={onOpenTask} onCloseDay={closeDay} onClose={() => setShutdownOpen(false)} />
      )}
    </div>
  )
}
