import { describe, expect, it } from 'vitest'
import {
  kvantil,
  MIN_DNU,
  MIN_STROP_MIN,
  minutyHotovePoDnech,
  osobniPrutok,
  REZERVA,
  stropZPrutoku,
} from './prutok'
import { PLNY_DEN_MIN } from './pruhDne'
import type { Task } from '../db/types'

const DNES = '2026-09-20'

let seq = 0
const hotovy = (den: string, minut?: number, patch: Partial<Task> = {}): Task =>
  ({
    id: `h${++seq}`,
    title: 'hotovo',
    status: 'done',
    completedAt: `${den}T10:00:00.000Z`,
    estimateMinutes: minut,
    ...patch,
  }) as Task

/** N dní s hotovou prací, každý den `minut`. */
const dny = (pocet: number, minut: number, od = 1): Task[] =>
  Array.from({ length: pocet }, (_, i) => {
    const d = new Date(`${DNES}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - (i + od))
    return hotovy(d.toISOString().slice(0, 10), minut)
  })

describe('kvantil', () => {
  it('prázdné pole je nula, jeden prvek je on sám', () => {
    expect(kvantil([], 0.5)).toBe(0)
    expect(kvantil([42], 0.8)).toBe(42)
  })

  it('medián a interpolace mezi prvky', () => {
    expect(kvantil([10, 20, 30], 0.5)).toBe(20)
    expect(kvantil([10, 20], 0.5)).toBe(15)
  })

  it('krajní hodnoty se nepřetečou', () => {
    expect(kvantil([10, 20, 30], 0)).toBe(10)
    expect(kvantil([10, 20, 30], 1)).toBe(30)
    expect(kvantil([10, 20, 30], 5)).toBe(30)
  })
})

describe('minuty hotové práce po dnech', () => {
  it('sčítá podle dne dokončení a bez odhadu počítá výchozí délku', () => {
    const m = minutyHotovePoDnech(
      [hotovy('2026-09-18', 30), hotovy('2026-09-18', 90), hotovy('2026-09-19')],
      '2026-09-01',
      DNES,
    )
    expect(m.get('2026-09-18')).toBe(120)
    expect(m.get('2026-09-19')).toBe(60)
  })

  it('otevřené, smazané a mimo okno se nepočítají', () => {
    const m = minutyHotovePoDnech(
      [
        hotovy('2026-09-18', 30, { status: 'active' }),
        hotovy('2026-09-18', 30, { deletedAt: '2026-09-19T00:00:00.000Z' }),
        hotovy('2026-08-01', 30),
      ],
      '2026-09-01',
      DNES,
    )
    expect(m.size).toBe(0)
  })

  // Den bez odškrtnutí není den s nulovým průtokem — je to nejspíš den,
  // kdy se appka neotevřela. Kdyby se nuly počítaly, stáhl by strop
  // k zemi každý volný týden.
  it('dny bez hotové práce se vůbec neobjeví', () => {
    const m = minutyHotovePoDnech([hotovy('2026-09-18', 30)], '2026-09-01', DNES)
    expect([...m.keys()]).toEqual(['2026-09-18'])
  })
})

describe('osobní průtok', () => {
  it('s málo dny mlčí — anekdota není míra', () => {
    expect(osobniPrutok(dny(MIN_DNU - 1, 100), DNES)).toBeUndefined()
  })

  it('od MIN_DNU už počítá', () => {
    const p = osobniPrutok(dny(MIN_DNU, 100), DNES)
    expect(p?.dnu).toBe(MIN_DNU)
    expect(p?.median).toBe(100)
    expect(p?.nejlepsi).toBe(100)
  })

  it('dobrý den je nad mediánem, když se dny liší', () => {
    const ukoly = [...dny(5, 60), ...dny(5, 180, 6)]
    const p = osobniPrutok(ukoly, DNES)!
    expect(p.median).toBeLessThan(p.dobryDen)
    expect(p.nejlepsi).toBe(180)
  })

  it('starší než okno se nepočítá', () => {
    expect(osobniPrutok(dny(MIN_DNU, 100, 60), DNES)).toBeUndefined()
  })
})

describe('strop z průtoku', () => {
  it('bez historie platí pracovní doba — appka si nevymýšlí', () => {
    expect(stropZPrutoku(undefined)).toBe(PLNY_DEN_MIN)
  })

  it('z dobrého dne s rezervou', () => {
    const p = osobniPrutok(dny(10, 200), DNES)!
    expect(stropZPrutoku(p)).toBe(Math.round(200 * REZERVA))
  })

  it('nikdy nespadne pod spodní hranici — týden dovolené strop neutáhne', () => {
    const p = osobniPrutok(dny(10, 10), DNES)!
    expect(stropZPrutoku(p)).toBe(MIN_STROP_MIN)
  })

  it('a nikdy nepřeleze pracovní dobu', () => {
    const p = osobniPrutok(dny(10, 600), DNES)!
    expect(stropZPrutoku(p)).toBe(PLNY_DEN_MIN)
  })

  // Skutečná data: 17 dnů, medián 120, nejlepší den 150. Strop z nich
  // vyjde v řádu tří až čtyř hodin — tedy číslo, které se o čtvrtku se
  // 495 minutami opravdu ozve, na rozdíl od nominálních osmi hodin.
  it('na skutečných datech dá strop, který se umí ozvat', () => {
    const p = osobniPrutok([...dny(9, 120), ...dny(8, 150, 10)], DNES)!
    const strop = stropZPrutoku(p)
    expect(strop).toBeGreaterThanOrEqual(MIN_STROP_MIN)
    expect(strop).toBeLessThan(PLNY_DEN_MIN)
    expect(495).toBeGreaterThan(strop)
  })
})
