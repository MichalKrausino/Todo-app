import { describe, expect, it } from 'vitest'
import type { Client } from '../db/types'
import { HLIDANI_VYCHOZI_DNI, neglectedDays } from './hlidani'

const TODAY = '2026-07-29'

const client = (over: Partial<Client> = {}): Client => ({
  id: over.id ?? 'c1',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
  name: 'Klient X',
  color: '#123',
  kind: 'client',
  status: 'active',
  templateIds: [],
  ...over,
})

describe('hlídání zanedbání se nemusí zapínat', () => {
  // Změřeno na skutečných datech: `checkIntervalDays` neměl nastavený
  // ANI JEDEN z pěti klientů, takže hlídání nemohlo vzniknout
  // vůbec — a jeden klient byl 45 dní bez jediné stopy. Bezpečnostní
  // síť, kterou si musíš u každého klienta zvlášť zapnout, není síť.
  const pred = (dni: number) => {
    const d = new Date(`${TODAY}T12:00:00.000Z`)
    d.setDate(d.getDate() - dni)
    return d.toISOString()
  }

  it('klient bez nastavení se hlídá po výchozím prahu', () => {
    expect(neglectedDays(client({ lastActivityAt: pred(45) }), TODAY)).toBe(45)
  })

  it('a pod prahem mlčí', () => {
    expect(neglectedDays(client({ lastActivityAt: pred(HLIDANI_VYCHOZI_DNI) }), TODAY)).toBeNull()
  })

  it('oblast bez nastavení se nehlídá — není to vztah, který utichá', () => {
    expect(neglectedDays(client({ kind: 'personal', lastActivityAt: pred(99) }), TODAY)).toBeNull()
    expect(neglectedDays(client({ kind: 'internal', lastActivityAt: pred(99) }), TODAY)).toBeNull()
  })

  it('vlastní práh se ctí i u oblasti — to je vyslovené rozhodnutí', () => {
    expect(neglectedDays(client({ kind: 'internal', checkIntervalDays: 7, lastActivityAt: pred(30) }), TODAY)).toBe(30)
  })

  it('nula je „nehlídej" a přebije i výchozí práh', () => {
    expect(neglectedDays(client({ checkIntervalDays: 0, lastActivityAt: pred(99) }), TODAY)).toBeNull()
  })

  it('bez jediné aktivity se nehlídá nic', () => {
    expect(neglectedDays(client({}), TODAY)).toBeNull()
  })
})
