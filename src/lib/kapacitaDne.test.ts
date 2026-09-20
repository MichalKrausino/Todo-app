import { describe, expect, it } from 'vitest'
import {
  hodiny,
  jePreplneno,
  popisPreplneneho,
  prebytekDne,
  STROP_DNE_MIN,
  TOLERANCE_MIN,
} from './kapacitaDne'
import { PLNY_DEN_MIN } from './pruhDne'

describe('strop dne', () => {
  it('je týž jako celý pruh dne — appka nemá dvě míry vytížení', () => {
    expect(STROP_DNE_MIN).toBe(PLNY_DEN_MIN)
  })

  it('prázdný a poloprázdný den mlčí', () => {
    expect(jePreplneno(0)).toBe(false)
    expect(jePreplneno(PLNY_DEN_MIN / 2)).toBe(false)
  })

  it('přesně plný den ještě není přeplněný', () => {
    expect(jePreplneno(PLNY_DEN_MIN)).toBe(false)
    expect(prebytekDne(PLNY_DEN_MIN)).toBe(0)
  })

  it('přesah do tolerance včetně se neřeší — signál, co svítí pořád, není signál', () => {
    expect(jePreplneno(PLNY_DEN_MIN + TOLERANCE_MIN)).toBe(false)
    expect(prebytekDne(PLNY_DEN_MIN + TOLERANCE_MIN)).toBe(0)
  })

  it('a hned za tolerancí se ozve', () => {
    expect(jePreplneno(PLNY_DEN_MIN + TOLERANCE_MIN + 1)).toBe(true)
    expect(prebytekDne(PLNY_DEN_MIN + TOLERANCE_MIN + 1)).toBe(TOLERANCE_MIN + 1)
  })

  it('přebytek je celý přesah přes strop, ne přes toleranci', () => {
    expect(prebytekDne(PLNY_DEN_MIN + 120)).toBe(120)
  })

  // Ten skutečný čtvrtek 17. 9.: 495 minut ÚKOLŮ, tedy 8,25 h z osmi
  // hodin pracovní doby — plný, než se započítá první schůzka. Samotné
  // úkoly se ještě vejdou do tolerance; přes strop ho přehodí schůzka
  // delší než čtvrt hodiny. Přesně tak to má být: tolerance je pro
  // obyčejný nabitý den, ne pro den, do kterého se ještě něco vejde.
  it('nabitý den se pozná teprve i se schůzkami', () => {
    expect(jePreplneno(495)).toBe(false)
    expect(jePreplneno(495 + 30)).toBe(true)
    expect(prebytekDne(495 + 30)).toBe(45)
  })
})

describe('hodiny', () => {
  it('píše desetinu hodiny s českou čárkou', () => {
    expect(hodiny(495)).toBe('8,3 h')
    expect(hodiny(90)).toBe('1,5 h')
  })

  it('celé hodiny nechává celé', () => {
    expect(hodiny(480)).toBe('8 h')
    expect(hodiny(60)).toBe('1 h')
  })

  it('nula je nula, ne prázdno', () => {
    expect(hodiny(0)).toBe('0 h')
  })
})

describe('popis do toastu', () => {
  it('říká výsledek, ne výtku', () => {
    expect(popisPreplneneho('čtvrtek 17. 9.', 495)).toBe('čtvrtek 17. 9. má 8,3 h práce')
  })
})
