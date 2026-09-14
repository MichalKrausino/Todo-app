import { describe, expect, it } from 'vitest'
import { dnuVMesici, dnyMesice, kotvaMesice, odsazeniMesice, posunMesic } from './mesic'

describe('měsíc jako mřížka', () => {
  it('kotva je rok a měsíc', () => {
    expect(kotvaMesice('2026-09-14')).toBe('2026-09')
  })

  it('posun drží měsíce, ne dny', () => {
    expect(posunMesic('2026-09', 1)).toBe('2026-10')
    expect(posunMesic('2026-09', -1)).toBe('2026-08')
    // přes konec roku oběma směry
    expect(posunMesic('2026-12', 1)).toBe('2027-01')
    expect(posunMesic('2026-01', -1)).toBe('2025-12')
    // Leden má 31 dnů, únor ne. Kdyby se posouval zadaný den a ne první,
    // skončil by 31. leden v březnu a listování by únor přeskočilo.
    expect(posunMesic('2026-01', 1)).toBe('2026-02')
  })

  it('délka měsíce sedí včetně přestupného února', () => {
    expect(dnuVMesici('2026-09')).toBe(30)
    expect(dnuVMesici('2026-10')).toBe(31)
    expect(dnuVMesici('2026-02')).toBe(28)
    expect(dnuVMesici('2028-02')).toBe(29)
  })

  it('odsazení počítá pondělí jako nulu', () => {
    // 1. 9. 2026 je úterý → jedna prázdná buňka před ním
    expect(odsazeniMesice('2026-09')).toBe(1)
    // 1. 6. 2026 je pondělí → žádná
    expect(odsazeniMesice('2026-06')).toBe(0)
    // 1. 11. 2026 je neděle → šest
    expect(odsazeniMesice('2026-11')).toBe(6)
  })

  it('dny měsíce jdou od prvního do posledního', () => {
    const dny = dnyMesice('2026-09')
    expect(dny).toHaveLength(30)
    expect(dny[0]).toBe('2026-09-01')
    expect(dny[29]).toBe('2026-09-30')
    // dvojciferné i jednociferné dny mají stejný tvar
    expect(dny[8]).toBe('2026-09-09')
  })
})
