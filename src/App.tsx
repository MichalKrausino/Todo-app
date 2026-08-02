import { useEffect, useState } from 'react'
import type { Task } from './db/types'
import { QuickAdd } from './components/QuickAdd'
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
  // Navigace z tichých signálů: otevřít konkrétního klienta na záložce Klienti.
  const [clientFocus, setClientFocus] = useState<string | null>(null)

  const openClient = (id: string) => {
    setClientFocus(id)
    setTab('clients')
  }

  // Deep-link z nedělní push notifikace (#review): přepnout na Dnes,
  // samotné ohlédnutí si otevře TodayView (a hash uklidí).
  useEffect(() => {
    const check = () => {
      if (window.location.hash === '#review') setTab('today')
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])

  return (
    <div className="relative mx-auto flex h-dvh max-w-lg flex-col bg-paper text-ink antialiased">
      <div
        className="absolute right-4 z-40"
        style={{ top: 'calc(0.85rem + env(safe-area-inset-top))' }}
      >
        <SyncButton onOpen={() => setSyncOpen(true)} />
      </div>

      <main
        className="flex-1 overflow-y-auto px-4 pb-6"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
      >
        {/* key vynutí novou instanci pohledu → nástupní animace při přepnutí */}
        <div key={tab} className="view-enter">
          {tab === 'today' && (
            <TodayView
              onOpenTask={setEditing}
              onOpenClient={openClient}
              onOpenInbox={() => setTab('upcoming')}
            />
          )}
          {tab === 'upcoming' && <UpcomingView onOpenTask={setEditing} />}
          {tab === 'clients' && (
            <ClientsView
              onOpenTask={setEditing}
              focusClientId={clientFocus}
              onFocusConsumed={() => setClientFocus(null)}
            />
          )}
        </div>
      </main>

      <footer
        className="border-t border-line/80 bg-card/85 backdrop-blur-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <QuickAdd />
        <nav className="flex px-2 pb-1 pt-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-1.5 text-[10px] font-medium transition-colors duration-200 active:scale-95 ${
                tab === t.id ? 'text-accent' : 'text-ink-faint'
              }`}
            >
              {/* nový element při vybrání → ikona poskočí (tab-bounce) */}
              <span key={tab === t.id ? 'on' : 'off'} className={tab === t.id ? 'tab-bounce' : ''}>
                {t.icon}
              </span>
              {t.label}
            </button>
          ))}
        </nav>
      </footer>

      {editing && <TaskEditSheet task={editing} onClose={() => setEditing(null)} />}
      {syncOpen && <SyncSheet onClose={() => setSyncOpen(false)} />}
    </div>
  )
}
