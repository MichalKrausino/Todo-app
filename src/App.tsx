import { useState } from 'react'
import type { Task } from './db/types'
import { QuickAdd } from './components/QuickAdd'
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
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 12.2l2.4 2.4 4.8-5.2" />
      </svg>
    ),
  },
  {
    id: 'upcoming',
    label: 'Plán',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
        <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    id: 'clients',
    label: 'Klienti',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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

  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col bg-slate-50 text-slate-900 antialiased">
      <main
        className="flex-1 overflow-y-auto px-4 pb-4"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        {tab === 'today' && <TodayView onOpenTask={setEditing} />}
        {tab === 'upcoming' && <UpcomingView onOpenTask={setEditing} />}
        {tab === 'clients' && <ClientsView onOpenTask={setEditing} />}
      </main>

      <footer
        className="border-t border-slate-200 bg-white/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <QuickAdd />
        <nav className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                tab === t.id ? 'text-indigo-600' : 'text-slate-400'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </footer>

      {editing && <TaskEditSheet task={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
