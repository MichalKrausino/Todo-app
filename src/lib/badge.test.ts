// badge.ts importuje repo (→ Dexie), proto fake indexedDB jako první.
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { badgeCount } from './badge'

const TODAY = '2026-08-02'

describe('badgeCount', () => {
  it('počítá úkoly na dnes a po termínu, budoucí a nedatované ne', () => {
    const tasks = [
      { dueDate: '2026-07-30' }, // po termínu
      { dueDate: TODAY }, // dnes
      { scheduledFor: TODAY }, // naplánováno na dnes
      { dueDate: '2026-08-05' }, // budoucnost — nepočítá se
      {}, // inbox bez data — nepočítá se
    ]
    expect(badgeCount(tasks, TODAY)).toBe(3)
  })

  it('bere dřívější z termínu a naplánování', () => {
    // termín v budoucnu, ale naplánováno na dnes → počítá se
    expect(badgeCount([{ dueDate: '2026-08-09', scheduledFor: TODAY }], TODAY)).toBe(1)
    // naplánováno do budoucna, termín prošel → počítá se
    expect(badgeCount([{ dueDate: '2026-07-28', scheduledFor: '2026-08-06' }], TODAY)).toBe(1)
  })

  it('prázdný seznam → nula (odznak se smaže)', () => {
    expect(badgeCount([], TODAY)).toBe(0)
  })
})
