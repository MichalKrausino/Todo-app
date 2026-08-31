// Barva klienta je štítek v seznamu úkolů — když se opakuje, přestane
// rozlišovat. Proto se hlídá, že nový klient dostane volnou.
import { describe, expect, it } from 'vitest'
import { CLIENT_COLORS, firstFreeColor } from './labels'

describe('firstFreeColor', () => {
  it('prvnímu klientovi dá první barvu z palety', () => {
    expect(firstFreeColor([])).toBe(CLIENT_COLORS[0])
  })

  it('přeskočí barvy, které už někdo má', () => {
    expect(firstFreeColor([CLIENT_COLORS[0], CLIENT_COLORS[1]])).toBe(CLIENT_COLORS[2])
  })

  it('nevadí mu klient bez barvy', () => {
    expect(firstFreeColor([undefined, CLIENT_COLORS[0]])).toBe(CLIENT_COLORS[1])
  })

  it('když jsou všechny rozebrané, jede dokola místo pádu', () => {
    const vsechny = [...CLIENT_COLORS]
    expect(CLIENT_COLORS).toContain(firstFreeColor(vsechny))
  })
})
