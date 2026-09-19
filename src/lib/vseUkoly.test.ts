import { describe, expect, it } from 'vitest'
import type { Task } from '../db/types'
import { sortTasks } from '../db/repo'
import { denUkolu, jeNestihnuty, jePropadly, maPropadlyTermin, popisPropadlych } from './vseUkoly'

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

// čtvrtek
const DNES = '2026-09-17'

describe('denUkolu', () => {
  it('bere dřívější z naplánování a termínu', () => {
    expect(denUkolu(u('a', { dueDate: '2026-09-20', scheduledFor: '2026-09-18' }))).toBe('2026-09-18')
  })

  it('bez obou dat nevrací nic', () => {
    expect(denUkolu(u('a'))).toBeUndefined()
  })
})

describe('jePropadly', () => {
  it('den, který už byl', () => {
    expect(jePropadly(u('a', { dueDate: '2026-09-16' }), DNES)).toBe(true)
  })

  it('dnešek propadlý není', () => {
    expect(jePropadly(u('a', { dueDate: DNES }), DNES)).toBe(false)
  })

  it('úkol bez dne propadnout nemůže', () => {
    // Inbox není dluh — kdyby sem spadl, hnala by ho triáž přes žebřík dnů
    // někam, kam ho člověk nikdy neposlal.
    expect(jePropadly(u('a'), DNES)).toBe(false)
  })

  it('propadlost řídí naplánování, když je dřív než termín', () => {
    expect(jePropadly(u('a', { dueDate: '2026-09-30', scheduledFor: '2026-09-10' }), DNES)).toBe(true)
  })
})

describe('pořadí na Vše', () => {
  it('je jeden seznam podle priority, ne po dnech', () => {
    // Kritický úkol z března musí stát nad zítřejším termínem: obrazovka
    // odpovídá na „co je nejdůležitější", ne na „kdy to je".
    const ukoly = [
      u('zitra', { dueDate: '2026-09-18' }),
      u('hoří', { dueDate: '2026-03-01', priority: 'critical' }),
      u('bez data'),
    ]
    expect(sortTasks(ukoly).map((t) => t.id)[0]).toBe('hoří')
  })

  it('při shodné prioritě rozhoduje termín', () => {
    const ukoly = [u('pozdě', { dueDate: '2026-12-01' }), u('brzy', { dueDate: '2026-09-18' })]
    expect(sortTasks(ukoly).map((t) => t.id)).toEqual(['brzy', 'pozdě'])
  })
})

describe('propadlý termín vs. nestihnutý vlastní plán', () => {
  // Změřeno na skutečných datech: řádka hlásila červeně „po termínu · 8"
  // a ani jeden z těch osmi po termínu nebyl.
  it('naplánování v minulosti není propadlý termín', () => {
    const t = u('a', { scheduledFor: '2026-09-16' })
    expect(jePropadly(t, DNES)).toBe(true)
    expect(maPropadlyTermin(t, DNES)).toBe(false)
    expect(jeNestihnuty(t, DNES)).toBe(true)
  })

  it('termín, který teprve přijde, taky ne — ani když naplánování minulo', () => {
    const t = u('a', { scheduledFor: '2026-09-16', dueDate: '2026-09-18' })
    expect(jePropadly(t, DNES)).toBe(true)
    expect(maPropadlyTermin(t, DNES)).toBe(false)
    expect(jeNestihnuty(t, DNES)).toBe(true)
  })

  it('propadlý termín je propadlý termín', () => {
    const t = u('a', { dueDate: '2026-09-16' })
    expect(maPropadlyTermin(t, DNES)).toBe(true)
    expect(jeNestihnuty(t, DNES)).toBe(false)
  })

  it('bez jediného propadlého termínu se řádka nejmenuje „po termínu" a není červená', () => {
    const p = popisPropadlych([u('a', { scheduledFor: '2026-09-15' }), u('b', { scheduledFor: '2026-09-16' })], DNES)
    expect(p).toEqual({ slovo: 'nestihnuto', pocet: 2, tone: 'note' })
  })

  it('s propadlým termínem mluví řádka o něm a počítá jen jeho', () => {
    const p = popisPropadlych(
      [u('a', { dueDate: '2026-09-15' }), u('b', { scheduledFor: '2026-09-16' }), u('c', { scheduledFor: '2026-09-16' })],
      DNES,
    )
    expect(p).toEqual({ slovo: 'po termínu', pocet: 1, tone: 'danger' })
  })

  it('bez propadlých není řádka žádná', () => {
    expect(popisPropadlych([u('a', { dueDate: DNES }), u('b', { scheduledFor: '2026-09-20' })], DNES)).toBeUndefined()
  })
})
