import { describe, expect, it } from 'vitest'
import type { Task } from '../db/types'
import { sortTasks } from '../db/repo'
import { poradiDne } from './dnesPoradi'

const DNES = '2026-09-16'

const u = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
  title: id,
  priority: 'normal',
  status: 'active',
  order: 0,
  ...extra,
})

const idy = (r: ReturnType<typeof poradiDne>) => r.poradi.map((p) => p.task.id)

describe('pořadí seznamu na Dnes', () => {
  it('priorita řídí celý seznam, ne jen vnitřek skupin', () => {
    // Přesně ta vada, kvůli které to vzniklo: kritický dnešní úkol stál
    // pod nízkoprioritním propadlým, protože propadlé byly celý blok výš.
    const propadle = [u('propadly-nizky', { priority: 'low', dueDate: '2026-09-10' })]
    const dnesni = [u('dnesni-kriticky', { priority: 'critical', dueDate: DNES })]
    expect(idy(poradiDne(propadle, dnesni, DNES, sortTasks))).toEqual([
      'dnesni-kriticky',
      'propadly-nizky',
    ])
  })

  it('při shodné prioritě je propadlý nad dnešním', () => {
    const propadle = [u('propadly', { dueDate: '2026-09-10' })]
    const dnesni = [u('dnesni', { dueDate: DNES })]
    expect(idy(poradiDne(propadle, dnesni, DNES, sortTasks))).toEqual(['propadly', 'dnesni'])
  })

  it('připnuté drží nahoře i s nižší prioritou', () => {
    // Špendlík je ruční „tohle první" — jiná osa než priorita.
    const dnesni = [
      u('pripnuty-nizky', { priority: 'low', dueDate: DNES, pinnedFor: DNES }),
      u('nepripnuty-kriticky', { priority: 'critical', dueDate: DNES }),
    ]
    expect(idy(poradiDne([], dnesni, DNES, sortTasks))).toEqual([
      'pripnuty-nizky',
      'nepripnuty-kriticky',
    ])
  })

  it('připnutí na jiný den neplatí', () => {
    const dnesni = [
      u('pripnuty-vcera', { priority: 'low', dueDate: DNES, pinnedFor: '2026-09-15' }),
      u('kriticky', { priority: 'critical', dueDate: DNES }),
    ]
    expect(idy(poradiDne([], dnesni, DNES, sortTasks))).toEqual(['kriticky', 'pripnuty-vcera'])
  })

  it('mezi připnutými rozhoduje priorita', () => {
    const dnesni = [
      u('pin-nizky', { priority: 'low', dueDate: DNES, pinnedFor: DNES }),
      u('pin-vysoky', { priority: 'high', dueDate: DNES, pinnedFor: DNES }),
    ]
    expect(idy(poradiDne([], dnesni, DNES, sortTasks))).toEqual(['pin-vysoky', 'pin-nizky'])
  })

  it('datum na řádku nese propadlost, ne pozice', () => {
    const propadle = [
      u('propadly', { dueDate: '2026-09-10' }),
      u('propadly-pripnuty', { dueDate: '2026-09-11', pinnedFor: DNES }),
    ]
    const dnesni = [u('dnesni', { dueDate: DNES })]
    const r = poradiDne(propadle, dnesni, DNES, sortTasks)
    const datum = Object.fromEntries(r.poradi.map((p) => [p.task.id, p.showDate]))
    expect(datum).toEqual({ propadly: true, 'propadly-pripnuty': true, dnesni: false })
  })

  it('fronta triáže je bez připnutých', () => {
    const propadle = [
      u('a', { dueDate: '2026-09-10' }),
      u('b', { dueDate: '2026-09-11', pinnedFor: DNES }),
    ]
    const r = poradiDne(propadle, [], DNES, sortTasks)
    expect(r.propadleNepripnute.map((t) => t.id)).toEqual(['a'])
    // …ale ze seznamu nezmizel
    expect(idy(r)).toEqual(['b', 'a'])
  })

  it('každý úkol je v seznamu právě jednou', () => {
    const propadle = [u('p1', { dueDate: '2026-09-10', pinnedFor: DNES }), u('p2', { dueDate: '2026-09-11' })]
    const dnesni = [u('d1', { dueDate: DNES, pinnedFor: DNES }), u('d2', { dueDate: DNES })]
    const vysledek = idy(poradiDne(propadle, dnesni, DNES, sortTasks))
    expect(vysledek).toHaveLength(4)
    expect(new Set(vysledek).size).toBe(4)
  })
})
