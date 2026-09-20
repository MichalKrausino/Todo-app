import { describe, expect, it } from 'vitest'
import { jePreplneno, popisPreplneneho, prebytekDne, TOLERANCE_UKOLU } from './kapacitaDne'

// Strop 2 = „dobrý den" z měřených dat (17 dnů, medián 2, rekord 3).
const STROP = 2

describe('strop dne', () => {
  // Nejdůležitější vlastnost celé věci: appka, která toho člověka ještě
  // nezná, nehlídá nic. Náhradní číslo, které se tváří jako znalost, je
  // horší než ticho.
  it('bez stropu není přeplněné nic, ani třicet úkolů', () => {
    expect(jePreplneno(0, undefined)).toBe(false)
    expect(jePreplneno(30, undefined)).toBe(false)
    expect(prebytekDne(30, undefined)).toBe(0)
  })

  it('prázdný a poloprázdný den mlčí', () => {
    expect(jePreplneno(0, STROP)).toBe(false)
    expect(jePreplneno(1, STROP)).toBe(false)
  })

  it('den přesně na stropu ještě není přeplněný', () => {
    expect(jePreplneno(STROP, STROP)).toBe(false)
    expect(prebytekDne(STROP, STROP)).toBe(0)
  })

  it('o úkol navíc je ambiciózní den, ne přeplněný', () => {
    expect(jePreplneno(STROP + TOLERANCE_UKOLU, STROP)).toBe(false)
    expect(prebytekDne(STROP + TOLERANCE_UKOLU, STROP)).toBe(0)
  })

  it('a hned za tolerancí se ozve', () => {
    expect(jePreplneno(STROP + TOLERANCE_UKOLU + 1, STROP)).toBe(true)
    expect(prebytekDne(STROP + TOLERANCE_UKOLU + 1, STROP)).toBe(TOLERANCE_UKOLU + 1)
  })

  // Ty tři skutečné dny, kvůli kterým celá věc vznikla. Rozlišení sedí
  // přesně: ozve se na obou dnech, které spadly, a mlčí na tom třetím.
  it('skutečná data: čtvrtek se sedmi a pátek se čtyřmi ano, den se třemi ne', () => {
    expect(jePreplneno(7, STROP)).toBe(true)
    expect(jePreplneno(4, STROP)).toBe(true)
    expect(jePreplneno(3, STROP)).toBe(false)
  })

  it('přebytek je celý přesah přes strop, ne přes toleranci', () => {
    expect(prebytekDne(7, STROP)).toBe(5)
  })
})

describe('popis do toastu', () => {
  it('říká výsledek i měřítko, ne výtku', () => {
    expect(popisPreplneneho('čt 17. 9.', 7, 2)).toBe('čt 17. 9. má 7 úkolů · obvykle 2')
  })

  it('skloňuje po česku', () => {
    expect(popisPreplneneho('dnes', 1, 2)).toBe('dnes má 1 úkol · obvykle 2')
    expect(popisPreplneneho('dnes', 4, 2)).toBe('dnes má 4 úkoly · obvykle 2')
  })
})
