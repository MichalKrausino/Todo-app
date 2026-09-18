import { describe, expect, it } from 'vitest'
import { jeSiroko, SIROKY_PRAH } from './siroko'

describe('jeSiroko', () => {
  it('práh je nejmenší šířka pro tři sloupce', () => {
    expect(SIROKY_PRAH).toBe(1024)
  })

  it('MacBook i iPad na šířku jsou široké', () => {
    expect(jeSiroko(1440)).toBe(true) // MacBook Air 13"
    expect(jeSiroko(1024)).toBe(true) // iPad na šířku, přesně na prahu
  })

  it('telefon a úzké okno široké nejsou', () => {
    expect(jeSiroko(1023)).toBe(false)
    expect(jeSiroko(390)).toBe(false) // iPhone
    expect(jeSiroko(320)).toBe(false) // iPhone SE
  })

  it('rozhoduje šířka okna, ne zařízení', () => {
    // Mac s appkou zmáčknutou do čtvrtiny obrazovky je telefon: tři
    // sloupce by se do 600 px nevešly čitelně.
    expect(jeSiroko(600)).toBe(false)
  })
})
