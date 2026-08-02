import { describe, expect, it } from 'vitest'
import { findFreeSlot, freeMinutes, mergeBusy } from './freeSlot'

const b = (startMin: number, endMin: number) => ({ startMin, endMin })

describe('mergeBusy', () => {
  it('sloučí překryvy a seřadí', () => {
    expect(mergeBusy([b(600, 660), b(540, 620), b(700, 720)])).toEqual([
      b(540, 660),
      b(700, 720),
    ])
  })
})

describe('findFreeSlot', () => {
  it('prázdný den → hned ráno', () => {
    expect(findFreeSlot([], 60)).toEqual(b(540, 600))
  })

  it('najde první dostatečnou mezeru mezi schůzkami', () => {
    // 9:00–10:00 a 10:30–11:00 obsazené → 60 min se vejde až po 11:00
    const busy = [b(540, 600), b(630, 660)]
    expect(findFreeSlot(busy, 60)).toEqual(b(660, 720))
    // 30 min se vejde do mezery 10:00–10:30
    expect(findFreeSlot(busy, 30)).toEqual(b(600, 630))
  })

  it('vrací null, když se blok do pracovní doby nevejde', () => {
    expect(findFreeSlot([b(540, 1000)], 60)).toBeNull()
  })

  it('ignoruje schůzky před pracovní dobou', () => {
    expect(findFreeSlot([b(300, 400)], 60)).toEqual(b(540, 600))
  })
})

describe('freeMinutes', () => {
  it('prázdný den = celá pracovní doba', () => {
    expect(freeMinutes([])).toBe(480)
  })

  it('odečítá jen překryv s pracovní dobou', () => {
    // schůzka 8:00–10:00 ukrajuje jen hodinu z okna 9–17
    expect(freeMinutes([b(480, 600)])).toBe(420)
  })

  it('plný den = 0', () => {
    expect(freeMinutes([b(540, 1020)])).toBe(0)
  })
})
