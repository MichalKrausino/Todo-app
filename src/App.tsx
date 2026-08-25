import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Task } from './db/types'
import { getTask } from './db/repo'
import { QuickAdd } from './components/QuickAdd'
import { SearchSheet } from './components/SearchSheet'
import { SyncButton, SyncSheet } from './components/SyncSheet'
import { TaskEditSheet } from './components/TaskEditSheet'
import { TodayView } from './views/TodayView'
import { UpcomingView } from './views/UpcomingView'
import { ClientsView } from './views/ClientsView'

type Tab = 'today' | 'upcoming' | 'clients'

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  {
    id: 'today',
    label: 'Dnes',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 12.2l2.4 2.4 4.8-5.2" />
      </svg>
    ),
  },
  {
    id: 'upcoming',
    label: 'Plán',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
        <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    id: 'clients',
    label: 'Klienti',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8.5" r="3.25" />
        <path d="M3.5 19c.6-3 2.8-4.75 5.5-4.75S13.9 16 14.5 19" />
        <circle cx="17" cy="9.5" r="2.5" />
        <path d="M15.5 14.6c2.3.2 4.1 1.7 4.7 4.4" />
      </svg>
    ),
  },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const [editing, setEditing] = useState<Task | null>(null)
  const [syncOpen, setSyncOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // Odscrollováno = horní lišta se zamlží a ukáže kompaktní titulek.
  const [scrolled, setScrolled] = useState(false)
  // Navigace z tichých signálů: otevřít konkrétního klienta na záložce Klienti.
  const [clientFocus, setClientFocus] = useState<string | null>(null)

  const openClient = (id: string) => {
    setClientFocus(id)
    setTab('clients')
  }

  // Směr přechodu záložek: nový pohled přijíždí ze strany, kam se jde.
  const prevTab = useRef<Tab>(tab)
  const dir = TABS.findIndex((t) => t.id === tab) - TABS.findIndex((t) => t.id === prevTab.current)
  const mainRef = useRef<HTMLElement>(null)
  // Spodní dok plave nad obsahem (aby přes sklo prosvítal), takže si
  // musí říct o odsazení — a jeho výška se mění (lišta, výběr termínu).
  const dockRef = useRef<HTMLElement>(null)
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
  useEffect(() => {
    prevTab.current = tab
    // nová záložka začíná nahoře, ne uprostřed předchozího seznamu
    mainRef.current?.scrollTo(0, 0)
    setScrolled(false)
  }, [tab])

  // Deep-linky z notifikací. #review a #shutdown si přebírá TodayView
  // (a hash uklidí), tady stačí přepnout na Dnes. #task-{id} otevře
  // rovnou detail konkrétního úkolu — připomínka termínu vede k němu.
  useEffect(() => {
    const check = () => {
      const hash = window.location.hash
      if (hash === '#review' || hash === '#shutdown') setTab('today')
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

  return (
    <div className="app-shell relative mx-auto flex h-dvh max-w-lg flex-col bg-paper text-ink antialiased">
      {/* Horní lišta ve stylu iOS: v klidu průhledná (velký titulek si
          svítí sám), po odscrollování se zamlží a obsah pod ni podjede —
          jinak by ikony seděly přímo na textu úkolů. Průchozí na dotyk,
          klikají jen samotná tlačítka. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-end gap-2 border-b px-4 pb-2.5 transition-colors duration-200 ${
          scrolled ? 'border-line/70 bg-paper/80 backdrop-blur-xl' : 'border-transparent'
        }`}
        style={{ paddingTop: 'calc(0.85rem + env(safe-area-inset-top))' }}
      >
        <span
          className={`pointer-events-none absolute left-4 text-[17px] font-semibold transition-opacity duration-200 ${
            scrolled ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {TABS.find((t) => t.id === tab)?.label}
        </span>
        <button
          aria-label="Hledat"
          onClick={() => setSearchOpen(true)}
          className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-card/80 text-ink-soft shadow-card backdrop-blur transition-transform duration-150 active:scale-90"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M15.8 15.8L20 20" />
          </svg>
        </button>
        <span className="pointer-events-auto">
          <SyncButton onOpen={() => setSyncOpen(true)} />
        </span>
      </div>

      <main
        ref={mainRef}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 24)}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4"
        style={{
          paddingTop: 'calc(1rem + env(safe-area-inset-top))',
          paddingBottom: 'calc(var(--dock-h, 9rem) + 0.75rem)',
        }}
      >
        {/* key vynutí novou instanci pohledu → směrová nástupní animace */}
        <div
          key={tab}
          className="view-enter"
          style={{ '--vx': dir === 0 ? '0px' : dir > 0 ? '16px' : '-16px' } as React.CSSProperties}
        >
          {tab === 'today' && (
            <TodayView
              onOpenTask={setEditing}
              onOpenClient={openClient}
              onOpenInbox={() => setTab('upcoming')}
            />
          )}
          {tab === 'upcoming' && (
            <UpcomingView onOpenTask={setEditing} onShowToday={() => setTab('today')} />
          )}
          {tab === 'clients' && (
            <ClientsView
              onOpenTask={setEditing}
              focusClientId={clientFocus}
              onFocusConsumed={() => setClientFocus(null)}
            />
          )}
        </div>
      </main>

      {/* Spodní dok: jedna plovoucí skleněná deska, přes kterou obsah
          prosvítá rozmazaný. Obal je průchozí na dotyk, klikatelná je
          jen samotná deska — u okrajů tak jde dál scrollovat obsah. */}
      <footer
        ref={dockRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
      >
        <div className="dock pointer-events-auto overflow-hidden rounded-[28px] border border-line/60">
          <QuickAdd onShowUpcoming={() => setTab('upcoming')} defaultToToday={tab === 'today'} />
          <nav className="flex px-2 pb-1.5 pt-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`flex flex-1 flex-col items-center gap-1 py-1 text-[11px] font-medium transition-colors duration-200 active:scale-95 ${
                  tab === t.id ? 'text-accent' : 'text-ink-faint'
                }`}
              >
                {/* vybraná záložka má pod ikonou měkkou pilulku;
                    nový element při vybrání → ikona poskočí (tab-bounce) */}
                <span
                  className={`rounded-2xl px-4 py-1 transition-colors duration-200 ${
                    tab === t.id ? 'bg-accent-wash' : ''
                  }`}
                >
                  <span key={tab === t.id ? 'on' : 'off'} className={tab === t.id ? 'tab-bounce block' : 'block'}>
                    {t.icon}
                  </span>
                </span>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </footer>

      {searchOpen && (
        <SearchSheet
          onClose={() => setSearchOpen(false)}
          onOpenTask={setEditing}
          onOpenClient={openClient}
        />
      )}
      {editing && <TaskEditSheet task={editing} onClose={() => setEditing(null)} />}
      {syncOpen && <SyncSheet onClose={() => setSyncOpen(false)} />}
    </div>
  )
}
