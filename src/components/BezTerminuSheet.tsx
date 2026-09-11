// Úkoly bez termínu — a odsud se plánují.
//
// V Plánu stály úplně dole pod třiceti sekcemi dní jako „bez termínu · N".
// Teď jsou panel: z chipu nahoře jen k nahlédnutí, z vybraného dne
// v kalendáři jako výběr — ťuknutí na „Sem" pošle úkol na ten den. Tak
// se plánuje: napřed den, pak co na něj.

import { useState } from 'react'
import type { Client, Task } from '../db/types'
import { updateTask } from '../db/repo'
import { formatDayLabel, formatFullDateNa, formatKdy, fromISODate } from '../lib/dates'

// „na zítra", „na dnešek", jinak „na sobotu 12. září" — 4. pád.
const naDen = (iso: string): string => {
  const l = formatDayLabel(iso)
  if (l === 'Dnes') return 'dnešek'
  if (l === 'Zítra' || l === 'Včera') return l.toLowerCase()
  return formatFullDateNa(fromISODate(iso))
}
import { plural } from '../lib/labels'
import { ukazToast } from '../lib/toast'
import { Sheet } from './Sheet'

export function BezTerminuSheet({
  ukoly,
  clients,
  cilovyDen,
  odpociva,
  onOpenTask,
  onClose,
}: {
  ukoly: Task[]
  clients: Map<string, Client>
  /** den z kalendáře — s ním má každý řádek tlačítko „Sem" */
  cilovyDen?: string
  /** úkoly, které zrovna odpočívají mimo ranní návrh → den návratu */
  odpociva?: Map<string, string>
  onOpenTask: (t: Task) => void
  onClose: () => void
}) {
  // Fronta se snímá při otevření — odeslaný úkol by jinak hned zmizel
  // ze seznamu a další by pod prstem poskočil na jeho místo.
  const [seznam] = useState(ukoly)
  const [poslane, setPoslane] = useState<Set<string>>(new Set())

  const posli = (t: Task) => {
    if (!cilovyDen) return
    void updateTask(t.id, { dueDate: cilovyDen, status: 'active' })
    setPoslane((s) => new Set(s).add(t.id))
    ukazToast(`${formatDayLabel(cilovyDen)} — „${t.title}"`, [
      {
        popisek: 'Zpět',
        kdyz: () => {
          void updateTask(t.id, { dueDate: undefined, status: 'inbox' })
          setPoslane((s) => {
            const n = new Set(s)
            n.delete(t.id)
            return n
          })
        },
      },
    ])
  }

  return (
    <Sheet onClose={onClose} className="space-y-3">
      {() => (
        <>
          <header>
            <h2 className="text-lg font-bold">
              {cilovyDen ? `Naplánovat na ${naDen(cilovyDen)}` : 'Bez termínu'}
            </h2>
            <p className="text-sm text-ink-soft">
              {seznam.length} {plural(seznam.length, 'úkol', 'úkoly', 'úkolů')} bez termínu
              {cilovyDen ? ' · ťuknutím na „Sem" dostane termín' : ''}
            </p>
          </header>

          {seznam.length === 0 ? (
            <p className="px-1 py-4 text-sm text-ink-faint">Nic bez termínu. Všechno má svůj den.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-well">
              {seznam.map((t) => {
                const client = t.clientId ? clients.get(t.clientId) : undefined
                const hotovo = poslane.has(t.id)
                const navrat = odpociva?.get(t.id)
                return (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => onOpenTask(t)}
                      className={`min-w-0 flex-1 text-left ${hotovo ? 'text-ink-faint' : ''}`}
                    >
                      <span className="block truncate text-[15px]">{t.title}</span>
                      {(client || navrat) && (
                        <span className="flex items-center gap-2 text-[13px] text-ink-soft">
                          {client && (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ background: client.color }} />
                              {client.name}
                            </span>
                          )}
                          {/* odpočívá mimo ranní návrh — a je vidět, kdy se vrátí */}
                          {navrat && <span className="text-ink-faint">odpočívá · vrátí se {formatKdy(navrat)}</span>}
                        </span>
                      )}
                    </button>
                    {cilovyDen &&
                      (hotovo ? (
                        <span className="shrink-0 text-[13px] font-medium text-moss">
                          {formatDayLabel(cilovyDen)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => posli(t)}
                          className="shrink-0 rounded-full bg-accent-wash px-3 py-1.5 text-[13px] font-medium text-accent-deep transition-transform duration-150 active:scale-95"
                        >
                          Sem
                        </button>
                      ))}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </Sheet>
  )
}
