import { describe, expect, it } from 'vitest'
import { vytvorKoalescenci } from './koalescence'

// Běh, který se dá zastavit a pustit dál — jinak by se nedalo testovat,
// co se stane PŘI běhu.
function rizenyBeh() {
  let pocet = 0
  let pusti: (() => void) | undefined
  const bezet = () => {
    pocet++
    return new Promise<void>((res) => {
      pusti = res
    })
  }
  return {
    bezet,
    pocet: () => pocet,
    dobehni: async () => {
      pusti?.()
      // dvě mikroúlohy: doběhne `finally` a případný dodatečný běh
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

describe('slučování spouštěčů synchronizace', () => {
  it('dva spouštěče v jednom okamžiku udělají jeden běh', async () => {
    const k = vytvorKoalescenci()
    const b = rizenyBeh()
    // přesně případ `online`: posluchač v enginu i v plánovači
    void k.spust(b.bezet)
    void k.spust(b.bezet)
    expect(b.pocet()).toBe(1)
    await b.dobehni()
    expect(b.pocet()).toBe(1)
  })

  it('spouštěč během běhu druhý průchod nevyrobí', async () => {
    const k = vytvorKoalescenci()
    const b = rizenyBeh()
    void k.spust(b.bezet)
    void k.spust(b.bezet)
    void k.spust(b.bezet)
    await b.dobehni()
    expect(b.pocet()).toBe(1)
  })

  it('zápis během běhu si vynutí druhý průchod', async () => {
    const k = vytvorKoalescenci()
    const b = rizenyBeh()
    void k.spust(b.bezet)
    void k.spust(b.bezet, true) // úkol založený v půlce syncu
    expect(b.pocet()).toBe(1)
    await b.dobehni()
    expect(b.pocet()).toBe(2)
  })

  it('zápis před během se veze s ním, nedělá druhý', async () => {
    const k = vytvorKoalescenci()
    const b = rizenyBeh()
    void k.spust(b.bezet, true)
    expect(b.pocet()).toBe(1)
    await b.dobehni()
    expect(b.pocet()).toBe(1)
  })

  it('dva zápisy během jednoho běhu dají jeden dodatečný, ne dva', async () => {
    const k = vytvorKoalescenci()
    const b = rizenyBeh()
    void k.spust(b.bezet)
    void k.spust(b.bezet, true)
    void k.spust(b.bezet, true)
    await b.dobehni()
    expect(b.pocet()).toBe(2)
  })

  it('po doběhnutí je další spouštěč zase plný běh', async () => {
    const k = vytvorKoalescenci()
    const b = rizenyBeh()
    void k.spust(b.bezet)
    await b.dobehni()
    expect(k.bezi()).toBe(false)
    void k.spust(b.bezet)
    expect(b.pocet()).toBe(2)
    await b.dobehni()
  })

  it('selhání běhu zámek uvolní', async () => {
    const k = vytvorKoalescenci()
    let pocet = 0
    const padajici = () => {
      pocet++
      return Promise.reject(new Error('síť'))
    }
    await expect(k.spust(padajici)).rejects.toThrow('síť')
    expect(k.bezi()).toBe(false)
    await expect(k.spust(padajici)).rejects.toThrow('síť')
    expect(pocet).toBe(2)
  })
})
