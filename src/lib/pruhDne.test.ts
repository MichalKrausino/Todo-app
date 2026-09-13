import { describe, expect, it } from 'vitest'
import type { Task } from '../db/types'
import { dilyDne, minutyDilu } from './pruhDne'

const t = (id: string, clientId: string | undefined, estimateMinutes: number): Task =>
  ({
    id,
    createdAt: '2025-09-01T00:00:00.000Z',
    updatedAt: '2025-09-01T00:00:00.000Z',
    title: id,
    priority: 'normal',
    status: 'active',
    order: 0,
    clientId,
    estimateMinutes,
  }) as Task

const barvy: Record<string, string> = { c1: '#007AFF', c2: '#FF9500' }
const barva = (id: string) => barvy[id]

describe('dilyDne', () => {
  it('sečte čas po klientech a seřadí sestupně', () => {
    const dily = dilyDne([t('a', 'c2', 30), t('b', 'c1', 45), t('c', 'c1', 15)], 0, barva)
    expect(dily).toEqual([
      { barva: '#007AFF', minuty: 60 },
      { barva: '#FF9500', minuty: 30 },
    ])
  })

  it('schůzky a úkoly bez klienta jsou jeden neutrální díl na konci', () => {
    const dily = dilyDne([t('a', 'c1', 30), t('b', undefined, 20)], 40, barva)
    expect(dily).toEqual([{ barva: '#007AFF', minuty: 30 }, { minuty: 60 }])
  })

  it('neznámý klient spadne do neutrálního dílu, ne pod vlastní barvu', () => {
    const dily = dilyDne([t('a', 'smazany', 25)], 0, barva)
    expect(dily).toEqual([{ minuty: 25 }])
  })

  it('neutrální díl bez minut se nepřidává', () => {
    expect(dilyDne([t('a', 'c1', 30)], 0, barva)).toEqual([{ barva: '#007AFF', minuty: 30 }])
  })

  it('prázdný den nemá žádné díly', () => {
    expect(dilyDne([], 0, barva)).toEqual([])
  })

  it('záporná délka schůzek se nepočítá', () => {
    expect(dilyDne([], -50, barva)).toEqual([])
  })

  it('minutyDilu sečte celý pruh', () => {
    expect(minutyDilu(dilyDne([t('a', 'c1', 30), t('b', 'c2', 20)], 10, barva))).toBe(60)
  })
})
