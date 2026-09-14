// Dvojité ťuknutí na už vybranou záložku. Test existuje přesně z důvodu,
// který si soubor sám napsal do hlavičky: totéž pravidlo platí pro prst
// (pointerup v doku) i pro klávesnici (dvakrát „1" na Macu), a bez testu
// by se ty dvě cesty rozešly.

import { describe, expect, it } from 'vitest'
import { DVOJKLIK_MS, vyhodnotStisk, type Stisk } from './dvojklik'

describe('dvojité ťuknutí', () => {
  it('okno je práh dvojitého ťuknutí v iOS', () => {
    expect(DVOJKLIK_MS).toBe(320)
  })

  it('první stisk nikdy není dvojitý a jen si zapamatuje, kde a kdy', () => {
    expect(vyhodnotStisk(null, 'dnes', 1000)).toEqual({
      stav: { id: 'dnes', kdy: 1000 },
      dvojite: false,
    })
  })

  it('druhý stisk téže záložky v okně je dvojitý', () => {
    const prev: Stisk = { id: 'dnes', kdy: 1000 }
    expect(vyhodnotStisk(prev, 'dnes', 1100).dvojite).toBe(true)
  })

  it('hranice okna ještě platí, o milisekundu dál už ne', () => {
    const prev: Stisk = { id: 'dnes', kdy: 1000 }
    expect(vyhodnotStisk(prev, 'dnes', 1000 + DVOJKLIK_MS).dvojite).toBe(true)
    expect(vyhodnotStisk(prev, 'dnes', 1000 + DVOJKLIK_MS + 1).dvojite).toBe(false)
  })

  it('pomalé dvojí ťuknutí jen posune počítadlo, nic neotevře', () => {
    const prev: Stisk = { id: 'dnes', kdy: 1000 }
    expect(vyhodnotStisk(prev, 'dnes', 2000)).toEqual({
      stav: { id: 'dnes', kdy: 2000 },
      dvojite: false,
    })
  })

  it('jiná záložka mezitím dvojité ťuknutí zruší', () => {
    // Rychlé Klienti → Dnes → Dnes nesmí otevřít nic, co nikdo nechtěl.
    let stav: Stisk | null = null
    for (const id of ['klienti', 'dnes']) {
      const r = vyhodnotStisk(stav, id, 1000)
      expect(r.dvojite).toBe(false)
      stav = r.stav
    }
    // Teprve druhé ťuknutí na Dnes je dvojité.
    expect(vyhodnotStisk(stav, 'dnes', 1100).dvojite).toBe(true)
  })

  it('trojité ťuknutí není dvojité dvakrát', () => {
    let stav: Stisk | null = null
    const kdy = [1000, 1100, 1200]
    const vysledky = kdy.map((t) => {
      const r = vyhodnotStisk(stav, 'dnes', t)
      stav = r.stav
      return r.dvojite
    })
    expect(vysledky).toEqual([false, true, false])
  })

  it('čas, který jde zpátky, dvojité ťuknutí nevyrobí', () => {
    // Date.now() umí couvnout (srovnání hodin), a záporný rozdíl by
    // podmínkou `<= okno` prošel.
    const prev: Stisk = { id: 'dnes', kdy: 5000 }
    const r = vyhodnotStisk(prev, 'dnes', 4900)
    expect(r.dvojite).toBe(false)
    expect(r.stav).toEqual({ id: 'dnes', kdy: 4900 })
  })

  it('okno jde přebít parametrem', () => {
    const prev: Stisk = { id: 'dnes', kdy: 1000 }
    expect(vyhodnotStisk(prev, 'dnes', 1400, 500).dvojite).toBe(true)
    expect(vyhodnotStisk(prev, 'dnes', 1400, 100).dvojite).toBe(false)
  })
})
