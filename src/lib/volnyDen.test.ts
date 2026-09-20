import { describe, expect, it } from 'vitest'
import type { CalendarEvent, Task } from '../db/types'
import { nalozPoDnech, volnejsiDen, type Naloz } from './volnyDen'

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

const n = (ukoly: number, schuzky = 0): Naloz => ({ ukoly, schuzky })

describe('volnější den', () => {
  // 2026-09-14 je pondělí
  it('vybere nejbližší pracovní den s nejmenší zátěží, při shodě nejbližší', () => {
    const naloz = new Map([
      ['2026-09-14', n(5)],
      ['2026-09-15', n(1)],
      ['2026-09-16', n(1)],
      ['2026-09-17', n(0)],
    ])
    expect(volnejsiDen(naloz, '2026-09-14', 7)).toBe('2026-09-17')
    expect(volnejsiDen(new Map([['2026-09-14', n(1)], ['2026-09-15', n(1)]]), '2026-09-14', 7)).toBe('2026-09-16')
  })

  // Tohle je celý důvod, proč se ranking přepsal z minut na kusy. Čtyři
  // krátké úkoly vyjdou v minutách líp (4 × 30 = 120) než jeden úkol se
  // schůzkou (60 + 120 = 180), ale strop dne se počítá v ÚKOLECH —
  // takže by appka poslala úkol na den, který sama hlásí jako přeplněný.
  it('rozhoduje POČET úkolů, ne minuty', () => {
    const naloz = new Map([
      ['2026-09-14', n(4)], // v minutách by to byl ten lehčí den
      ['2026-09-15', n(1, 120)],
    ])
    // Okno přesně přes vyjmenované dny — neuvedený den je prázdný a vyhrál by.
    expect(volnejsiDen(naloz, '2026-09-14', 2)).toBe('2026-09-15')
  })

  it('při shodném počtu úkolů rozhodnou schůzky — jediné měřené číslo', () => {
    const naloz = new Map([
      ['2026-09-14', n(2, 240)],
      ['2026-09-15', n(2, 30)],
      ['2026-09-16', n(2, 60)],
    ])
    expect(volnejsiDen(naloz, '2026-09-14', 3)).toBe('2026-09-15')
  })

  it('víkend přeskočí, i kdyby byl prázdný', () => {
    const naloz = new Map([['2026-09-14', n(1)], ['2026-09-15', n(1)], ['2026-09-16', n(1)], ['2026-09-17', n(1)], ['2026-09-18', n(1)]])
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
  // Dnešek je tu PEVNÉ datum — a je to pointa testu, ne pohodlí: dokud si
  // `nalozPoDnech` brala dnešek ze systémových hodin, fungoval tenhle
  // test přesně do chvíle, než reálné datum došlo na 15. 9. 2026. Pak
  // propadlý úkol spadl na týž den jako ty datované, oba klíče splynuly
  // a test v CI po půlnoci spadl (255 místo 210), aniž by se čehokoli
  // dotkla změna, která běh spustila. S dneškem v parametru na čase
  // nezáleží.
  it('počítá úkoly a vedle nich minuty schůzek, propadlé na dnešek', () => {
    const dnes = '2026-09-14'
    const zitra = '2026-09-15'
    const tasks = [
      ukol({ dueDate: zitra, estimateMinutes: 30 }),
      ukol({ dueDate: zitra }),
      ukol({ dueDate: '2000-01-01', estimateMinutes: 45 }), // propadlé → dnes
      ukol({ status: 'done', dueDate: zitra, estimateMinutes: 999 }),
      ukol({ status: 'inbox' }), // bez data se nepočítá
    ]
    const m = nalozPoDnech(tasks, [schuzka(zitra, 2)], dnes, '2026-12-31', dnes)
    expect(m.get(zitra)).toEqual({ ukoly: 2, schuzky: 120 })
    expect(m.get(dnes)).toEqual({ ukoly: 1, schuzky: 0 })
  })

  // Pojistka proti návratu k minutám: odhad času na váze dne nesmí měnit
  // nic. Dva úkoly jsou dva úkoly, ať už jim heuristika hádá cokoli.
  it('odhad času s náloží nehne', () => {
    const dnes = '2026-09-14'
    const s = nalozPoDnech([ukol({ dueDate: dnes, estimateMinutes: 15 }), ukol({ dueDate: dnes, estimateMinutes: 480 })], [], dnes, dnes, dnes)
    const bez = nalozPoDnech([ukol({ dueDate: dnes }), ukol({ dueDate: dnes })], [], dnes, dnes, dnes)
    expect(s.get(dnes)).toEqual(bez.get(dnes))
  })

  it('celodenní a bloky „Todo" se nepočítají', () => {
    const e = { ...schuzka('2026-09-15', 3), allDay: true }
    const blok = { ...schuzka('2026-09-15', 3), isTodoBlock: true, id: 'b' }
    expect(nalozPoDnech([], [e, blok], '2026-09-01', '2026-09-30', '2026-09-01').size).toBe(0)
  })
})
