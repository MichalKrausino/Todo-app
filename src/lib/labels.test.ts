// Barva klienta je štítek v seznamu úkolů — když se opakuje, přestane
// rozlišovat. Proto se hlídá, že nový klient dostane volnou.
import { describe, expect, it } from 'vitest'
import { CLIENT_COLORS, firstFreeColor, plural } from './labels'

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


describe('plural', () => {
  const u = (n: number) => `${n} ${plural(n, 'úkol', 'úkoly', 'úkolů')}`

  it('nula má druhý pád, ne „0 úkoly"', () => {
    expect(u(0)).toBe('0 úkolů')
  })

  it('jednotka, dvojka až čtyřka a pětka a víc', () => {
    expect(u(1)).toBe('1 úkol')
    expect(u(2)).toBe('2 úkoly')
    expect(u(4)).toBe('4 úkoly')
    expect(u(5)).toBe('5 úkolů')
    expect(u(12)).toBe('12 úkolů')
  })

  it('nepodloží se zápornou hodnotou ani desetinným číslem', () => {
    expect(u(-1)).toBe('-1 úkol')
    expect(plural(2.4, 'a', 'b', 'c')).toBe('b')
  })
})
