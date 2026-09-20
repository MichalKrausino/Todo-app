import { describe, expect, it } from 'vitest'
import { plannedMinutes } from './capacity'
import type { Task } from '../db/types'

const task = (estimateMinutes?: number) => ({ estimateMinutes }) as Task

describe('plannedMinutes', () => {
  it('sčítá odhady, bez odhadu počítá 60', () => {
    expect(plannedMinutes([task(30), task(90), task()])).toBe(180)
    expect(plannedMinutes([])).toBe(0)
  })
})
