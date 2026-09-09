// Projekt — panel místo formuláře rozloženého v hlavičce sekce.
//
// Projekt šel dřív upravit ťuknutím na hlavičku své sekce, a vedle ní
// stálo napořád „Uzavřít · Smazat" — dvě nevratně znějící akce u každé
// skupiny úkolů, na obrazovce, kam se chodí pracovat. Teď je hlavička
// jen řádka v seznamu a všechno o projektu bydlí tady.
//
// Uzavření i smazání jde vrátit (tombstone + toast), tak se neptá.

import { useState } from 'react'
import type { Project } from '../db/types'
import { removeProject, restoreDeleted, updateProject } from '../db/repo'
import { formatDayLabel, todayISO } from '../lib/dates'
import { nabidniVraceni } from '../lib/toast'
import { Sheet } from './Sheet'
import { Button } from './ui/Button'

const pole =
  'w-full rounded-full bg-card px-4 py-2.5 text-[16px] text-ink shadow-card outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent/60'

export function ProjektSheet({
  project,
  hotovo,
  celkem,
  onClose,
}: {
  project: Project
  hotovo: number
  celkem: number
  onClose: () => void
}) {
  const [name, setName] = useState(project.name)
  const [goal, setGoal] = useState(project.goal ?? '')
  const [due, setDue] = useState(project.dueDate ?? '')
  const late = Boolean(project.dueDate && project.dueDate < todayISO() && hotovo < celkem)

  const save = (close: () => void) => {
    const n = name.trim()
    if (!n) return
    void updateProject(project.id, { name: n, goal: goal.trim() || undefined, dueDate: due || undefined })
    close()
  }

  // hotová věc nemá zabírat místo — uzavřený projekt zmizí z detailu,
  // jeho úkoly spadnou mezi obecné úkoly klienta
  const uzavrit = (close: () => void) => {
    void updateProject(project.id, { status: 'archived' })
    close()
    nabidniVraceni(`Projekt „${project.name}" uzavřen`, () => updateProject(project.id, { status: 'active' }))
  }

  const smazat = async (close: () => void) => {
    const plan = await removeProject(project.id)
    close()
    nabidniVraceni(`Projekt „${project.name}" smazán`, () => restoreDeleted(plan))
  }

  return (
    <Sheet onClose={onClose} tone="paper" className="space-y-4">
      {(close) => (
        <>
          <header>
            <h2 className="text-lg font-bold">Projekt</h2>
            <p className="text-sm text-ink-soft">
              {celkem > 0 ? `${hotovo} z ${celkem} hotovo` : 'Zatím bez úkolů'}
              {project.dueDate && (
                <span className={late ? ' font-medium text-danger' : ''}>
                  {' · '}do {formatDayLabel(project.dueDate)}
                </span>
              )}
            </p>
          </header>

          <div className="space-y-2">
            <input
              autoFocus
              aria-label="Název projektu"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save(close)
              }}
              className={`${pole} font-medium`}
            />
            <input
              aria-label="Cíl projektu"
              placeholder="Cíl — čeho chceš dosáhnout"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save(close)
              }}
              className={pole}
            />
            <label className="flex items-center gap-3 rounded-full bg-card px-4 py-1.5 shadow-card">
              <span className="shrink-0 text-[13px] font-medium text-ink-soft">Termín</span>
              <input
                type="date"
                aria-label="Termín projektu"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="min-w-0 flex-1 bg-transparent py-1 text-[16px] text-ink outline-none"
              />
              {due && (
                <button
                  type="button"
                  aria-label="Vymazat termín"
                  onClick={() => setDue('')}
                  className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft transition-transform duration-150 active:scale-90"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
            </label>
          </div>

          {celkem > 0 && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-card">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 ease-glide"
                style={{ width: `${Math.round((hotovo / celkem) * 100)}%` }}
              />
            </div>
          )}

          <footer className="flex items-center gap-2 pt-1">
            <Button variant="secondary" onClick={() => uzavrit(close)}>
              Uzavřít
            </Button>
            <Button variant="destructive" onClick={() => void smazat(close)}>
              Smazat
            </Button>
            <span className="flex-1" />
            <Button disabled={!name.trim()} onClick={() => save(close)}>
              Uložit
            </Button>
          </footer>
        </>
      )}
    </Sheet>
  )
}
