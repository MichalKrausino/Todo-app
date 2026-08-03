import { describe, expect, it } from 'vitest'
import type { Client, Task } from '../db/types'
import { computeWeekStats, reviewWeekStart } from './weekReview'

// Neděle 2. 8. 2026; týden Po 27. 7. — Ne 2. 8.
const SUNDAY = '2026-08-02'
const MONDAY = '2026-08-03'

const client = (over: Partial<Client> = {}): Client => ({
  id: over.id ?? 'c1',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
  name: 'Klient X',
  color: '#123',
  kind: 'client',
  status: 'active',
  templateIds: [],
  ...over,
})

const task = (over: Partial<Task> = {}): Task => ({
  id: over.id ?? crypto.randomUUID(),
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
  title: 'Úkol',
  priority: 'normal',
  status: 'active',
  order: 0,
  ...over,
})

describe('reviewWeekStart', () => {
  it('v týdnu se ohlíží za běžícím týdnem, v pondělí za minulým', () => {
    expect(reviewWeekStart(SUNDAY)).toBe('2026-07-27')
    expect(reviewWeekStart('2026-07-29')).toBe('2026-07-27')
    expect(reviewWeekStart(MONDAY)).toBe('2026-07-27') // pondělí → minulý týden
  })
})

describe('computeWeekStats', () => {
  it('počítá dokončené v týdnu a rozpad podle klientů', () => {
    const c = client()
    const tasks = [
      task({ status: 'done', completedAt: '2026-07-28T09:00:00.000Z', clientId: 'c1' }),
      task({ status: 'done', completedAt: '2026-08-01T09:00:00.000Z', clientId: 'c1' }),
      task({ status: 'done', completedAt: '2026-08-01T10:00:00.000Z' }), // bez klienta
      task({ status: 'done', completedAt: '2026-07-20T09:00:00.000Z' }), // mimo týden
    ]
    const s = computeWeekStats([c], tasks, SUNDAY)
    expect(s.completedCount).toBe(3)
    expect(s.completedByClient[0]).toEqual({ client: c, count: 2, projects: [] })
    expect(s.completedByClient[1].client).toBeUndefined()
  })

  it('rozepíše dokončené i podle projektů klienta', () => {
    const c = client({ id: 'c1' })
    const projects = [
      { id: 'p1', clientId: 'c1', name: 'Web', status: 'active' as const, order: 0, createdAt: '2026-07-01T10:00:00.000Z', updatedAt: '2026-07-01T10:00:00.000Z' },
      { id: 'p2', clientId: 'c1', name: 'Kampaň', status: 'active' as const, order: 1, createdAt: '2026-07-01T10:00:00.000Z', updatedAt: '2026-07-01T10:00:00.000Z' },
    ]
    const tasks = [
      task({ status: 'done', completedAt: '2026-07-30T09:00:00.000Z', clientId: 'c1', projectId: 'p1' }),
      task({ status: 'done', completedAt: '2026-07-30T10:00:00.000Z', clientId: 'c1', projectId: 'p1' }),
      task({ status: 'done', completedAt: '2026-07-31T09:00:00.000Z', clientId: 'c1', projectId: 'p2' }),
      task({ status: 'done', completedAt: '2026-07-31T10:00:00.000Z', clientId: 'c1' }), // bez projektu
    ]
    const s = computeWeekStats([c], tasks, SUNDAY, projects)
    expect(s.completedByClient[0].count).toBe(4)
    expect(s.completedByClient[0].projects).toEqual([
      { name: 'Web', count: 2 },
      { name: 'Kampaň', count: 1 },
    ])
  })

  it('plán vs. realita počítá jen úkoly s dnem v týdnu', () => {
    const tasks = [
      task({ status: 'done', dueDate: '2026-07-29', completedAt: '2026-07-29T12:00:00.000Z' }),
      task({ status: 'active', dueDate: '2026-07-30' }), // nesplněné
      task({ status: 'active', dueDate: '2026-08-15' }), // příští týdny — nepočítá se
    ]
    const s = computeWeekStats([], tasks, SUNDAY)
    expect(s.plannedCount).toBe(2)
    expect(s.plannedDoneCount).toBe(1)
  })

  it('vybírá nejodkládanější otevřené úkoly', () => {
    const tasks = [
      task({ id: 'a', postponeCount: 5, dueDate: '2026-08-10' }),
      task({ id: 'b', postponeCount: 2, dueDate: '2026-08-10' }),
      task({ id: 'c', postponeCount: 1, dueDate: '2026-08-10' }), // pod prahem
      task({ id: 'd', postponeCount: 9, status: 'done', completedAt: '2026-08-01T09:00:00.000Z' }),
    ]
    const s = computeWeekStats([], tasks, SUNDAY)
    expect(s.mostPostponed.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('tichý klient = aktivní klient bez dokončeného úkolu v týdnu', () => {
    const busy = client({ id: 'c1' })
    const quiet = client({ id: 'c2', name: 'Tichý' })
    const fresh = client({ id: 'c3', createdAt: '2026-07-30T10:00:00.000Z' }) // nový — nehodnotí se
    const area = client({ id: 'c4', kind: 'personal' })
    const tasks = [task({ status: 'done', completedAt: '2026-07-28T09:00:00.000Z', clientId: 'c1' })]
    const s = computeWeekStats([busy, quiet, fresh, area], tasks, SUNDAY)
    expect(s.quietClients.map((c) => c.id)).toEqual(['c2'])
  })

  it('výhled na dalších 7 dní počítá otevřené úkoly po dnech', () => {
    const tasks = [
      task({ dueDate: '2026-08-03' }),
      task({ dueDate: '2026-08-03' }),
      task({ scheduledFor: '2026-08-05' }),
      task({ dueDate: '2026-08-20' }), // mimo okno
    ]
    const s = computeWeekStats([], tasks, SUNDAY)
    expect(s.nextDays).toHaveLength(7)
    expect(s.nextDays[0]).toEqual({ date: '2026-08-03', count: 2 })
    expect(s.nextDays[2]).toEqual({ date: '2026-08-05', count: 1 })
  })
})
