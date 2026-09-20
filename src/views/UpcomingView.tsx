// Plán = měsíční mřížka a pod ní vybraný den.
//
// Klasický kalendář, jak ho lidé znají: sedm sloupců, týden od pondělí,
// listuje se po měsících. Mřížka odpovídá na „kdy to je" — kde je v měsíci
// plno a kde volno — a den pod ní na „co to je": schůzky, úkoly, pole pro
// nový úkol a výběr z úkolů bez termínu. Plánuje se tam, kde se den vidí.
//
// Mřížka měla proti řádkům jednu vadu, kvůli které tu dvakrát nevydržela:
// sedm čísel v řádce má na telefonu ~41 px na buňku a tam se jméno klienta
// ani počet hodin nevejde, takže den umí říct jen „něco tam je". Řeší to
// dělba práce s agendou pod mřížkou (tak to dělá i kalendář v telefonu):
// v buňce je pruh dne v barvách klientů, tedy KOLIK a KOMU, a jména,
// hodiny a jednotlivé úkoly stojí rozepsané pod ní. Čísla nikdy nenesou
// text, na který v nich není místo.
//
// Značka pod číslem je pruh, ne semaforová tečka jako v kalendáříku
// u zadávání: Plán se ptá „kolik toho ten den je a komu to patří".
// Prázdný den značku nedostane — třicet tichých kolejí vedle sebe je
// šedá tapeta, ne graf.

import { useCallback, useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { mojeUkoly } from '../lib/tymUkoly'
import { useJa } from '../lib/useTym'
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
  updateTask,
} from '../db/repo'
import { DEFAULT_TASK_MINUTES, plannedMinutes } from '../lib/capacity'
import { jePreplneno, popisPreplneneho } from '../lib/kapacitaDne'
import { minutyPoDnech, volnejsiDen } from '../lib/volnyDen'
import { addDays, formatDayLabel, formatEventRange, formatFullDate, formatFullDateNa, fromISODate, mondayOf, toISODate, todayISO } from '../lib/dates'
import { minutesToLabel } from '../lib/freeSlot'
import { plural } from '../lib/labels'
import { dnyMesice, kotvaMesice, posunMesic } from '../lib/mesic'
import { klidovyRezim } from '../lib/motion'
import { dilyDne, minutyDilu, type Dil } from '../lib/pruhDne'
import { parseQuickAdd } from '../lib/quickAdd'
import { ukazToast, type ToastAkce } from '../lib/toast'
import { useNavrhPamet } from '../lib/navrhPamet'
import { TaskRow } from '../components/TaskRow'
import { DlouhySeznam } from '../components/DlouhySeznam'
import { MesicniMrizka, type DenZnacka } from '../components/MesicniMrizka'
import { PruhDne } from '../components/PruhDne'
import { Chip } from '../components/Chip'
import { BezTerminuSheet } from '../components/BezTerminuSheet'
import { TextEffect } from '../components/ui/TextEffect'

const effectiveDate = (t: Task): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

const monthFmt = new Intl.DateTimeFormat('cs-CZ', { month: 'long' })

// Okno, ve kterém se hledá volnější den — týž strop jako v triáži
// propadlých a v ranním návrhu: odložit o měsíc není odložení.
const OKNO_JINAM = 7

/** Nálož jednoho dne: minuty podle klienta (bez barvy = schůzka / bez klienta). */
interface DenNaloz {
  ukoly: number
  schuzky: number
  minuty: number
  dily: Dil[]
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
  const [mesic, setMesic] = useState(() => kotvaMesice(today))
  const [vybrany, setVybrany] = useState(today)
  const [inbox, setInbox] = useState<null | { cil?: string }>(null)
  const [novy, setNovy] = useState('')

  // Než první dotaz doběhne, není to „volno" — jen se ještě neví.
  const openRaw = useLiveQuery(openTasks, [])
  // Plán ukazuje MŮJ výhled: pruh dne je moje zátěž, ne součet práce
  // celého týmu. Kolegovy úkoly jsou ve Vše a v detailu klienta.
  const ja = useJa()
  const open = useMemo(() => mojeUkoly(openRaw ?? [], ja), [openRaw, ja])
  const pamet = useNavrhPamet()
  const clients = useLiveQuery(allClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  // Dny zobrazeného měsíce. Plán se dívá dopředu, takže se nálož počítá
  // od dneška — minulé dny v mřížce zůstanou tiché a propadlá práce
  // stojí na dnešku, kde se s ní dá něco dělat (triáž je na Dnes).
  const dnyVMesici = useMemo(() => dnyMesice(mesic), [mesic])
  const oknoOd = dnyVMesici[0] < today ? today : dnyVMesici[0]
  const oknoDo = dnyVMesici[dnyVMesici.length - 1] < oknoOd ? oknoOd : dnyVMesici[dnyVMesici.length - 1]

  // Schůzky pro celé okno. Vícedenní událost patří do KAŽDÉHO svého dne.
  const events = useLiveQuery(() => calendarEventsBetween(oknoOd, oknoDo), [oknoOd, oknoDo]) ?? []

  // CELÝ rozpočet Plánu v jednom `useMemo`. Nezávisí na vybraném dni ani
  // na rozepsaném úkolu — a přesně to se dřív dělo: každé písmeno v poli
  // „Nový úkol na sobotu…" přepočítalo schůzky, rozdělení úkolů po dnech
  // i pruhy zátěže pro celé okno.
  const { eventsPerDay, podleDne, bezTerminu, naloz, souhrn } = useMemo(() => {
    const eventsPerDay = new Map<string, CalendarEvent[]>()
    for (const e of events) {
      if (e.isTodoBlock) continue
      let d = e.startDay < oknoOd ? oknoOd : e.startDay
      const end = (e.endDay ?? e.startDay) > oknoDo ? oknoDo : (e.endDay ?? e.startDay)
      let guard = 0
      while (d <= end && guard++ < 90) {
        const uz = eventsPerDay.get(d)
        if (uz) uz.push(e)
        else eventsPerDay.set(d, [e])
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
      // `push` do stávajícího pole, ne kopie celého pole při každém úkolu:
      // to druhé je kvadratická práce a na dnešek padají všechny propadlé,
      // takže se ta hromádka kopírovala pořád dokola.
      const uz = podleDne.get(den)
      if (uz) uz.push(t)
      else podleDne.set(den, [t])
    }
    const bezTerminu = sortTasks(open.filter((t) => !effectiveDate(t)))

    // Pruh dne: čas úkolů po klientech + délka schůzek (bez barvy).
    const naloz = new Map<string, DenNaloz>()
    for (const d of dnyVMesici) {
      if (d < today) continue
      const ukoly = podleDne.get(d) ?? []
      const schuzky = eventsPerDay.get(d) ?? []
      if (ukoly.length === 0 && schuzky.length === 0) continue
      const schuzkyMinuty = schuzky.reduce(
        (soucet, e) =>
          soucet + (e.allDay ? 0 : Math.max(0, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000))),
        0,
      )
      const dily = dilyDne(ukoly, schuzkyMinuty, (id) => clientMap.get(id)?.color)
      naloz.set(d, {
        ukoly: ukoly.length,
        schuzky: schuzky.length,
        minuty: minutyDilu(dily),
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

    return { eventsPerDay, podleDne, bezTerminu, naloz, souhrn }
  }, [dnyVMesici, today, oknoOd, oknoDo, open, events, clientMap])

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

  // Značky do mřížky: buňka nese pruh a přístupný popis, nic víc se do ní
  // nevejde. Počítá se z téže nálože jako popisek pod agendou, takže
  // mřížka a den pod ní nikdy neřeknou dvě různá čísla.
  const znacky = useMemo(() => {
    const m = new Map<string, DenZnacka>()
    // Slovo „přeplněno" patří JEN sem. Pod agendou stojí červené „přes
    // 8 h" hned vedle čísel, takže by tam byla dvě jména pro totéž na
    // jedné řádce; v buňce naopak není nic než pruh, a ten se přes strop
    // nemůže natáhnout — bez slova by den s osmi a den s třinácti
    // hodinami zněl pro čtečku stejně.
    for (const [den, n] of naloz)
      m.set(den, {
        dily: n.dily,
        popis: popisDne(n) + (jePreplneno(n.minuty) ? ' · přeplněno' : ''),
        preplneno: jePreplneno(n.minuty),
      })
    return m
  }, [naloz])

  // Neděle a pondělí — stejné okno, v jakém chodí nedělní push notifikace.
  const reviewDay = [0, 1].includes(fromISODate(today).getDay())

  // Stabilní identita kvůli `memo` na `TaskRow` — nová funkce při každém
  // překreslení by memoizaci zrušila a řádky by se překreslily všechny.
  const toggle = useCallback((t: Task) => {
    void (t.status === 'done' ? reopenTask(t.id) : completeTask(t.id))
  }, [])
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

  // Nový úkol rovnou na vybraný den — parser dál rozumí klientovi,
  // prioritě i času; den je daný mřížkou.
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
    if (!hlidejStrop(iso, task)) ukazToast(`${nazevDne(iso)} — „${task.title}"`)
  }

  /**
   * Den má strop a appka to říká VE CHVÍLI, KDY SE NA NĚJ SYPE PRÁCE.
   *
   * Nezakazuje: úkol na ten den opravdu jde a zůstane tam, dokud s ním
   * člověk sám nepohne — zakazovat by znamenalo dialog a ty v téhle appce
   * nejsou. Říká výsledek a nabízí cestu ven, stejně jako u mazání.
   *
   * „Jinam" je tentýž volnější den, jaký volí triáž propadlých i ranní
   * návrh (`volnejsiDen`) — appka nesmí mít dvě různé představy o tom,
   * kam se odkládá. Hledá se od DALŠÍHO dne: ten vybraný je plný, takže
   * kdyby byl v okně nejlehčí, vrátil by se sám a tlačítko by nic
   * neudělalo.
   *
   * Minuty se sčítají z nálože téhle obrazovky PLUS odhad nového úkolu —
   * živý dotaz o něm ještě neví a čekat na překreslení by znamenalo hlásit
   * strop až o úkol později, tedy zase pozdě.
   */
  const stropDne = useCallback(
    (iso: string, t: Task): { text: string; akce: ToastAkce } | undefined => {
      const minuty = (naloz.get(iso)?.minuty ?? 0) + (t.estimateMinutes ?? DEFAULT_TASK_MINUTES)
      if (!jePreplneno(minuty)) return undefined
      const od = toISODate(addDays(fromISODate(iso), 1))
      const doDne = toISODate(addDays(fromISODate(iso), OKNO_JINAM))
      const jinam = volnejsiDen(minutyPoDnech(open, events, od, doDne, today), od, OKNO_JINAM)
      return {
        // Krátký popisek dne („so 12. 9."), ne „sobota 12. září": toast
        // má `max-w-48` a delší věta se v něm ořízne — hlášku, kterou
        // není vidět celou, je zbytečné psát.
        text: popisPreplneneho(formatDayLabel(iso), minuty),
        akce: {
          popisek: 'Jinam',
          kdyz: () => {
            void updateTask(t.id, { dueDate: jinam })
            ukazToast(`${nazevDne(jinam)} — „${t.title}"`)
          },
        },
      }
    },
    // `nazevDne` i `naloz` se mění s rendererem; `open`/`events` jsou
    // z živých dotazů, takže drží referenci, dokud se dotaz nespustí znovu.
    [naloz, open, events, today], // eslint-disable-line react-hooks/exhaustive-deps
  )

  function hlidejStrop(iso: string, t: Task): boolean {
    const strop = stropDne(iso, t)
    if (!strop) return false
    ukazToast(strop.text, [strop.akce])
    return true
  }

  const stitekMesice = (kotva: string) => {
    const d = fromISODate(`${kotva}-01`)
    const jmeno = monthFmt.format(d)
    // Rok se píše, až když nejde o tenhle — dolistovat se dá kamkoli.
    return d.getFullYear() === fromISODate(today).getFullYear() ? jmeno : `${jmeno} ${d.getFullYear()}`
  }

  // Souhrn měsíce počítá CELÝ měsíc (od dneška), ne jen dny se značkou.
  // Hodiny jsou čas úkolů jako v hlavičce („tento týden · ~4 h"), schůzky
  // v nich nejsou: kalendář je stažený jen po konec okna.
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

  // Listování měsíci bere výběr s sebou: kdyby zůstal, ukazuje agenda den,
  // který v mřížce nad ní není vidět, a obrazovka mluví o dvou různých
  // dnech naráz. V měsíci s dneškem padne výběr na dnešek, jinde na první.
  const listuj = (o: number) => {
    const cil = posunMesic(mesic, o)
    setMesic(cil)
    setVybrany(cil === kotvaMesice(today) ? today : `${cil}-01`)
  }
  const naDnesek = () => {
    setMesic(kotvaMesice(today))
    setVybrany(today)
  }

  const denNaloz = naloz.get(vybrany)
  // Týž strop jako pruh, mřížka i toast. Dokud se tu porovnávalo holé
  // `> PLNY_DEN_MIN`, měla appka na jedné obrazovce tři různé představy
  // o plném dni: den s osmi hodinami a čtvrt tu svítil červeně, pruh nad
  // ním byl plný tak akorát a toast při zadávání mlčel.
  const preteklo = jePreplneno(denNaloz?.minuty ?? 0)
  const dayTasks = sortTasks(podleDne.get(vybrany) ?? [])
  const dayEvents = [...(eventsPerDay.get(vybrany) ?? [])].sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start),
  )
  const vraceni = open.filter((t) => pamet.odpociva.get(t.id) === vybrany)

  return (
    <div className="space-y-5">
      <header className="rise">
        <TextEffect as="h1" per="char" preset="blur" className="display text-[2.1rem] font-semibold leading-tight">Plán</TextEffect>
        <p className="text-sm text-ink-soft first-letter:uppercase">{souhrn.join(' · ')}</p>
      </header>

      {/* Co není den: úkoly bez termínu a ohlédnutí. */}
      {(bezTerminu.length > 0 || (onOpenReview && reviewDay)) && (
        <div className="radka-mizi rise -mx-4 flex gap-2 overflow-x-auto px-4 py-1" style={{ scrollbarWidth: 'none' }}>
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

      {/* Mřížka měsíce. Jméno měsíce nese souhrn, šipky listují — stejné
          řazení jako všude jinde: nadpis vlevo na svislici, čísla vpravo. */}
      <section className="rise">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="display text-[19px] font-semibold leading-tight first-letter:uppercase">
            {stitekMesice(mesic)}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            {mesic !== kotvaMesice(today) && (
              <button
                type="button"
                onClick={naDnesek}
                className="flex h-8 items-center rounded-full px-2.5 text-[13px] font-medium text-accent-deep"
              >
                dnes
              </button>
            )}
            <button
              type="button"
              onClick={() => listuj(-1)}
              aria-label="Předchozí měsíc"
              className="flex h-8 w-8 items-center justify-center rounded-full text-accent transition-transform duration-150 active:scale-90"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => listuj(1)}
              aria-label="Další měsíc"
              className="flex h-8 w-8 items-center justify-center rounded-full text-accent transition-transform duration-150 active:scale-90"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
        <p className="section-label mb-2">{souhrnMesice(mesic)}</p>
        <MesicniMrizka
          kotva={mesic}
          dnes={today}
          vybrany={vybrany}
          znacky={znacky}
          klid={klid}
          onVyber={setVybrany}
        />
      </section>

      {/* Vybraný den: co na něm stojí a kam se dá přidat. */}
      <section className="rise space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="display text-[19px] font-semibold leading-tight first-letter:uppercase">
            {nazevDne(vybrany)}
          </h2>
          <span className={`shrink-0 text-[13px] ${denNaloz ? 'text-ink-soft' : 'text-ink-faint'}`}>
            {denNaloz ? popisDne(denNaloz) : 'volno'}
            {preteklo && <span className="text-danger"> · přes 8 h</span>}
          </span>
        </div>
        {/* Pruh přes celou šířku: v mřížce je ten samý obrázek v malém. */}
        <PruhDne dily={denNaloz?.dily ?? []} klid={klid} />

        <div className="seznam-na-papire">
          {dayEvents.length > 0 && (
            <ul className="divide-y divide-line">
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
            <p className="py-4 text-sm text-ink-faint">Volný den. Napiš, co na něj patří.</p>
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
        <form onSubmit={(e) => void pridej(e, vybrany)} className="relative">
          <input
            value={novy}
            onChange={(e) => setNovy(e.target.value)}
            aria-label="Nový úkol na vybraný den"
            placeholder={`Nový úkol na ${naDen(vybrany)}…`}
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
            className="px-1 py-2 text-[13px] font-medium text-accent-deep"
          >
            + Vybrat z úkolů bez termínu · {bezTerminu.length}
          </button>
        )}
      </section>

      {inbox && (
        <BezTerminuSheet
          ukoly={bezTerminu}
          clients={clientMap}
          cilovyDen={inbox.cil}
          odpociva={pamet.odpociva}
          stropDne={stropDne}
          onOpenTask={onOpenTask}
          onClose={() => setInbox(null)}
        />
      )}
    </div>
  )
}
