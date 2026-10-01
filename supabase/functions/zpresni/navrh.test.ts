import { describe, expect, it } from 'vitest'
import { klic, ocisti, odkazy, zprava, type Kontext, type Parser } from './navrh'

const K: Kontext = {
  dnes: '2026-10-01',
  klienti: [
    { id: 'c-panelora', jmeno: 'Panelora' },
    { id: 'c-alza', jmeno: 'Alza' },
  ],
  projekty: [
    { id: 'p-b2b', jmeno: 'B2B Pavel', klientId: 'c-panelora' },
    { id: 'p-ppc', jmeno: 'PPC', klientId: 'c-alza' },
  ],
  lide: [{ id: 'u-ben', jmeno: 'ben' }],
}
const P: Parser = { nazev: 'po schůzce připravit 3 varianty banneru a poslat Benovi', klientId: 'c-panelora', termin: '2026-10-02' }

describe('odkazy', () => {
  it('model dostává krátké odkazy, ne id z databáze', () => {
    const o = odkazy(K)
    expect(o.klienti.map((c) => c.ref)).toEqual(['k1', 'k2'])
    expect(o.projekty.map((p) => p.ref)).toEqual(['p1', 'p2'])
    expect(o.lide[0].ref).toBe('l1')
    expect(zprava('x', P, K)).not.toContain('c-panelora')
  })
})

describe('ocisti', () => {
  it('platná odpověď → id z databáze', () => {
    const n = ocisti(
      { nazev: 'Připravit 3 varianty banneru', klient: 'k1', projekt: 'p1', termin: '2026-10-03', cas: '14:30', priorita: 'high', komu: null, kroky: ['Varianta 1', 'Varianta 2', 'Poslat Benovi'] },
      P,
      K,
    )
    expect(n).toEqual({
      nazev: 'Připravit 3 varianty banneru',
      projektId: 'p-b2b',
      termin: '2026-10-03',
      cas: '14:30',
      priorita: 'high',
      kroky: ['Varianta 1', 'Varianta 2', 'Poslat Benovi'],
    })
  })

  // Neplatný odkaz neshodí celý návrh — zahodí se jen to jedno pole.
  it('vymyšlený odkaz se zahodí, zbytek zůstane', () => {
    const n = ocisti({ nazev: 'Banner', klient: 'k9', projekt: 'p7', komu: 'l4', termin: null, cas: null, priorita: null, kroky: [] }, P, K)
    expect(n).toEqual({ nazev: 'Banner' })
  })

  it('projekt cizího klienta se nevezme', () => {
    expect(ocisti({ projekt: 'p2' }, P, K).projektId).toBeUndefined()
  })

  it('projekt vezme klienta s sebou, když parser žádného neměl', () => {
    const n = ocisti({ projekt: 'p2' }, { nazev: 'x' }, K)
    expect(n).toMatchObject({ projektId: 'p-ppc', klientId: 'c-alza' })
  })

  // „do pátku" řečené v sobotu je chyba výpočtu, ne přání.
  it('termín v minulosti, nesmyslné datum i čas se zahodí', () => {
    const n = ocisti({ termin: '2026-09-30', cas: '25:00' }, P, K)
    expect(n.termin).toBeUndefined()
    expect(n.cas).toBeUndefined()
    expect(ocisti({ termin: '2026-02-30' }, P, K).termin).toBeUndefined()
  })

  it('co se shoduje s parserem, není návrh', () => {
    const n = ocisti({ klient: 'k1', termin: '2026-10-02', priorita: 'normal', nazev: P.nazev }, P, K)
    expect(n).toEqual({})
  })

  it('jeden krok není rozpad; kroky se ořežou na strop', () => {
    expect(ocisti({ kroky: ['Jen jeden'] }, P, K).kroky).toBeUndefined()
    expect(ocisti({ kroky: Array.from({ length: 20 }, (_, i) => `Krok ${i}`) }, P, K).kroky).toHaveLength(8)
  })

  it('nesmysl na vstupu → prázdný návrh, ne pád', () => {
    expect(ocisti(null, P, K)).toEqual({})
    expect(ocisti('text', P, K)).toEqual({})
    expect(ocisti({ priorita: 'urgent', nazev: 42 }, P, K)).toEqual({})
  })
})

describe('klic', () => {
  it('jiný den = jiný klíč (relativní data se počítají od dneška)', () => {
    expect(klic('x', P, K)).not.toBe(klic('x', P, { ...K, dnes: '2026-10-02' }))
    expect(klic('x', P, K)).toBe(klic('x', P, { ...K }))
  })
})
