// Follow-up ze schůzky: deterministické id brání duplikátům a respektuje
// tombstone (vědomě smazaný follow-up se znovu nevyrábí).
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { addMeetingFollowUp } from './repo'
import { todayISO } from '../lib/dates'

const EVENT = { id: 'cal1:evt42', title: 'Porada s Acme' }

describe('addMeetingFollowUp', () => {
  beforeEach(async () => {
    await db.tasks.clear()
  })

  it('založí úkol na dnešek s prefixem Follow-up', async () => {
    const task = await addMeetingFollowUp(EVENT)
    expect(task).not.toBeNull()
    expect(task!.title).toBe('Follow-up: Porada s Acme')
    expect(task!.scheduledFor).toBe(todayISO())
    expect(task!.status).toBe('active')
  })

  it('druhé ťuknutí nevyrobí duplikát', async () => {
    const first = await addMeetingFollowUp(EVENT)
    const second = await addMeetingFollowUp(EVENT)
    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(await db.tasks.count()).toBe(1)
  })

  it('smazaný follow-up (tombstone) se znovu nezaloží', async () => {
    const task = await addMeetingFollowUp(EVENT)
    await db.tasks.update(task!.id, { deletedAt: new Date().toISOString() })
    expect(await addMeetingFollowUp(EVENT)).toBeNull()
  })
})
