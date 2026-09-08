// Toast je jediný, nahrazuje se a sám odchází — na tom stojí to, že
// mazání nemusí nic potvrzovat.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getToast, nabidniVraceni, skryjToast, ukazToast } from './toast'

describe('toast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    skryjToast()
    vi.useRealTimers()
  })

  it('ukáže text i akci', () => {
    ukazToast('Úkol smazán', [{ popisek: 'Vrátit', kdyz: () => {} }])
    expect(getToast().toast?.text).toBe('Úkol smazán')
    expect(getToast().toast?.akce[0].popisek).toBe('Vrátit')
  })

  it('druhá zpráva nahradí první — dvě u doku by se překrývaly', () => {
    ukazToast('první')
    ukazToast('druhá')
    expect(getToast().toast?.text).toBe('druhá')
  })

  it('nová zpráva má nové id, i když je text stejný', () => {
    ukazToast('stejné')
    const prvni = getToast().toast?.id
    ukazToast('stejné')
    expect(getToast().toast?.id).not.toBe(prvni)
  })

  it('sám odejde — nejdřív animace, pak zmizí', () => {
    ukazToast('zmizím')
    vi.advanceTimersByTime(5700)
    expect(getToast().odchazi).toBe(true)
    expect(getToast().toast).not.toBeNull()
    vi.advanceTimersByTime(300)
    expect(getToast().toast).toBeNull()
  })

  // Zásadní: časovač staré zprávy nesmí sundat tu novou.
  it('nová zpráva restartuje odpočet', () => {
    ukazToast('první')
    vi.advanceTimersByTime(5000)
    ukazToast('druhá')
    vi.advanceTimersByTime(1000)
    expect(getToast().toast?.text).toBe('druhá')
  })

  it('vrácení zavolá, co se mu předalo', () => {
    let vraceno = false
    nabidniVraceni('Klient smazán', () => {
      vraceno = true
    })
    getToast().toast?.akce[0].kdyz()
    expect(vraceno).toBe(true)
  })

  it('skrytí zprávu sundá hned, bez odchodové animace', () => {
    ukazToast('pryč')
    skryjToast()
    expect(getToast()).toEqual({ toast: null, odchazi: false })
  })
})
