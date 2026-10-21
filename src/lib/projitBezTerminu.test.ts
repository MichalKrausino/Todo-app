import { describe, expect, it } from 'vitest'
import type { Task } from '../db/types'
import { bezTerminuKProjiti } from './projitBezTerminu'

const DNES = '2026-10-13'
const u = (id: string, o: Partial<Task> = {}): Task => ({
  id,
  createdAt: '2026-09-26T17:11:26.863Z',
  updatedAt: '2026-09-30T14:10:50.346Z',
  title: id,
  priority: 'normal',
  status: 'active',
  order: 0,
  ...o,
})
const ids = (t: Task[]) => t.map((x) => x.id)

describe('bezTerminuKProjiti', () => {
  // Skutečný případ: 17 dní bez termínu, nikdy nikde nenabídnutý.
  it('úkol bez termínu, který nikdo neviděl, se do průchodu dostane', () => {
    expect(ids(bezTerminuKProjiti([u('disk')], DNES))).toEqual(['disk'])
  })

  it('úkol s termínem nebo naplánováním do téhle hromádky nepatří', () => {
    expect(bezTerminuKProjiti([u('a', { dueDate: '2026-10-20' }), u('b', { scheduledFor: '2026-10-01' })], DNES)).toEqual([])
  })

  // Michalova volba: všechny, i ten zapsaný před hodinou.
  it('i úkol zapsaný dnes jde do průchodu', () => {
    expect(ids(bezTerminuKProjiti([u('dnes', { createdAt: `${DNES}T08:00:00` })], DNES))).toEqual(['dnes'])
  })

  // Týden ticha byl zapomenutí: jediný úkol bez termínu se na skutečných
  // datech pět dní neukázal nikde. Dnes rozhodnuto = dnes klid, zítra zpátky.
  it('nechaný bez termínu se dnes nevrací, zítra je v průchodu zase', () => {
    const t = u('a', { prohlednuto: DNES })
    expect(bezTerminuKProjiti([t], DNES)).toEqual([])
    expect(ids(bezTerminuKProjiti([t], '2026-10-14'))).toEqual(['a'])
  })

  it('nechaný před pěti dny je v průchodu (dřív týden pokoj)', () => {
    expect(ids(bezTerminuKProjiti([u('benovi', { prohlednuto: '2026-10-08' })], DNES))).toEqual(['benovi'])
  })

  it('hotové, zahozené, smazané a dnes připnuté ne', () => {
    const t = [
      u('hotovo', { status: 'done' }),
      u('pryc', { status: 'dropped' }),
      u('smazany', { deletedAt: '2026-10-01T00:00:00Z' }),
      u('pripnuty', { pinnedFor: DNES }),
      u('inbox', { status: 'inbox' }),
    ]
    expect(ids(bezTerminuKProjiti(t, DNES))).toEqual(['inbox'])
  })

  it('nejdůležitější první, při shodě ten, kdo čeká nejdéle', () => {
    const t = [
      u('normal-novy', { createdAt: '2026-10-10T10:00:00Z' }),
      u('normal-stary', { createdAt: '2026-09-03T10:00:00Z' }),
      u('vysoka', { priority: 'high', createdAt: '2026-10-11T10:00:00Z' }),
      // prohlédnutý před měsícem čeká déle než založený před týdnem
      u('prohlednuty', { createdAt: '2026-08-01T10:00:00Z', prohlednuto: '2026-09-01' }),
    ]
    expect(ids(bezTerminuKProjiti(t, DNES))).toEqual(['vysoka', 'prohlednuty', 'normal-stary', 'normal-novy'])
  })

  it('všechny naráz — žádný denní strop', () => {
    const t = Array.from({ length: 30 }, (_, i) => u(`u${i}`))
    expect(bezTerminuKProjiti(t, DNES)).toHaveLength(30)
  })
})
