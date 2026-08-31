// Barva klienta je štítek v seznamu úkolů — když se opakuje, přestane
// rozlišovat. Proto se hlídá, že nový klient dostane volnou.
import { describe, expect, it } from 'vitest'
import { CLIENT_COLORS, firstFreeColor } from './labels'

describe('firstFreeColor', () => {
  it('prvnímu klientovi dá klidnou modrou, ne červenou od poplachu', () => {
    expect(firstFreeColor([])).toBe(CLIENT_COLORS[6])
  })

  it('přeskočí barvy, které už někdo má', () => {
    const prvni = firstFreeColor([])
    const druha = firstFreeColor([prvni])
    const treti = firstFreeColor([prvni, druha])
    expect(new Set([prvni, druha, treti]).size).toBe(3)
  })

  it('nevadí mu klient bez barvy', () => {
    expect(firstFreeColor([undefined])).toBe(CLIENT_COLORS[6])
  })

  it('červenou rozdá až jako poslední — plete se s propadlým termínem', () => {
    const cervena = CLIENT_COLORS[0]
    const bezCervene = CLIENT_COLORS.filter((c) => c !== cervena)
    expect(firstFreeColor(bezCervene)).toBe(cervena)
  })

  it('když jsou všechny rozebrané, jede dokola místo pádu', () => {
    const vsechny = [...CLIENT_COLORS]
    expect(CLIENT_COLORS).toContain(firstFreeColor(vsechny))
  })
})
