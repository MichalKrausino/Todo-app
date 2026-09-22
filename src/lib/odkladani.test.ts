import { describe, expect, it } from 'vitest'
import type { Task } from '../db/types'
import {
  MIN_VZOREK,
  PRAH_ODKLADU,
  dokonceniPodleOdkladu,
  jeLezak,
  popisOdkladu,
  vetaOOdkladani,
} from './odkladani'
import { POSTPONE_THRESHOLD } from './signals'

const ukol = (extra: Partial<Task>): Task =>
  ({
    id: Math.random().toString(36).slice(2),
    title: 'x',
    status: 'active',
    priority: 'normal',
    order: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  }) as Task

describe('ležák', () => {
  it('od druhého odkladu — tam se v datech přestalo dodělávat', () => {
    expect(jeLezak(ukol({}))).toBe(false)
    expect(jeLezak(ukol({ postponeCount: 1 }))).toBe(false)
    expect(jeLezak(ukol({ postponeCount: 2 }))).toBe(true)
    expect(jeLezak(ukol({ postponeCount: 7 }))).toBe(true)
  })

  it('popis mlčí, dokud není o čem mluvit', () => {
    expect(popisOdkladu(ukol({ postponeCount: 1 }))).toBe('')
    expect(popisOdkladu(ukol({ postponeCount: 4 }))).toBe('odloženo 4×')
  })

  // Dvě různá čísla o téže věci by byla vada; tady je ten rozdíl záměr
  // a drží ho test: seznam, který se ukáže sám (signály), má být vzácnější
  // než věta u úkolu, na který se člověk zrovna dívá.
  it('signály na Dnes jsou hlasitější práh než zmínka u úkolu', () => {
    expect(POSTPONE_THRESHOLD).toBeGreaterThan(PRAH_ODKLADU)
  })
})

describe('bilance odkládání', () => {
  const vzorek = [
    ukol({ postponeCount: 0, status: 'done' }),
    ukol({ postponeCount: 1, status: 'done' }),
    ukol({ postponeCount: 2, status: 'active' }),
    ukol({ postponeCount: 3, status: 'active' }),
    ukol({ postponeCount: 5, status: 'done' }),
    ukol({ postponeCount: 4, status: 'dropped' }),
  ]

  it('počítá jen odkládané a hotové z nich', () => {
    expect(dokonceniPodleOdkladu(vzorek)).toEqual({ odlozenych: 4, hotovych: 1 })
  })

  // Škrtnutý úkol je poctivý konec, ale udělaný není — a věta je o tom,
  // co se doopravdy dodělalo.
  it('zahozený se mezi hotové nepočítá', () => {
    expect(dokonceniPodleOdkladu([ukol({ postponeCount: 3, status: 'dropped' })])).toEqual({
      odlozenych: 1,
      hotovych: 0,
    })
  })

  it('smazané se nepočítají vůbec', () => {
    expect(
      dokonceniPodleOdkladu([ukol({ postponeCount: 3, status: 'done', deletedAt: '2026-09-02T00:00:00.000Z' })]),
    ).toEqual({ odlozenych: 0, hotovych: 0 })
  })

  it('věta se píše slovy a v druhém pádě', () => {
    expect(vetaOOdkladani(vzorek)).toBe(
      'Z úkolů, které jsi odložil aspoň dvakrát, se ti zatím dodělal jeden ze čtyř.',
    )
  })

  // Bilance ze dvou úkolů není bilance, je to náhoda — a appka o sobě
  // nevykládá věci, které nemá z čeho vědět.
  it('z malého vzorku se žádná věta nepíše', () => {
    const malo = Array.from({ length: MIN_VZOREK - 1 }, () => ukol({ postponeCount: 2 }))
    expect(vetaOOdkladani(malo)).toBeUndefined()
  })

  it('nula hotových se řekne slovem, ne číslicí', () => {
    const same = Array.from({ length: 5 }, () => ukol({ postponeCount: 2 }))
    expect(vetaOOdkladani(same)).toBe(
      'Z úkolů, které jsi odložil aspoň dvakrát, se ti zatím dodělal žádný z pěti.',
    )
  })
})
