import { describe, expect, it } from 'vitest'
import { applyPull, maxUpdatedAt, pendingPush, type PulledRow, type Syncable } from './merge'

const rec = (id: string, updatedAt: string, deletedAt?: string): Syncable => ({
  id,
  updatedAt,
  deletedAt,
})

const row = (data: Syncable): PulledRow => ({
  id: data.id,
  data,
  updated_at: data.updatedAt.replace('Z', '+00:00'),
})

describe('applyPull (last-write-wins)', () => {
  it('nový záznam se zapíše', () => {
    const remote = rec('a', '2026-07-29T10:00:00.000Z')
    expect(applyPull([undefined], [row(remote)])).toEqual([remote])
  })

  it('novější vzdálený přepíše starší lokální', () => {
    const local = rec('a', '2026-07-29T10:00:00.000Z')
    const remote = rec('a', '2026-07-29T11:00:00.000Z')
    expect(applyPull([local], [row(remote)])).toEqual([remote])
  })

  it('starší vzdálený lokální nepřepíše', () => {
    const local = rec('a', '2026-07-29T12:00:00.000Z')
    const remote = rec('a', '2026-07-29T11:00:00.000Z')
    expect(applyPull([local], [row(remote)])).toEqual([])
  })

  it('shodný čas znamená žádný zápis (echo vlastního pushe)', () => {
    const local = rec('a', '2026-07-29T12:00:00.000Z')
    expect(applyPull([local], [row(rec('a', '2026-07-29T12:00:00.000Z'))])).toEqual([])
  })

  it('tombstone se přenese jako obyčejný záznam', () => {
    const local = rec('a', '2026-07-29T10:00:00.000Z')
    const remote = rec('a', '2026-07-29T11:00:00.000Z', '2026-07-29T11:00:00.000Z')
    expect(applyPull([local], [row(remote)])).toEqual([remote])
  })
})

describe('pendingPush', () => {
  const a = rec('a', '2026-07-29T10:00:00.000Z')
  const b = rec('b', '2026-07-29T11:00:00.000Z')
  const c = rec('c', '2026-07-29T12:00:00.000Z')

  it('bez kurzoru posílá vše, seřazené vzestupně', () => {
    expect(pendingPush([c, a, b], '')).toEqual([a, b, c])
  })

  it('posílá jen záznamy za kurzorem', () => {
    expect(pendingPush([a, b, c], '2026-07-29T10:30:00.000Z')).toEqual([b, c])
  })

  it('záznam přesně na kurzoru se znovu neposílá', () => {
    expect(pendingPush([a, b], a.updatedAt)).toEqual([b])
  })
})

describe('maxUpdatedAt', () => {
  it('vrací nejnovější čas, jinak fallback', () => {
    const a = rec('a', '2026-07-29T10:00:00.000Z')
    const b = rec('b', '2026-07-29T12:00:00.000Z')
    expect(maxUpdatedAt([a, b], '')).toBe(b.updatedAt)
    expect(maxUpdatedAt([], 'x')).toBe('x')
  })
})
