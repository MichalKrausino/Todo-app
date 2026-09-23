import { describe, expect, it } from 'vitest'
import type { Task } from '../db/types'
import {
  MIN_VZOREK,
  PRAH_ODKLADU,
  dokonceniPodleOdkladu,
  jeOdkladanySlib,
  jeParkovany,
  jeSlib,
  popisOdkladu,
  vetaOOdkladani,
} from './odkladani'
import { POSTPONE_THRESHOLD, computeSignals } from './signals'

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

const SLIB = { dueDate: '2026-09-10' }

describe('slib vs parkoviště', () => {
  it('slib je termín, ne naplánování', () => {
    expect(jeSlib(ukol(SLIB))).toBe(true)
    expect(jeSlib(ukol({ scheduledFor: '2026-09-10' }))).toBe(false)
    expect(jeSlib(ukol({}))).toBe(false)
  })

  it('o odkladu se mluví od druhého — tam se v datech přestalo dodělávat', () => {
    expect(jeOdkladanySlib(ukol(SLIB))).toBe(false)
    expect(jeOdkladanySlib(ukol({ ...SLIB, postponeCount: 1 }))).toBe(false)
    expect(jeOdkladanySlib(ukol({ ...SLIB, postponeCount: 2 }))).toBe(true)
    expect(jeOdkladanySlib(ukol({ ...SLIB, postponeCount: 7 }))).toBe(true)
  })

  // Jádro opravy: úkol bez termínu, který se posouvá pořád dokola, není
  // selhání, ale vědomě odložená práce — appka ho nesmí značkovat.
  it('úkol bez termínu se neznačkuje, ať se posouval kolikrát chce', () => {
    expect(jeOdkladanySlib(ukol({ postponeCount: 9 }))).toBe(false)
    expect(popisOdkladu(ukol({ postponeCount: 9 }))).toBe('')
    expect(jeOdkladanySlib(ukol({ scheduledFor: '2026-09-10', postponeCount: 9 }))).toBe(false)
  })

  it('místo značky je parkovaný — a to je ta nabídka „Bez data"', () => {
    expect(jeParkovany(ukol({ postponeCount: 2 }))).toBe(true)
    expect(jeParkovany(ukol({ scheduledFor: '2026-09-10', postponeCount: 5 }))).toBe(true)
    // Slib parkovaný není: ten má být splněný, ne odložený bez data.
    expect(jeParkovany(ukol({ ...SLIB, postponeCount: 5 }))).toBe(false)
    // A jednou odložený úkol ještě žádný vzorec neukázal.
    expect(jeParkovany(ukol({ postponeCount: 1 }))).toBe(false)
  })

  it('žádný úkol není obojí zároveň', () => {
    const vzorky = [
      ukol({ postponeCount: 5 }),
      ukol({ ...SLIB, postponeCount: 5 }),
      ukol({ postponeCount: 0 }),
      ukol({ ...SLIB, postponeCount: 1 }),
    ]
    for (const t of vzorky) expect(jeOdkladanySlib(t) && jeParkovany(t)).toBe(false)
  })

  it('popis mlčí, dokud není o čem mluvit', () => {
    expect(popisOdkladu(ukol({ ...SLIB, postponeCount: 1 }))).toBe('')
    expect(popisOdkladu(ukol({ ...SLIB, postponeCount: 4 }))).toBe('odloženo 4×')
  })

  // Dvě různá čísla o téže věci by byla vada; tady je ten rozdíl záměr
  // a drží ho test: seznam, který se ukáže sám (signály), má být vzácnější
  // než věta u úkolu, na který se člověk zrovna dívá.
  it('signály na Dnes jsou hlasitější práh než zmínka u úkolu', () => {
    expect(POSTPONE_THRESHOLD).toBeGreaterThan(PRAH_ODKLADU)
  })

  // Appka nesmí mít na jednu věc dva názory: co triáž nepovažuje za
  // odklad, o kterém se mluví, nesmí vyhrabat ani signál na Dnes.
  it('signály na Dnes ctí totéž pravidlo — parkovaný úkol tam není', () => {
    const park = ukol({ postponeCount: POSTPONE_THRESHOLD + 2 })
    const slib = ukol({ ...SLIB, postponeCount: POSTPONE_THRESHOLD })
    const s = computeSignals([], [], [park, slib], '2026-09-20')
    expect(s.postponed.map((t) => t.id)).toEqual([slib.id])
  })
})

describe('bilance odkládání', () => {
  const vzorek = [
    ukol({ ...SLIB, postponeCount: 0, status: 'done' }),
    ukol({ ...SLIB, postponeCount: 1, status: 'done' }),
    ukol({ ...SLIB, postponeCount: 2, status: 'active' }),
    ukol({ ...SLIB, postponeCount: 3, status: 'active' }),
    ukol({ ...SLIB, postponeCount: 5, status: 'done' }),
    ukol({ ...SLIB, postponeCount: 4, status: 'dropped' }),
  ]

  it('počítá jen odkládané a hotové z nich', () => {
    expect(dokonceniPodleOdkladu(vzorek)).toEqual({ odlozenych: 4, hotovych: 1 })
  })

  // Škrtnutý úkol je poctivý konec, ale udělaný není — a věta je o tom,
  // co se doopravdy dodělalo.
  it('zahozený se mezi hotové nepočítá', () => {
    expect(dokonceniPodleOdkladu([ukol({ ...SLIB, postponeCount: 3, status: 'dropped' })])).toEqual({
      odlozenych: 1,
      hotovych: 0,
    })
  })

  it('smazané se nepočítají vůbec', () => {
    expect(
      dokonceniPodleOdkladu([
        ukol({ ...SLIB, postponeCount: 3, status: 'done', deletedAt: '2026-09-02T00:00:00.000Z' }),
      ]),
    ).toEqual({ odlozenych: 0, hotovych: 0 })
  })

  // Bilance je o slibech. Parkované úkoly ji dřív tvořily skoro celou
  // (čtyři z pěti) a vycházelo z ní „nedodělal ses ani jeden" o práci,
  // kterou si člověk schválně odložil.
  it('parkované úkoly do bilance nevstupují', () => {
    const park = Array.from({ length: 9 }, () => ukol({ postponeCount: 4 }))
    expect(dokonceniPodleOdkladu(park)).toEqual({ odlozenych: 0, hotovych: 0 })
    expect(vetaOOdkladani(park)).toBeUndefined()
  })

  it('věta se píše slovy a v druhém pádě', () => {
    expect(vetaOOdkladani(vzorek)).toBe(
      'Z úkolů s termínem, které jsi odložil aspoň dvakrát, se ti zatím dodělal jeden ze čtyř.',
    )
  })

  // Bilance ze dvou úkolů není bilance, je to náhoda — a appka o sobě
  // nevykládá věci, které nemá z čeho vědět.
  it('z malého vzorku se žádná věta nepíše', () => {
    const malo = Array.from({ length: MIN_VZOREK - 1 }, () => ukol({ ...SLIB, postponeCount: 2 }))
    expect(vetaOOdkladani(malo)).toBeUndefined()
  })

  it('nula hotových se řekne slovem, ne číslicí', () => {
    const same = Array.from({ length: 5 }, () => ukol({ ...SLIB, postponeCount: 2 }))
    expect(vetaOOdkladani(same)).toBe(
      'Z úkolů s termínem, které jsi odložil aspoň dvakrát, se ti zatím dodělal žádný z pěti.',
    )
  })
})
