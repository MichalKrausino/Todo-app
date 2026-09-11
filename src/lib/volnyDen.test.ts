import { describe, expect, it } from 'vitest'
import type { CalendarEvent, Task } from '../db/types'
import { minutyPoDnech, volnejsiDen } from './volnyDen'
import { todayISO } from './dates'

const ukol = (extra: Partial<Task>): Task =>
  ({ id: Math.random().toString(36).slice(2), title: 'x', status: 'active', priority: 'normal', order: 0, createdAt: '', updatedAt: '', ...extra }) as Task

const schuzka = (den: string, hodin: number): CalendarEvent => ({
  id: `e${den}`,
  calendarId: 'c',
  eventId: den,
  title: 's',
  start: `${den}T09:00:00.000Z`,
  end: `${den}T${String(9 + hodin).padStart(2, '0')}:00:00.000Z`,
  startDay: den,
  endDay: den,
  allDay: false,
  isTodoBlock: false,
  fetchedAt: '',
})

describe('volnější den', () => {
  // 2026-09-14 je pondělí
  it('vybere nejbližší pracovní den s nejmenší zátěží, při shodě nejbližší', () => {
    const naloz = new Map([
      ['2026-09-14', 300],
      ['2026-09-15', 60],
      ['2026-09-16', 60],
      ['2026-09-17', 0],
    ])
    expect(volnejsiDen(naloz, '2026-09-14', 7)).toBe('2026-09-17')
    expect(volnejsiDen(new Map([['2026-09-14', 60], ['2026-09-15', 60]]), '2026-09-14', 7)).toBe('2026-09-16')
  })

  it('víkend přeskočí, i kdyby byl prázdný', () => {
    const naloz = new Map([['2026-09-14', 30], ['2026-09-15', 30], ['2026-09-16', 30], ['2026-09-17', 30], ['2026-09-18', 30]])
    // 19. a 20. je sobota a neděle — nejbližší pracovní s nejmenší zátěží je pondělí 14.
    expect(volnejsiDen(naloz, '2026-09-14', 7)).toBe('2026-09-14')
    // okno začínající v sobotu
    expect(volnejsiDen(new Map(), '2026-09-19', 7)).toBe('2026-09-21')
  })

  it('okno bez pracovního dne = první pracovní den za ním', () => {
    expect(volnejsiDen(new Map(), '2026-09-19', 2)).toBe('2026-09-21')
  })
})

describe('zátěž po dnech', () => {
  it('sčítá odhad úkolů a délku schůzek, propadlé počítá na dnešek', () => {
    const dnes = todayISO()
    const tasks = [
      ukol({ dueDate: '2026-09-15', estimateMinutes: 30 }),
      ukol({ dueDate: '2026-09-15' }), // výchozí 60
      ukol({ dueDate: '2000-01-01', estimateMinutes: 45 }), // propadlé → dnes
      ukol({ status: 'done', dueDate: '2026-09-15', estimateMinutes: 999 }),
      ukol({ status: 'inbox' }), // bez data se nepočítá
    ]
    const m = minutyPoDnech(tasks, [schuzka('2026-09-15', 2)], dnes, '2026-12-31')
    expect(m.get('2026-09-15')).toBe(30 + 60 + 120)
    expect(m.get(dnes)).toBe(45)
  })

  it('celodenní a bloky „Todo" se nepočítají', () => {
    const e = { ...schuzka('2026-09-15', 3), allDay: true }
    const blok = { ...schuzka('2026-09-15', 3), isTodoBlock: true, id: 'b' }
    expect(minutyPoDnech([], [e, blok], '2026-09-01', '2026-09-30').size).toBe(0)
  })
})
