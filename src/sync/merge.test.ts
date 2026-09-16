import { describe, expect, it } from 'vitest'
import { applyPull, type PulledRow, type Syncable } from './merge'

const rec = (id: string, updatedAt: string, deletedAt?: string): Syncable => ({
  id,
  updatedAt,
  deletedAt,
})

const row = (data: Syncable, user_id?: string): PulledRow => ({
  id: data.id,
  data,
  updated_at: data.updatedAt.replace('Z', '+00:00'),
  user_id,
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

describe('razítko „čí je řádek"', () => {
  it('nový záznam dostane majitele ze sloupce user_id', () => {
    const remote = rec('a', '2026-07-29T10:00:00.000Z')
    expect(applyPull([undefined], [row(remote, 'u-kolega')])).toEqual([
      { ...remote, ownerId: 'u-kolega' },
    ])
  })

  it('odpověď bez sloupce razítko nepřepíše na prázdno', () => {
    const local = { ...rec('a', '2026-07-29T10:00:00.000Z'), ownerId: 'u-kolega' }
    const remote = rec('a', '2026-07-29T11:00:00.000Z')
    expect(applyPull([local], [row(remote)])).toEqual([remote])
  })

  it('chybějící razítko se doplní, i když server nenese nic nového', () => {
    const local = rec('a', '2026-07-29T12:00:00.000Z')
    const remote = rec('a', '2026-07-29T12:00:00.000Z')
    expect(applyPull([local], [row(remote, 'u-kolega')])).toEqual([
      { ...local, ownerId: 'u-kolega' },
    ])
  })

  it('doplnění razítka nepřepíše NOVĚJŠÍ lokální úpravu', () => {
    const local = { ...rec('a', '2026-07-29T12:00:00.000Z'), title: 'upraveno offline' }
    const remote = rec('a', '2026-07-29T11:00:00.000Z')
    const puts = applyPull([local as Syncable], [row(remote, 'u-ja')])
    expect(puts).toEqual([{ ...local, ownerId: 'u-ja' }])
    expect((puts[0] as typeof local).title).toBe('upraveno offline')
  })

  it('už orazítkovaný a nezměněný řádek se nezapisuje znovu', () => {
    const local = { ...rec('a', '2026-07-29T12:00:00.000Z'), ownerId: 'u-ja' }
    expect(applyPull([local], [row(rec('a', '2026-07-29T12:00:00.000Z'), 'u-ja')])).toEqual([])
  })
})
