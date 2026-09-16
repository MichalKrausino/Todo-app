import { describe, expect, it } from 'vitest'
import { cilOdkazu, maPoslat, platnyCas, VYCHOZI_CAS } from './kdy'

const DNES = '2026-09-17'

describe('platný čas', () => {
  it('doplní nulu zepředu', () => {
    expect(platnyCas('7:00')).toBe('07:00')
  })

  it('nechá, co je v pořádku', () => {
    expect(platnyCas('06:30')).toBe('06:30')
  })

  it('nesmysl i prázdno padá na výchozí čas, ne na „nikdy"', () => {
    expect(platnyCas(undefined)).toBe(VYCHOZI_CAS)
    expect(platnyCas('')).toBe(VYCHOZI_CAS)
    expect(platnyCas('ráno')).toBe(VYCHOZI_CAS)
    expect(platnyCas('25:00')).toBe(VYCHOZI_CAS)
    expect(platnyCas('07:70')).toBe(VYCHOZI_CAS)
  })
})

describe('má návrh odejít', () => {
  it('bez nastavení platí výchozí sedmá hodina', () => {
    expect(maPoslat(undefined, '06:30', DNES)).toBe(false)
    expect(maPoslat(undefined, '07:00', DNES)).toBe(true)
  })

  it('před nastaveným časem se nečeká na nic jiného', () => {
    expect(maPoslat({ morning_time: '09:00' }, '08:30', DNES)).toBe(false)
  })

  it('v nastavený čas odejde', () => {
    expect(maPoslat({ morning_time: '09:00' }, '09:00', DNES)).toBe(true)
  })

  it('po nastaveném čase taky — zameškané ráno se dožene, ne propadne', () => {
    expect(maPoslat({ morning_time: '06:00' }, '10:30', DNES)).toBe(true)
  })

  it('jednou za den: co dnes odešlo, podruhé nejde', () => {
    expect(maPoslat({ morning_time: '07:00', last_morning_on: DNES }, '09:00', DNES)).toBe(false)
  })

  it('včerejší odeslání dnešek neblokuje', () => {
    expect(maPoslat({ morning_time: '07:00', last_morning_on: '2026-09-16' }, '07:00', DNES)).toBe(
      true,
    )
  })

  it('razítko s časem se porovnává jen po den', () => {
    expect(
      maPoslat({ morning_time: '07:00', last_morning_on: `${DNES}T05:00:00Z` }, '09:00', DNES),
    ).toBe(false)
  })

  it('vypnuté neodejde, ani kdyby byl čas', () => {
    expect(maPoslat({ morning_enabled: false, morning_time: '07:00' }, '12:00', DNES)).toBe(false)
  })

  it('chybějící přepínač je zapnuto — nastavení nikdo mít nemusí', () => {
    expect(maPoslat({ morning_time: '07:00' }, '07:00', DNES)).toBe(true)
    expect(maPoslat({ morning_enabled: null, morning_time: '07:00' }, '07:00', DNES)).toBe(true)
  })

  it('nesmyslný čas návrh neumlčí', () => {
    expect(maPoslat({ morning_time: 'kdykoli' }, '07:00', DNES)).toBe(true)
  })
})

describe('kam notifikace vede', () => {
  const BASE = 'https://example.test/app/'

  it('výchozí je rovnou panel s návrhy', () => {
    expect(cilOdkazu(BASE, undefined)).toBe(`${BASE}#navrh`)
  })

  it('volba „dnes" otevře jen appku', () => {
    expect(cilOdkazu(BASE, 'dnes')).toBe(BASE)
  })

  it('neznámá volba se chová jako výchozí', () => {
    expect(cilOdkazu(BASE, 'cosi')).toBe(`${BASE}#navrh`)
  })
})
