import { describe, expect, it } from 'vitest'
import type { Subtask } from '../db/types'
import {
  dalsiTerminKroku,
  jeKrokPropadly,
  krokyProDalsiVyskyt,
  krokySTerminem,
  maPropadlyKrok,
} from './podukoly'

const krok = (id: string, extra: Partial<Subtask> = {}): Subtask => ({
  id,
  title: id,
  done: false,
  ...extra,
})

const DNES = '2026-09-21'

describe('krokySTerminem', () => {
  it('bere jen nehotové kroky s termínem a řadí je od nejbližšího', () => {
    const kroky = [
      krok('c', { dueDate: '2026-09-25' }),
      krok('a', { dueDate: '2026-09-22' }),
      krok('bez data'),
      krok('hotový', { dueDate: '2026-09-01', done: true }),
    ]
    expect(krokySTerminem(kroky).map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('bez checklistu je prázdno', () => {
    expect(krokySTerminem(undefined)).toEqual([])
    expect(dalsiTerminKroku(undefined)).toBeUndefined()
  })

  it('další termín je ten nejbližší, ne první v pořadí', () => {
    expect(dalsiTerminKroku([krok('a', { dueDate: '2026-10-01' }), krok('b', { dueDate: '2026-09-22' })])).toBe(
      '2026-09-22',
    )
  })

  // Hotový krok s propadlým datem nesmí držet řádek úkolu červený —
  // udělaná práce se nepřipomíná.
  it('hotový krok se do termínů nepočítá, ani když propadl', () => {
    expect(dalsiTerminKroku([krok('a', { dueDate: '2000-01-01', done: true })])).toBeUndefined()
    expect(maPropadlyKrok([krok('a', { dueDate: '2000-01-01', done: true })], DNES)).toBe(false)
  })
})

describe('propadlý krok', () => {
  it('propadlý je včerejšek, ne dnešek', () => {
    expect(jeKrokPropadly(krok('a', { dueDate: '2026-09-20' }), DNES)).toBe(true)
    expect(jeKrokPropadly(krok('a', { dueDate: DNES }), DNES)).toBe(false)
    expect(jeKrokPropadly(krok('a', { dueDate: '2026-09-22' }), DNES)).toBe(false)
  })

  it('krok bez termínu propadnout nemůže', () => {
    expect(jeKrokPropadly(krok('a'), DNES)).toBe(false)
    expect(maPropadlyKrok([krok('a'), krok('b')], DNES)).toBe(false)
  })

  it('stačí jediný propadlý krok', () => {
    expect(maPropadlyKrok([krok('a', { dueDate: '2026-12-31' }), krok('b', { dueDate: '2026-09-01' })], DNES)).toBe(
      true,
    )
  })
})

describe('kroky pro další výskyt', () => {
  it('nuluje odškrtnutí a ZAHAZUJE termíny', () => {
    expect(krokyProDalsiVyskyt([krok('a', { done: true, dueDate: '2026-09-05' }), krok('b')])).toEqual([
      { id: 'a', title: 'a', done: false },
      { id: 'b', title: 'b', done: false },
    ])
  })

  // Ponechaný termín by z nového výskytu udělal hromadu propadlých kroků
  // hned při založení — červená, kterou nikdo nezpůsobil.
  it('nový výskyt nemá jediný propadlý krok', () => {
    const dalsi = krokyProDalsiVyskyt([krok('a', { dueDate: '2026-09-05' })])
    expect(maPropadlyKrok(dalsi, DNES)).toBe(false)
  })

  it('bez checklistu se nic nevyrábí', () => {
    expect(krokyProDalsiVyskyt(undefined)).toBeUndefined()
  })
})
