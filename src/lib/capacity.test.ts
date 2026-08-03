import { describe, expect, it } from 'vitest'
import { DEFAULT_DAY_CAPACITY_MIN, isOverloaded, plannedMinutes } from './capacity'
import type { Task } from '../db/types'

const task = (estimateMinutes?: number) => ({ estimateMinutes }) as Task

describe('plannedMinutes', () => {
  it('sčítá odhady, bez odhadu počítá 60', () => {
    expect(plannedMinutes([task(30), task(90), task()])).toBe(180)
    expect(plannedMinutes([])).toBe(0)
  })
})

describe('isOverloaded', () => {
  it('porovnává s volnem z kalendáře s tolerancí 30 min', () => {
    expect(isOverloaded(120, 180)).toBe(false)
    expect(isOverloaded(200, 180)).toBe(false) // přesah 20 min se toleruje
    expect(isOverloaded(240, 180)).toBe(true)
  })

  it('bez kalendáře srovnává s výchozí kapacitou', () => {
    expect(isOverloaded(DEFAULT_DAY_CAPACITY_MIN, null)).toBe(false)
    expect(isOverloaded(DEFAULT_DAY_CAPACITY_MIN + 31, null)).toBe(true)
  })
})
