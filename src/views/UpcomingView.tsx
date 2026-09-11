// Plán = dny jako řádky, čas jako pruh.
//
// Jeden nápad, ne tři: každý den je řádek — vlevo datum, vpravo pruh,
// jehož délka je naplánovaný čas (celý pruh = osm hodin) a barvy jsou
// klienti (šedá schůzka nebo úkol bez klienta). Týden se tak čte jako
// vodorovný graf: kde je plno, kde je volno, komu který den patří. Řádky
// jdou pod sebou od dneška a scrollují se do budoucnosti — žádný
// přepínač týden/měsíc, žádný pás čísel, žádná zvláštní karta; ťuknutí
// na den ho rozbalí na místě (schůzky, úkoly, pole pro nový úkol a
// výběr z úkolů bez termínu) a plánuje se tam, kde se den vidí.
//
// Dvě předchozí verze byly kalendář z telefonu (mřížka čísel s tečkami,
// pak se sloupky) a karta dne pod ním. Mřížka umí ukázat jen „něco tam
// je" a u sedmi čísel v řádce není místo na jméno klienta ani na počet
// hodin. Řádek má celou šířku: pruh je čitelný, popisek pod ním řekne
// „2 úkoly · schůzka · ~3 h" a rozbalený den nemusí nikam odskakovat.

import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { CalendarEvent, Task } from '../db/types'
import {
  addTask,
  allClients,
  allProjects,
  calendarEventsBetween,
  completeTask,
  openTasks,
  reopenTask,
  sortTasks,
} from '../db/repo'
import { plannedMinutes } from '../lib/capacity'
import { addDays, formatEventRange, formatFullDate, formatFullDateNa, fromISODate, mondayOf, toISODate, todayISO } from '../lib/dates'
import { minutesToLabel } from '../lib/freeSlot'
import { plural } from '../lib/labels'
import { klidovyRezim } from '../lib/motion'
import { parseQuickAdd } from '../lib/quickAdd'
import { ukazToast } from '../lib/toast'
import { useNavrhPamet } from '../lib/navrhPamet'
import { TaskRow } from '../components/TaskRow'
import { DlouhySeznam } from '../components/DlouhySeznam'
import { Chip } from '../components/Chip'
import { BezTerminuSheet } from '../components/BezTerminuSheet'
import { DisclosureContent } from '../components/ui/Disclosure'
import { TextEffect } from '../components/ui/TextEffect'

const effectiveDate = (t: Task): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

// Celý pruh = osm hodin; víc se do řádku nevejde a řekne to popisek.
const PLNY_DEN_MIN = 8 * 60
// Kolik dní se ukáže napoprvé a o kolik se dobírá.
const DAVKA_DNI = 28
const DNY = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne']
const monthFmt = new Intl.DateTimeFormat('cs-CZ', { month: 'long' })

/** Nálož jednoho dne: minuty podle klienta (bez barvy = schůzka / bez klienta). */
interface DenNaloz {
  ukoly: number
  schuzky: number
  minuty: number
  dily: { barva?: string; minuty: number }[]
}

export function UpcomingView({
  onOpenTask,
  onOpenReview,
}: {
  onOpenTask: (t: Task) => void
  onOpenReview?: () => void
}) {
  const today = todayISO()
  const klid = klidovyRezim()
  const [vybrany, setVybrany] = useState<string | null>(today)
  const [dnu, setDnu] = useState(DAVKA_DNI)
  // Nekonečný seznam: jakmile se konec dostane na dohled, přibere se
  // další dávka dnů. Tlačítko pod ním zůstává pro klávesnici a čtečku.
  const konecRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = konecRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (zaznamy) => {
        if (zaznamy.some((z) => z.isIntersecting)) setDnu((n) => n + DAVKA_DNI)
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const [inbox, setInbox] = useState<null | { cil?: string }>(null)
  const [novy, setNovy] = useState('')

  // Než první dotaz doběhne, není to „volno" — jen se ještě neví.
  const openRaw = useLiveQuery(openTasks, [])
  const open = openRaw ?? []
  const pamet = useNavrhPamet()
  const clients = useLiveQuery(allClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []
  const clientMap = new Map(clients.map((c) => [c.id, c]))
  const projectMap = new Map(projects.map((p) => [p.id, p]))

  const dny = Array.from({ length: dnu }, (_, i) => toISODate(addDays(fromISODate(today), i)))
  const konec = dny[dny.length - 1]

  // Schůzky pro celé okno. Vícedenní událost patří do KAŽDÉHO svého dne.
  const events = useLiveQuery(() => calendarEventsBetween(today, konec), [today, konec]) ?? []
  const eventsPerDay = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    if (e.isTodoBlock) continue
    let d = e.startDay < today ? today : e.startDay
    const end = (e.endDay ?? e.startDay) > konec ? konec : (e.endDay ?? e.startDay)
    let guard = 0
    while (d <= end && guard++ < 90) {
      eventsPerDay.set(d, [...(eventsPerDay.get(d) ?? []), e])
      d = toISODate(addDays(fromISODate(d), 1))
    }
  }

  // Propadlé úkoly patří na dnešek — v Plánu se dívá dopředu, ne zpátky;
  // triáž propadlých je na Dnes.
  const podleDne = new Map<string, Task[]>()
  for (const t of open) {
    const d = effectiveDate(t)
    if (!d) continue
    const den = d < today ? today : d
    podleDne.set(den, [...(podleDne.get(den) ?? []), t])
  }
  const bezTerminu = sortTasks(open.filter((t) => !effectiveDate(t)))

  // Pruh dne: čas úkolů po klientech + délka schůzek (bez barvy).
  const naloz = new Map<string, DenNaloz>()
  for (const d of dny) {
    const ukoly = podleDne.get(d) ?? []
    const schuzky = eventsPerDay.get(d) ?? []
    if (ukoly.length === 0 && schuzky.length === 0) continue
    const podleKlienta = new Map<string, number>()
    for (const t of ukoly) {
      const k = t.clientId && clientMap.has(t.clientId) ? t.clientId : ''
      podleKlienta.set(k, (podleKlienta.get(k) ?? 0) + plannedMinutes([t]))
    }
    let neutralni = podleKlienta.get('') ?? 0
    for (const e of schuzky) {
      if (e.allDay) continue
      neutralni += Math.max(0, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000))
    }
    const dily: DenNaloz['dily'] = [...podleKlienta]
      .filter(([k]) => k !== '')
      .map(([k, minuty]) => ({ barva: clientMap.get(k)!.color, minuty }))
      .sort((a, b) => b.minuty - a.minuty)
    if (neutralni > 0) dily.push({ minuty: neutralni })
    naloz.set(d, {
      ukoly: ukoly.length,
      schuzky: schuzky.length,
      minuty: dily.reduce((sum, x) => sum + x.minuty, 0),
      dily,
    })
  }

  // Souhrn tohoto týdne do hlavičky.
  const pondeli = mondayOf(today)
  const tyden = Array.from({ length: 7 }, (_, i) => toISODate(addDays(fromISODate(pondeli), i))).filter((d) => d >= today)
  const tydenUkoly = tyden.flatMap((d) => podleDne.get(d) ?? [])
  const tydenSchuzky = tyden.reduce((n, d) => n + (eventsPerDay.get(d)?.length ?? 0), 0)
  const tydenMin = plannedMinutes(tydenUkoly)
  const souhrn = [
    'tento týden',
    tydenUkoly.length > 0 ? `${tydenUkoly.length} ${plural(tydenUkoly.length, 'úkol', 'úkoly', 'úkolů')}` : 'bez úkolů',
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

  const nazevDne = (iso: string) => (iso === today ? 'Dnes' : formatFullDate(fromISODate(iso)))
  const naDen = (iso: string) => (iso === today ? 'dnešek' : formatFullDateNa(fromISODate(iso)))

  // Nový úkol rovnou na rozbalený den — parser dál rozumí klientovi,
  // prioritě i času; den je daný řádkem.
  const pridej = async (e: React.FormEvent, iso: string) => {
    e.preventDefault()
    const parsed = parseQuickAdd(novy, clients, new Date(), projects)
    if (!parsed.title) return
    const task = await addTask({
      title: parsed.title,
      dueDate: iso,
      dueTime: parsed.dueTime,
      priority: parsed.priority,
      clientId: parsed.clientId,
      projectId: parsed.projectId,
      recurrenceRule: parsed.recurrenceRule,
      notes: parsed.notes,
    })
    setNovy('')
    ukazToast(`${nazevDne(iso)} — „${task.title}"`)
  }

  // MĚSÍCE jsou hlavní předěl, týdny tichý štítek uvnitř nich. Dřív byl
  // Plán jen řada týdnů a po pár obrazovkách splýval: „od 21. září" je
  // štítek, ne orientační bod, a všechny vypadaly stejně. Teď nese měsíc
  // velké jméno a počet úkolů, týden 13px tichý popisek — dvě velikosti
  // písma říkají, kde končí jeden celek a začíná druhý, bez jediné linky.
  // Týden přes přelom měsíce se DĚLÍ, aby blok měsíce nikdy neukazoval
  // dny jiného; pokračování se pozná podle kotvy (pondělí v minulém
  // měsíci) a místo „tento týden" ukáže rozsah dnů.
  const mesice: { kotva: string; tydny: { kotva: string; dny: string[] }[] }[] = []
  for (const d of dny) {
    const mKotva = d.slice(0, 7)
    const wKotva = mondayOf(d)
    let mesic = mesice[mesice.length - 1]
    if (!mesic || mesic.kotva !== mKotva) {
      mesic = { kotva: mKotva, tydny: [] }
      mesice.push(mesic)
    }
    const posledni = mesic.tydny[mesic.tydny.length - 1]
    if (posledni && posledni.kotva === wKotva) posledni.dny.push(d)
    else mesic.tydny.push({ kotva: wKotva, dny: [d] })
  }

  const stitekMesice = (kotva: string) => {
    const d = fromISODate(`${kotva}-01`)
    const jmeno = monthFmt.format(d)
    // Rok se píše, až když nejde o tenhle — Plán je nekonečný, tak se
    // do něj dá dorolovat i na příští leden.
    return d.getFullYear() === fromISODate(today).getFullYear() ? jmeno : `${jmeno} ${d.getFullYear()}`
  }

  // Souhrn měsíce počítá CELÝ měsíc (od dneška), ne jen vykreslené dny —
  // úkoly jsou v paměti všechny, takže se číslo doscrollováním nemění.
  // Hodiny jsou čas úkolů jako v hlavičce („tento týden · ~4 h"),
  // schůzky v nich nejsou: kalendář je stažený jen po konec okna.
  const souhrnMesice = (kotva: string) => {
    let ukoly = 0
    let minuty = 0
    for (const [den, ts] of podleDne) {
      if (!den.startsWith(kotva)) continue
      ukoly += ts.length
      minuty += plannedMinutes(ts)
    }
    if (ukoly === 0) return 'volno'
    return `${ukoly} ${plural(ukoly, 'úkol', 'úkoly', 'úkolů')}${minuty > 0 ? ` · ~${minutesToLabel(minuty)}` : ''}`
  }

  const stitekTydne = (kotva: string, dnyTydne: string[], pokracovani: boolean) => {
    if (!pokracovani) {
      if (kotva === pondeli) return 'tento týden'
      if (kotva === toISODate(addDays(fromISODate(pondeli), 7))) return 'příští týden'
    }
    const od = fromISODate(dnyTydne[0]).getDate()
    const do_ = fromISODate(dnyTydne[dnyTydne.length - 1]).getDate()
    return od === do_ ? `${od}.` : `${od}.–${do_}.`
  }

  const popisDne = (n: DenNaloz | undefined) => {
    if (!n) return ''
    return [
      n.ukoly > 0 ? `${n.ukoly} ${plural(n.ukoly, 'úkol', 'úkoly', 'úkolů')}` : '',
      n.schuzky > 0 ? `${n.schuzky} ${plural(n.schuzky, 'schůzka', 'schůzky', 'schůzek')}` : '',
      n.minuty > 0 ? `~${minutesToLabel(n.minuty)}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }

  const radekDne = (iso: string) => {
    const d = fromISODate(iso)
    const n = naloz.get(iso)
    const otevreny = vybrany === iso
    const vraceni = otevreny ? open.filter((t) => pamet.odpociva.get(t.id) === iso) : []
    const isToday = iso === today
    const zitra = iso === toISODate(addDays(fromISODate(today), 1))
    const vikend = [0, 6].includes(d.getDay())
    const celkem = n?.minuty ?? 0
    const preteklo = celkem > PLNY_DEN_MIN
    // Šířky dílů v procentech pruhu; přetečený den se stlačí na celý pruh.
    const zaklad = Math.max(celkem, PLNY_DEN_MIN)
    const dayTasks = sortTasks(podleDne.get(iso) ?? [])
    const dayEvents = [...(eventsPerDay.get(iso) ?? [])].sort(
      (a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start),
    )
    return (
      <li key={iso} data-day={iso}>
        <button
          type="button"
          aria-expanded={otevreny}
          onClick={() => setVybrany(otevreny ? null : iso)}
          className="flex w-full items-center gap-3 py-2.5 text-left transition-transform duration-150 active:scale-[0.99]"
        >
          <span className="flex w-11 shrink-0 flex-col items-start leading-none">
            <span className={`text-[11px] font-medium ${isToday || zitra ? 'text-accent-deep' : 'text-ink-faint'}`}>
              {isToday ? 'dnes' : zitra ? 'zítra' : DNY[(d.getDay() + 6) % 7]}
            </span>
            <span
              className={`mt-1 text-[22px] font-semibold tabular-nums ${
                isToday ? 'text-accent-deep' : vikend && !n ? 'text-ink-soft' : 'text-ink'
              }`}
            >
              {d.getDate()}
            </span>
          </span>
          <span className="min-w-0 flex-1">
            {/* Pruh: délka je čas, barvy klienti. Prázdný den má jen
                tichou kolej — graf s nulou má pořád osu. */}
            <span className={`flex h-2.5 w-full gap-px overflow-hidden rounded-full ${n ? 'bg-well' : 'bg-well/60'}`}>
              {n?.dily.map((dil, i) => (
                <span
                  key={i}
                  className={`h-full ${dil.barva ? '' : 'bg-ink-faint'} ${klid ? '' : 'pruh-roste'}`}
                  style={{
                    width: `${Math.max(2, (dil.minuty / zaklad) * 100)}%`,
                    background: dil.barva,
                    animationDelay: klid ? undefined : `${i * 60}ms`,
                  }}
                />
              ))}
            </span>
            <span className={`mt-1.5 block truncate text-[13px] ${n ? 'text-ink-soft' : 'text-ink-faint'}`}>
              {n ? popisDne(n) : 'volno'}
              {preteklo && <span className="text-danger"> · přes 8 h</span>}
            </span>
          </span>
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${otevreny ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {/* Rozbalený den: agenda, pole pro nový úkol, výběr bez termínu.
            Rozbaluje se na místě, takže se plánuje tam, kde se den vidí. */}
        <DisclosureContent open={otevreny}>
          <div className="space-y-2 pb-4 pt-1">
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
              {dayTasks.length > 0 && <DlouhySeznam polozky={dayTasks} radek={row} davka={12} className="divide-y divide-line" />}
              {openRaw !== undefined && dayTasks.length === 0 && dayEvents.length === 0 && (
                <p className="px-4 py-4 text-sm text-ink-faint">Volný den. Napiš, co na něj patří.</p>
              )}
            </div>
            {/* Odložené úkoly se ten den vrátí do ranního návrhu — v Plánu
                je to vidět, aby odložení nebylo zapomenutí. */}
            {vraceni.length > 0 && (
              <p className="px-1 text-[13px] text-ink-faint">
                Vrátí se do ranního návrhu: {vraceni.map((t) => t.title).join(', ')}
              </p>
            )}
            {/* Tiché pole jako v detailu klienta: plusko se vynoří až s textem. */}
            <form onSubmit={(e) => void pridej(e, iso)} className="relative">
              <input
                value={novy}
                onChange={(e) => setNovy(e.target.value)}
                aria-label="Nový úkol na vybraný den"
                placeholder={`Nový úkol na ${naDen(iso)}…`}
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
                onClick={() => setInbox({ cil: iso })}
                className="px-1 py-1 text-[13px] font-medium text-accent-deep"
              >
                + Vybrat z úkolů bez termínu · {bezTerminu.length}
              </button>
            )}
          </div>
        </DisclosureContent>
      </li>
    )
  }

  return (
    <div className="space-y-5">
      <header className="rise">
        <TextEffect as="h1" per="char" preset="blur" className="display text-[2.1rem] font-semibold leading-tight">Plán</TextEffect>
        <p className="text-sm text-ink-soft first-letter:uppercase">{souhrn.join(' · ')}</p>
      </header>

      {/* Co není den: úkoly bez termínu a ohlédnutí. */}
      {(bezTerminu.length > 0 || (onOpenReview && reviewDay)) && (
        <div className="rise -mx-4 flex gap-2 overflow-x-auto px-4 py-1" style={{ scrollbarWidth: 'none' }}>
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

      {mesice.map((m, i) => (
        <section
          key={m.kotva}
          className={`rise ${i > 0 ? 'pt-3' : ''}`}
          style={{ '--stagger': Math.min(i + 1, 6) } as React.CSSProperties}
        >
          <div className="flex items-baseline justify-between gap-3 px-1">
            <h2 className="display text-[19px] font-semibold leading-tight first-letter:uppercase">
              {stitekMesice(m.kotva)}
            </h2>
            <span className="shrink-0 text-[13px] text-ink-soft">{souhrnMesice(m.kotva)}</span>
          </div>
          {m.tydny.map((t, j) => (
            <div key={t.kotva} className={j === 0 ? 'mt-2' : 'mt-4'}>
              <h3 className="section-label mb-1">
                {stitekTydne(t.kotva, t.dny, t.kotva.slice(0, 7) !== m.kotva)}
              </h3>
              <ol className="divide-y divide-line">{t.dny.map(radekDne)}</ol>
            </div>
          ))}
        </section>
      ))}

      <div ref={konecRef} aria-hidden="true" />
      <button
        type="button"
        onClick={() => setDnu((n) => n + DAVKA_DNI)}
        className="px-1 py-2 text-[13px] font-medium text-accent-deep"
      >
        Další čtyři týdny
      </button>

      {inbox && (
        <BezTerminuSheet
          ukoly={bezTerminu}
          clients={clientMap}
          cilovyDen={inbox.cil}
          odpociva={pamet.odpociva}
          onOpenTask={onOpenTask}
          onClose={() => setInbox(null)}
        />
      )}
    </div>
  )
}
