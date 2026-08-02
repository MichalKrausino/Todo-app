import { useLiveQuery } from 'dexie-react-hooks'
import { allClients, allLiveTasks } from '../db/repo'
import { fromISODate, todayISO } from '../lib/dates'
import { computeWeekStats } from '../lib/weekReview'
import { Sheet } from './Sheet'

const stagger = (i: number) => ({ '--stagger': i }) as React.CSSProperties

const rangeFmt = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' })
const DAY_INITIALS = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So']

export function WeeklyReviewSheet({ onClose }: { onClose: () => void }) {
  const clients = useLiveQuery(allClients, []) ?? []
  const tasks = useLiveQuery(allLiveTasks, []) ?? []
  const stats = computeWeekStats(clients, tasks, todayISO())

  const rate =
    stats.plannedCount > 0 ? Math.round((stats.plannedDoneCount / stats.plannedCount) * 100) : null
  const maxDay = Math.max(1, ...stats.nextDays.map((d) => d.count))
  const nextTotal = stats.nextDays.reduce((sum, d) => sum + d.count, 0)

  return (
    <Sheet onClose={onClose} tone="paper" className="space-y-4">
      {(close) => (
        <>
        <header className="rise">
          <h2 className="display text-2xl font-bold">Týdenní ohlédnutí</h2>
          <p className="text-sm text-ink-soft">
            {rangeFmt.format(fromISODate(stats.weekStart))} – {rangeFmt.format(fromISODate(stats.weekEnd))}
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <div className="rise rounded-xl bg-card px-4 py-3 shadow-card" style={stagger(1)}>
            <div className="text-3xl font-bold tracking-tight">
              <span className="pop-soft inline-block">{stats.completedCount}</span>
            </div>
            <div className="mt-0.5 text-[13px] text-ink-soft">hotových úkolů</div>
          </div>
          <div className="rise rounded-xl bg-card px-4 py-3 shadow-card" style={stagger(2)}>
            <div className="text-3xl font-bold tracking-tight">
              <span className="pop-soft inline-block">{rate === null ? '—' : `${rate} %`}</span>
            </div>
            <div className="mt-0.5 text-[13px] text-ink-soft">
              plánu splněno{stats.plannedCount > 0 && ` (${stats.plannedDoneCount} z ${stats.plannedCount})`}
            </div>
          </div>
        </div>

        {stats.completedCount === 0 && (
          <p className="rise rounded-xl bg-card px-4 py-3 text-sm text-ink-soft shadow-card" style={stagger(3)}>
            Tenhle týden se nic nedokončilo. Příští týden je nový list.
          </p>
        )}

        {stats.completedByClient.length > 0 && (
          <section className="rise" style={stagger(3)}>
            <h3 className="section-label mb-2">komu šla práce</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
              {stats.completedByClient.slice(0, 5).map(({ client, count }) => (
                <li key={client?.id ?? 'none'} className="flex items-center gap-2.5 px-4 py-2.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: client?.color ?? 'var(--color-ink-faint)' }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[15px]">
                    {client?.name ?? 'Bez klienta'}
                  </span>
                  <span className="text-sm font-semibold text-ink-soft">{count}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {stats.mostPostponed.length > 0 && (
          <section className="rise" style={stagger(4)}>
            <h3 className="section-label mb-2">nejvíc odkládáš</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
              {stats.mostPostponed.map((t) => (
                <li key={t.id} className="flex items-baseline gap-2 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[15px]">{t.title}</span>
                  <span className="shrink-0 text-sm font-medium text-note-ink">{t.postponeCount}×</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 px-1 text-xs text-ink-faint">
              Úkol odkládaný pořád dokola bývá buď moc velký, nebo nedůležitý. Rozbij ho, nebo škrtni.
            </p>
          </section>
        )}

        {stats.quietClients.length > 0 && (
          <section className="rise" style={stagger(5)}>
            <h3 className="section-label mb-2">tichý týden u</h3>
            <div className="flex flex-wrap gap-2">
              {stats.quietClients.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-sm shadow-card">
                  <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                  {c.name}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="rise" style={stagger(6)}>
          <h3 className="section-label mb-2">
            příštích 7 dní · {nextTotal} {nextTotal === 1 ? 'úkol' : nextTotal < 5 ? 'úkoly' : 'úkolů'}
          </h3>
          <div className="rounded-xl bg-card px-4 pb-2.5 pt-4 shadow-card">
            <div className="flex items-end justify-between gap-2">
              {stats.nextDays.map((d, i) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[11px] font-medium tabular-nums text-ink-soft">
                    {d.count > 0 ? d.count : ''}
                  </span>
                  <div
                    className={`bar-grow w-full max-w-7 rounded-md ${d.count > 0 ? 'bg-accent' : 'bg-well'}`}
                    style={{ height: `${6 + (d.count / maxDay) * 42}px`, ...stagger(i) }}
                  />
                  <span className="text-[11px] text-ink-faint">
                    {DAY_INITIALS[fromISODate(d.date).getDay()]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <button
          onClick={close}
          className="rise w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-card transition-transform duration-150 active:scale-[0.98]"
          style={stagger(7)}
        >
          Do nového týdne
        </button>
        </>
      )}
    </Sheet>
  )
}
