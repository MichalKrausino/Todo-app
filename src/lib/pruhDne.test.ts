import { describe, expect, it } from 'vitest'
import type { Task } from '../db/types'
import { dilyDne, ukolyVDilech } from './pruhDne'

const t = (id: string, clientId?: string, estimateMinutes?: number): Task =>
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
  it('počítá úkoly po klientech a řadí sestupně', () => {
    const dily = dilyDne([t('a', 'c2'), t('b', 'c1'), t('c', 'c1')], barva)
    expect(dily).toEqual([
      { barva: '#007AFF', pocet: 2 },
      { barva: '#FF9500', pocet: 1 },
    ])
  })

  // Tohle je celý důvod, proč se pruh přepsal z minut na kusy: odhad času
  // je hádaný, takže dva úkoly mohly kreslit delší den než čtyři podle
  // toho, jestli se v názvu trefilo klíčové slovo.
  it('odhad času s pruhem nehne', () => {
    expect(dilyDne([t('a', 'c1', 15), t('b', 'c1', 480)], barva)).toEqual(
      dilyDne([t('a', 'c1'), t('b', 'c1')], barva),
    )
  })

  it('úkoly bez klienta jsou jeden neutrální díl na konci', () => {
    const dily = dilyDne([t('a', 'c1'), t('b'), t('c')], barva)
    expect(dily).toEqual([{ barva: '#007AFF', pocet: 1 }, { pocet: 2 }])
  })

  it('neznámý klient spadne do neutrálního dílu, ne pod vlastní barvu', () => {
    expect(dilyDne([t('a', 'smazany')], barva)).toEqual([{ pocet: 1 }])
  })

  it('prázdný den nemá díly', () => {
    expect(dilyDne([], barva)).toEqual([])
  })

  it('ukolyVDilech sečte celý pruh', () => {
    expect(ukolyVDilech(dilyDne([t('a', 'c1'), t('b', 'c2'), t('c')], barva))).toBe(3)
  })
})
