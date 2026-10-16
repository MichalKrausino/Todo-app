import { describe, expect, it } from 'vitest'
import { osaTahu, posunHlavicky, PRAH_TAHU, titulekDne, vysledekTahu } from './tahDnu'

describe('osa tahu', () => {
  it('nerozhoduje dřív, než se prst pohne', () => {
    expect(osaTahu(3, 2)).toBeNull()
  })
  // Svislý tah přes hlavičku je rolování stránky — ten se nesmí sebrat.
  it('svislý tah je rolování, vodorovný listování', () => {
    expect(osaTahu(4, 20)).toBe('y')
    expect(osaTahu(-20, 4)).toBe('x')
  })
})

describe('výsledek tahu', () => {
  it('tah doleva = další den, doprava = den zpátky', () => {
    expect(vysledekTahu(-PRAH_TAHU, 400, 0)).toBe(1)
    expect(vysledekTahu(PRAH_TAHU, 400, 2)).toBe(-1)
  })

  it('před dnešek se nejde', () => {
    expect(vysledekTahu(200, 300, 0)).toBe(0)
  })

  it('krátký pomalý tah nic nepřepne, krátký švih ano', () => {
    expect(vysledekTahu(-30, 400, 0)).toBe(0)
    expect(vysledekTahu(-30, 40, 0)).toBe(1)
    expect(vysledekTahu(-10, 5, 0)).toBe(0)
  })
})

describe('hlavička za prstem', () => {
  it('na dnešku tah zpátky klade odpor a zastaví se', () => {
    expect(posunHlavicky(40, 0)).toBe(10)
    expect(posunHlavicky(400, 0)).toBe(32)
    expect(posunHlavicky(40, 1)).toBeCloseTo(24)
    expect(posunHlavicky(-40, 0)).toBeCloseTo(-24)
  })
})

describe('titulek', () => {
  it('Dnes, Zítra, pak jméno dne', () => {
    expect(titulekDne(0, '2026-10-16')).toBe('Dnes')
    expect(titulekDne(1, '2026-10-17')).toBe('Zítra')
    expect(titulekDne(2, '2026-10-18')).toBe('Neděle')
    expect(titulekDne(8, '2026-10-24')).toBe('Sobota')
  })
})
