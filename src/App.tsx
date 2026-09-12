import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Task } from './db/types'
import { getTask } from './db/repo'
import { QuickAdd } from './components/QuickAdd'
import { SearchSheet } from './components/SearchSheet'
import { ToastHost } from './components/ToastHost'
import { SyncButton, SyncSheet } from './components/SyncSheet'
import { TaskEditSheet } from './components/TaskEditSheet'
import { jeOtevrenyPanel } from './components/Sheet'
import { jeMac, zkratkaZKlavesy } from './lib/shortcuts'
import { MotionConfig, motion } from 'motion/react'
import { BlurFade } from './components/ui/BlurFade'
import { ClickSpark } from './components/ui/ClickSpark'
import { Dock, DockIcon } from './components/ui/Dock'
import { klidovyRezim } from './lib/motion'
import { DokZalozka, DokZalozky } from './components/DokZalozky'
import { Kbd } from './components/ui/Kbd'
import { Magnetic } from './components/ui/Magnetic'
import { ProgressiveBlur } from './components/ui/ProgressiveBlur'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/Tooltip'
import { TodayView } from './views/TodayView'
import { VseView } from './views/VseView'
import { UpcomingView } from './views/UpcomingView'
import { ClientsView } from './views/ClientsView'
import { WeeklyReviewSheet } from './components/WeeklyReviewSheet'
import { vyhodnotStisk, type Stisk } from './lib/dvojklik'

type Tab = 'today' | 'upcoming' | 'clients'

// Podpis ikony (fajfka, linka data, druhá postava) se při vybrání
// dokreslí tahem — pathLength z motion; obrys stojí. V klidu jen stojí.
function Tah({ d, on }: { d: string; on: boolean }) {
  if (klidovyRezim() || !on) return <path d={d} />
  return (
    <motion.path
      key="on"
      d={d}
      initial={{ pathLength: 0, opacity: 0.3 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.2, 0, 0, 1], delay: 0.14 }}
    />
  )
}

// Šířka složeného doku: tři sloty po 64 px (přesně šířka čočky) s mezerou
// 20 px, 20 px k plusku (40 px) a okraje 6 / 8 px = 306 px. Čočka
// (44 px v 56) i plusko (40 px v 56) tak sedí v rozích kapsle se stejnou
// mezerou, jakou mají svisle — zaoblení vrstev je soustředné (28 − 6 = 22,
// 28 − 8 = 20). Dřív se záložky roztahovaly na třetiny celé šířky
// (366 px) a čočka měla vlevo 28 px, nahoře 6; se 4px mezerami (262 px)
// byl dok zase moc sevřený — 306 je střed. Na 320 px displeji ho
// okraje patičky stlačí na 296 a sloty se o pár pixelů zúží. Otevřené
// zadávání dostane celou šířku — pole a řádka slotů ji potřebují.
const DOK_SIRKA = 6 + 3 * 64 + 2 * 20 + 20 + 40 + 8

// Druhý argument je poloha záložky Dnes (false = dnešek, true = vše).
// Jen první záložka ho používá — má dvě polohy, ostatní jednu.
const TABS: Array<{ id: Tab; label: string; icon: (on: boolean, vse: boolean) => React.ReactNode }> = [
  {
    id: 'today',
    label: 'Dnes',
    // Dvě podoby téže ikony, ne dvě různé ikony: kroužek s fajfkou
    // zůstává, ve druhé poloze se za něj postaví druhý kroužek —
    // „ne jeden den, ale celá hromádka". Kdo se podívá na dok, pozná
    // polohu bez čtení; kdo ji nezná, vidí pořád svoji záložku Dnes.
    icon: (on, vse) =>
      vse ? (
        <svg viewBox="0 0 24 24" className="h-full w-full transition-[stroke-width] duration-300" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
          {/* Zadní kroužek je oblouk ukončený PŘESNĚ v průsečíku s předním
              (r 7,6, středy 10,6 a 14,0 → průsečíky v 12,30 ± 7,41), takže
              mizí za ním a nevypadá jako závorka vedle. */}
          <path d="M12.3 4.59A7.6 7.6 0 1 0 12.3 19.41" opacity="0.5" />
          <circle cx="14" cy="12" r="7.6" />
          <Tah d="M11.04 12.17l2.03 2.03 4.05-4.4" on={on} />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-full w-full transition-[stroke-width] duration-300" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <Tah d="M8.5 12.2l2.4 2.4 4.8-5.2" on={on} />
        </svg>
      ),
  },
  {
    id: 'upcoming',
    label: 'Plán',
    icon: (on) => (
      <svg viewBox="0 0 24 24" className="h-full w-full transition-[stroke-width] duration-300" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
        <path d="M8 3v4M16 3v4" />
        <Tah d="M3.5 9.5h17" on={on} />
      </svg>
    ),
  },
  {
    id: 'clients',
    label: 'Klienti',
    icon: (on) => (
      <svg viewBox="0 0 24 24" className="h-full w-full transition-[stroke-width] duration-300" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8.5" r="3.25" />
        <path d="M3.5 19c.6-3 2.8-4.75 5.5-4.75S13.9 16 14.5 19" />
        <circle cx="17" cy="9.5" r="2.5" />
        <Tah d="M15.5 14.6c2.3.2 4.1 1.7 4.7 4.4" on={on} />
      </svg>
    ),
  },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  // Druhá poloha záložky Dnes: dvojité ťuknutí na ni ukáže VŠECHNY
  // otevřené úkoly (`VseView`). Je to nahlédnutí, ne režim — přepnutí
  // záložky ho vždycky složí zpátky, takže se v něm nedá uvíznout.
  const [vse, setVse] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  // Týdenní ohlédnutí bydlí v Plánu, ale sheet drží App: notifikace
  // otevře appku na Dnes, takže deep-link #review musí zabrat bez ohledu
  // na to, který pohled je zrovna vykreslený.
  const [reviewOpen, setReviewOpen] = useState(false)

  // Deep-link #review z nedělní notifikace. Dřív ho odchytával TodayView,
  // jenže tam už karta ohlédnutí není — a hlavně: handler v pohledu funguje
  // jen dokud je ten pohled vykreslený. Tady zabere vždycky.
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== '#review') return
      setReviewOpen(true)
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])
  const [syncOpen, setSyncOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // Zadávání úkolu je složené do pluska — dok tak zůstane slim kapsle
  // a možnosti (termín, klient…) se ukážou, až když je potřebuješ.
  const [addOpen, setAddOpen] = useState(false)
  const addOpenRef = useRef(false)
  addOpenRef.current = addOpen
  // Odscrollováno = horní lišta se zamlží a ukáže kompaktní titulek.
  const [scrolled, setScrolled] = useState(false)
  // Navigace z tichých signálů: otevřít konkrétního klienta na záložce Klienti.
  const [clientFocus, setClientFocus] = useState<string | null>(null)

  const openClient = (id: string) => {
    setClientFocus(id)
    setTab('clients')
  }

  useEffect(() => {
    setVse(false)
  }, [tab])
  // Aktuální záložka pro obsluhu klávesnice, která se věší jen jednou.
  const tabRef = useRef<Tab>(tab)
  tabRef.current = tab
  // Vracíme se z Vše? Jen tehdy se obrazovka snáší shora.
  const prevVse = useRef(vse)
  const zVse = prevVse.current && !vse

  // Směr přechodu záložek: nový pohled přijíždí ze strany, kam se jde.
  const prevTab = useRef<Tab>(tab)
  const dir = TABS.findIndex((t) => t.id === tab) - TABS.findIndex((t) => t.id === prevTab.current)
  const mainRef = useRef<HTMLElement>(null)
  // Spodní dok plave nad obsahem (aby přes sklo prosvítal), takže si
  // musí říct o odsazení — a jeho výška se mění (lišta, výběr termínu).
  const dockRef = useRef<HTMLElement>(null)
  // Poslední stisk „1" (kvůli dvojímu — viz case 'dnes').
  const klavesa = useRef<Stisk | null>(null)
  // Klávesnice na Macu: ⌘K hledá, N otevře zadávání, 1–3 přepínají
  // záložky, Esc složí zadávání. Co je zkratka a co psaní, rozhoduje
  // čistá logika v src/lib/shortcuts.ts; s otevřeným panelem mlčí.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const piseSe =
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      const akce = zkratkaZKlavesy(e, { piseSe, panel: jeOtevrenyPanel(), zadavani: addOpenRef.current })
      if (!akce) return
      e.preventDefault()
      switch (akce) {
        case 'hledat':
          setSearchOpen(true)
          break
        case 'novy':
          setAddOpen(true)
          // už rozbalené: autoFocus se znovu nespustí, tak se zaostří ručně
          dockRef.current?.querySelector('input')?.focus()
          break
        case 'zavrit':
          setAddOpen(false)
          if (el instanceof HTMLElement) el.blur()
          break
        case 'dnes':
          // Dvojí „1" dělá totéž co dvojité ťuknutí na záložku — jedno
          // pravidlo pro prst i klávesnici (`src/lib/dvojklik.ts`).
          if (e.repeat) break
          if (tabRef.current !== 'today') {
            klavesa.current = null
            setTab('today')
          } else {
            const r = vyhodnotStisk(klavesa.current, 'today', performance.now())
            klavesa.current = r.stav
            if (r.dvojite) setVse((v) => !v)
          }
          break
        case 'plan':
          setTab('upcoming')
          break
        case 'klienti':
          setTab('clients')
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useLayoutEffect(() => {
    const el = dockRef.current
    if (!el) return
    const apply = () =>
      document.documentElement.style.setProperty('--dock-h', `${el.offsetHeight}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Klávesnice na iOS nezmenšuje layout (100dvh zůstává), jen překryje
  // spodek obrazovky. Jediné, co o ní ví, je visualViewport — a ten říká
  // rovnou, kde viditelná část začíná (offsetTop) a jak je vysoká.
  // Obal appky se na ten obdélník posadí napevno (position: fixed), takže
  // dok u jeho spodního okraje leží přesně na hraně klávesnice a seznam
  // scrolluje jen v tom, co je vidět. Chová se to jako lišta v chatu:
  // psaní stojí nad klávesnicí, obsah za ním jde listovat.
  //
  // Proč fixed a proč měřit z clientHeight: `window.innerHeight` v PWA na
  // ploše občas o klávesnici neví, kdežto documentElement.clientHeight je
  // výška layoutu, která se nemění. A relativní posun by se počítal od
  // místa ve flow — fixed obdélník je jednoznačný.
  const kbRef = useRef(0)
  const kbAnchor = useRef(0)
  const KB_SCROLL_DISMISS = 120

  useEffect(() => {
    const vv = window.visualViewport
    const root = document.documentElement
    const apply = () => {
      const layout = root.clientHeight || window.innerHeight
      const top = vv ? Math.round(vv.offsetTop) : 0
      const height = vv ? Math.round(vv.height) : layout
      // kolik layoutu zbývá pod viditelnou částí = klávesnice
      const below = Math.max(0, layout - (top + height))
      if (below > 0 && kbRef.current === 0) kbAnchor.current = mainRef.current?.scrollTop ?? 0
      kbRef.current = below
      const st = root.style
      st.setProperty('--vv-top', `${top}px`)
      st.setProperty('--vvh', `${height}px`)
      st.setProperty('--vv-bottom', `${below}px`)
      // nad klávesnicí není domovní lišta, safe-area by byla prázdný pruh
      st.setProperty('--dock-safe', below > 0 ? '0px' : 'env(safe-area-inset-bottom)')
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)
    apply()
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
    }
  }, [])
  useEffect(() => {
    prevVse.current = vse
  }, [vse])
  useEffect(() => {
    prevTab.current = tab
    // nová záložka začíná nahoře, ne uprostřed předchozího seznamu
    mainRef.current?.scrollTo(0, 0)
    setScrolled(false)
    setAddOpen(false)
  }, [tab])

  // Příklad z prázdného stavu vkládá text do pole — musí se s ním
  // zadávání i rozbalit, jinak by se „nic nestalo".
  useEffect(() => {
    const open = () => setAddOpen(true)
    window.addEventListener('todo:prefill', open)
    return () => window.removeEventListener('todo:prefill', open)
  }, [])

  // Deep-linky z notifikací. #shutdown si přebírá TodayView (a hash uklidí),
  // tady stačí přepnout na Dnes; #review otevírá sheet výš a záložku nechává
  // být — ohlédnutí se dívá zpátky, přepínat kvůli němu na Dnes nedává smysl.
  // #task-{id} otevře rovnou detail úkolu — připomínka termínu vede k němu.
  useEffect(() => {
    const check = () => {
      const hash = window.location.hash
      if (hash === '#shutdown') setTab('today')
      const task = /^#task-(.+)$/.exec(hash)
      if (task) {
        history.replaceState(null, '', window.location.pathname + window.location.search)
        void getTask(task[1]).then((t) => {
          if (t && !t.deletedAt) setEditing(t)
        })
      }
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])

  const modifikator = jeMac() ? '⌘' : 'Ctrl'

  return (
    // reducedMotion="user": motion vypne transformace v klidovém režimu;
    // průhlednost a filtry si komponenty hlídají samy (src/lib/motion.ts).
    <MotionConfig reducedMotion="user">
    <TooltipProvider>
    <div className="app-shell fixed inset-x-0 mx-auto flex max-w-lg flex-col bg-paper text-ink antialiased">
      {/* Horní lišta ve stylu iOS: v klidu průhledná (velký titulek si
          svítí sám), po odscrollování se zamlží a obsah pod ni podjede —
          jinak by ikony seděly přímo na textu úkolů. Průchozí na dotyk,
          klikají jen samotná tlačítka. */}
      {/* Závoj pod lištou: po odscrollování se obsah nahoře postupně
          rozostří a rozpustí do papíru, místo aby se sekl o hranu
          zamlžené lišty (dřív border-b + backdrop-blur na celé liště). */}
      <ProgressiveBlur
        direction="top"
        className={`absolute inset-x-0 top-0 z-30 bg-linear-to-b from-paper/85 to-transparent transition-opacity duration-250 ${scrolled ? 'opacity-100' : 'opacity-0'}`}
        style={{ height: 'calc(4.4rem + env(safe-area-inset-top))' }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-end gap-2 px-4 pb-2.5"
        style={{ paddingTop: 'calc(0.85rem + env(safe-area-inset-top))' }}
      >
        <span
          className={`pointer-events-none absolute left-4 text-[17px] font-semibold transition-opacity duration-200 ${
            scrolled ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {vse ? 'Vše' : TABS.find((t) => t.id === tab)?.label}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Hledat"
              onClick={() => setSearchOpen(true)}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-[background-color,transform] duration-150 active:scale-90 active:bg-well"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M15.8 15.8L20 20" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Hledat <Kbd>{modifikator} K</Kbd>
          </TooltipContent>
        </Tooltip>
        <span className="pointer-events-auto">
          <SyncButton onOpen={() => setSyncOpen(true)} />
        </span>
      </div>

      <main
        ref={mainRef}
        onScroll={(e) => {
          // pojistka: obsah se nikdy nesmí odrolovat do strany
          if (e.currentTarget.scrollLeft !== 0) e.currentTarget.scrollLeft = 0
          const top = e.currentTarget.scrollTop
          setScrolled(top > 24)
          // listování s otevřenou klávesnicí: po delším kusu ji uklidit
          if (kbRef.current > 0 && Math.abs(top - kbAnchor.current) > KB_SCROLL_DISMISS) {
            const active = document.activeElement
            if (active instanceof HTMLElement && dockRef.current?.contains(active)) active.blur()
          }
        }}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4"
        style={{
          paddingTop: 'calc(1rem + env(safe-area-inset-top))',
          paddingBottom: 'calc(var(--dock-h, 9rem) + 0.75rem)',
        }}
      >
        {/* key vynutí novou instanci pohledu → BlurFade (magicui) ho vynoří
            z rozostření ze strany, kam se v doku šlo.
            Obal s overflow-x: clip: nájezd posouvá obsah o 14 px do strany
            a po dobu animace tím přetéká doprava — iOS si to vzal jako
            vodorovné rolování a obsah zůstal odrolovaný (levý okraj 2 pt,
            pravý 30 pt). Clip přesah nepustí do rolovací plochy; záporná
            marže drží řádky chipů s -mx-4 dál až na hraně obrazovky. */}
        <div className="-mx-4 overflow-x-clip px-4">
        <BlurFade
          key={vse ? `${tab}-vse` : tab}
          // Vše je vrstva POD Dneškem: vytahuje se zespoda ('up') a při
          // návratu se dnešek snese shora ('down'). Mezi záložkami se
          // pořád jede do strany, kam se v doku šlo — a start appky
          // zůstává nájezdem zespoda, proto se 'down' dává jen při
          // opravdovém návratu z Vše, ne pokaždé, když `dir` vyjde nula.
          direction={dir === 0 ? (zVse ? 'down' : 'up') : dir > 0 ? 'left' : 'right'}
          offset={14}
          blur="6px"
          duration={0.36}
        >
          {tab === 'today' && !vse && (
            <TodayView
              onOpenTask={setEditing}
              onOpenClient={openClient}
              onOpenInbox={() => setTab('upcoming')}
            />
          )}
          {tab === 'today' && vse && <VseView onOpenTask={setEditing} onZpet={() => setVse(false)} />}
          {tab === 'upcoming' && (
            <UpcomingView
              onOpenTask={setEditing}
              onOpenReview={() => setReviewOpen(true)}
            />
          )}
          {tab === 'clients' && (
            <ClientsView
              onOpenTask={setEditing}
              focusClientId={clientFocus}
              onFocusConsumed={() => setClientFocus(null)}
            />
          )}
        </BlurFade>
        </div>
      </main>

      {/* Spodní dok: jedna plovoucí skleněná deska, přes kterou obsah
          prosvítá rozmazaný. Obal je průchozí na dotyk, klikatelná je
          jen samotná deska — u okrajů tak jde dál scrollovat obsah. */}
      {/* Závoj pod dokem: seznam se pod sklem nezařízne, ale rozpustí. */}
      <ProgressiveBlur
        direction="bottom"
        className="absolute inset-x-0 bottom-0 z-20 bg-linear-to-t from-paper/80 to-transparent"
        style={{ height: 'calc(var(--dock-h, 9rem) + 1.25rem)' }}
      />
      <footer
        ref={dockRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3"
        // Dok sedí níž než bezpečná zóna — jako tab bar v iOS 26, který
        // domovnímu indikátoru nechá jen pár bodů. Na iPhonu s indikátorem
        // (zóna 34 pt) je spodní hrana 24 pt nad displejem; dřív +8 px nad
        // zónou, tedy 42 pt. Pojistka 8 px platí bez indikátoru (Mac,
        // starší iPhone) i nad klávesnicí, kde se zóna nuluje.
        style={{ paddingBottom: 'max(0.5rem, calc(var(--dock-safe, env(safe-area-inset-bottom)) - 10px))' }}
      >
        {/* Dok při startu vyjede zespoda pružinou — jediná věc na
            obrazovce, která přijíždí proti směru obsahu. V klidu stojí. */}
        <motion.div
          initial={klidovyRezim() ? false : { y: 36, opacity: 0, scale: 0.94 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ type: 'spring', bounce: 0.28, duration: 0.75, delay: 0.12 }}
          className={`dock pointer-events-auto mx-auto overflow-hidden transition-[border-radius,max-width] duration-300 ease-ios ${
            addOpen ? 'rounded-[28px]' : 'rounded-full'
          }`}
          style={{ maxWidth: addOpen ? '100%' : DOK_SIRKA }}
        >
          {/* Zadávání se rozvine až po ťuknutí na plus — složené zabírá
              nulovou výšku, takže dok je v klidu jen tenká kapsle. */}
          <div className={`compose ${addOpen ? '' : 'is-collapsed'}`}>
            <div>
              <div>
                <QuickAdd
                  onShowUpcoming={tab === 'upcoming' ? undefined : () => setTab('upcoming')}
                  defaultToToday={tab === 'today'}
                  autoFocus={addOpen}
                />
              </div>
            </div>
          </div>

          {/* Samé ikony, bez popisků — název sekce drží horní lišta.
              Který list je vybraný, říká pilulka pod ikonou. */}
          {/* ClickSpark (react-bits): z místa ťuknutí vyletí jiskry —
              hmatová odezva bez haptiky. Dock (magicui): pod kurzorem se
              ikony zvětšují jako v macOS doku; prst nechá velikost být. */}
          <ClickSpark className="relative">
          <nav className="flex h-14 items-center pl-1.5 pr-2">
            {/* DokZalozky (vlastní, po vzoru tab baru iOS 26): pilulka pod
                ikonou se zvedne, překlouže a dosedne; když prst na doku zůstane a táhne,
                jede s ním a puštění vybere nejbližší záložku. */}
            <DokZalozky
              value={tab}
              onChange={(id) => setTab(id as Tab)}
              onReselect={(id) => id === 'today' && setVse((v) => !v)}
              poloha={vse ? 'vse' : 'dnes'}
              className="flex flex-1 items-center"
            >
            <Dock className="flex-1 gap-5">
            {TABS.map((t, i) => (
              <Tooltip key={t.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setTab(t.id)}
                    aria-label={t.label}
                    aria-current={tab === t.id ? 'page' : undefined}
                    className={`relative flex flex-1 items-center justify-center transition-colors duration-200 ${
                      tab === t.id ? 'text-ink' : 'text-ink-soft'
                    }`}
                  >
                    <DockIcon className="relative rounded-full">
                      {/* ikona bere 60 % pilulky, takže se zvětšuje s ní;
                          podpis ikony se při vybrání dokreslí tahem */}
                      <DokZalozka
                        id={t.id}
                        on={tab === t.id}
                        podoba={t.id === 'today' ? (vse ? 'vse' : 'dnes') : t.id}
                      >
                        {t.icon(tab === t.id, vse)}
                      </DokZalozka>
                    </DockIcon>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {t.label} <Kbd>{i + 1}</Kbd>
                </TooltipContent>
              </Tooltip>
            ))}
            </Dock>
            </DokZalozky>
            {/* Otevřené zadávání má vlastní modré kolečko pro odeslání.
                Když bylo modré i tohle, stály pod sebou dva skoro stejné
                kruhy s opačným významem — a ten zavírací byl větší a níž,
                tedy blíž palci. Zavření je druhotná akce, tak i vypadá. */}
            {/* Magnetic (motion-primitives): na Macu se plusko lehce
                přitáhne ke kurzoru; na dotyku se neděje nic. */}
            <Magnetic intensity={0.35} range={70}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label={addOpen ? 'Zavřít zadávání' : 'Nový úkol'}
                    aria-expanded={addOpen}
                    onClick={() => setAddOpen((v) => !v)}
                    className={`ml-5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-150 active:scale-90 ${
                      addOpen ? 'bg-well text-ink-soft' : 'bg-accent text-card shadow-float'
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className={`h-[22px] w-[22px] transition-transform duration-300 ease-spring ${addOpen ? 'rotate-45' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {addOpen ? 'Zavřít' : 'Nový úkol'} <Kbd>{addOpen ? 'Esc' : 'N'}</Kbd>
                </TooltipContent>
              </Tooltip>
            </Magnetic>
          </nav>
          </ClickSpark>
        </motion.div>
      </footer>

      {searchOpen && (
        <SearchSheet
          onClose={() => setSearchOpen(false)}
          onOpenTask={setEditing}
          onOpenClient={openClient}
          onAkce={(a) => {
            if (a === 'novy') {
              setAddOpen(true)
              dockRef.current?.querySelector('input')?.focus()
            } else if (a === 'ohlednuti') setReviewOpen(true)
            else if (a === 'sync') setSyncOpen(true)
            else setTab(a === 'dnes' ? 'today' : a === 'plan' ? 'upcoming' : 'clients')
          }}
        />
      )}
      {editing && <TaskEditSheet task={editing} onClose={() => setEditing(null)} />}
      {syncOpen && <SyncSheet onClose={() => setSyncOpen(false)} />}
      {reviewOpen && <WeeklyReviewSheet onClose={() => setReviewOpen(false)} />}
      {/* Zprávy u doku (a hlavně „Vrátit" po smazání) — jedna pro celou
          appku, ať se dvě nepřekrývají. */}
      <ToastHost />
    </div>
    </TooltipProvider>
    </MotionConfig>
  )
}
