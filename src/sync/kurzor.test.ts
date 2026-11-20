import { describe, expect, it } from 'vitest'
import { dekodujKurzor, filtrZaKurzorem, zakodujKurzor } from './kurzor'

describe('kurzor stahování', () => {
  const k = { at: '2026-11-20T10:57:49.034555+00:00', id: '5f0c6c1e-8a49-4d55-9f3e-2b1c0a7d9e11' }

  it('projde zakódováním tam a zpátky beze změny', () => {
    expect(dekodujKurzor(zakodujKurzor(k))).toEqual(k)
  })

  it('starý kurzor (holé updated_at) se nebere — stáhne se jednou všechno', () => {
    expect(dekodujKurzor('2026-11-19T22:00:00.000Z')).toBeNull()
    expect(dekodujKurzor('')).toBeNull()
    expect(dekodujKurzor(undefined)).toBeNull()
    expect(dekodujKurzor('|bez-razitka')).toBeNull()
    expect(dekodujKurzor('2026-11-19T22:00:00Z|')).toBeNull()
  })

  it('filtr bere i řádky se stejným razítkem za posledním id', () => {
    // Tvar ověřený proti živému PostgRESTu (200; překlep v operátoru 400).
    expect(filtrZaKurzorem(k)).toBe(
      'synced_at.gt."2026-11-20T10:57:49.034555+00:00",' +
        'and(synced_at.eq."2026-11-20T10:57:49.034555+00:00",id.gt.5f0c6c1e-8a49-4d55-9f3e-2b1c0a7d9e11)',
    )
  })
})
