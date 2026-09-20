import { describe, expect, it } from 'vitest'
import { kvantil, MIN_DNU, osobniPrutok, stropZPrutoku, ukolyHotovePoDnech } from './prutok'
import type { Task } from '../db/types'

const DNES = '2026-09-20'

let seq = 0
const hotovy = (den: string, patch: Partial<Task> = {}): Task =>
  ({
    id: `h${++seq}`,
    title: 'hotovo',
    status: 'done',
    completedAt: `${den}T10:00:00.000Z`,
    ...patch,
  }) as Task

/** `pocet` dní zpátky od dneška, v každém `zaDen` hotových úkolů. */
const dny = (pocet: number, zaDen: number, od = 1): Task[] =>
  Array.from({ length: pocet }, (_, i) => {
    const d = new Date(`${DNES}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - (i + od))
    const den = d.toISOString().slice(0, 10)
    return Array.from({ length: zaDen }, () => hotovy(den))
  }).flat()

describe('kvantil', () => {
  it('prázdné pole je nula, jeden prvek je on sám', () => {
    expect(kvantil([], 0.5)).toBe(0)
    expect(kvantil([42], 0.8)).toBe(42)
  })

  it('medián a interpolace mezi prvky', () => {
    expect(kvantil([1, 2, 3], 0.5)).toBe(2)
    expect(kvantil([1, 2], 0.5)).toBe(1.5)
  })

  it('krajní hodnoty se nepřetečou', () => {
    expect(kvantil([1, 2, 3], 0)).toBe(1)
    expect(kvantil([1, 2, 3], 5)).toBe(3)
  })
})

describe('počty hotové práce po dnech', () => {
  it('sčítá kusy podle dne dokončení', () => {
    const m = ukolyHotovePoDnech(
      [hotovy('2026-09-18'), hotovy('2026-09-18'), hotovy('2026-09-19')],
      '2026-09-01',
      DNES,
    )
    expect(m.get('2026-09-18')).toBe(2)
    expect(m.get('2026-09-19')).toBe(1)
  })

  it('otevřené, smazané a mimo okno se nepočítají', () => {
    const m = ukolyHotovePoDnech(
      [
        hotovy('2026-09-18', { status: 'active' }),
        hotovy('2026-09-18', { deletedAt: '2026-09-19T00:00:00.000Z' }),
        hotovy('2026-08-01'),
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
    const m = ukolyHotovePoDnech([hotovy('2026-09-18')], '2026-09-01', DNES)
    expect([...m.keys()]).toEqual(['2026-09-18'])
  })

  // Odhady času se do průtoku nesmějí dostat ani omylem: jsou hádané
  // (53 % úkolů je nemá vůbec) a přesně proto se tu počítají kusy.
  it('odhad času výsledek nijak nemění', () => {
    const bez = ukolyHotovePoDnech([hotovy('2026-09-18'), hotovy('2026-09-18')], '2026-09-01', DNES)
    const s = ukolyHotovePoDnech(
      [
        hotovy('2026-09-18', { estimateMinutes: 15 }),
        hotovy('2026-09-18', { estimateMinutes: 480 }),
      ],
      '2026-09-01',
      DNES,
    )
    expect(s.get('2026-09-18')).toBe(bez.get('2026-09-18'))
  })
})

describe('osobní průtok', () => {
  it('s málo dny mlčí — anekdota není míra', () => {
    expect(osobniPrutok(dny(MIN_DNU - 1, 2), DNES)).toBeUndefined()
  })

  it('od MIN_DNU už počítá', () => {
    const p = osobniPrutok(dny(MIN_DNU, 2), DNES)
    expect(p?.dnu).toBe(MIN_DNU)
    expect(p?.median).toBe(2)
    expect(p?.nejlepsi).toBe(2)
  })

  it('dobrý den je nad mediánem, když se dny liší', () => {
    const p = osobniPrutok([...dny(5, 1), ...dny(5, 4, 6)], DNES)!
    expect(p.median).toBeLessThan(p.dobryDen)
    expect(p.nejlepsi).toBe(4)
  })

  it('starší než okno se nepočítá', () => {
    expect(osobniPrutok(dny(MIN_DNU, 2, 60), DNES)).toBeUndefined()
  })
})

describe('strop z průtoku', () => {
  // Tohle je ta nejdůležitější věta celého souboru.
  it('bez historie žádný strop není — appka si nevymýšlí', () => {
    expect(stropZPrutoku(undefined)).toBeUndefined()
  })

  it('strop je dobrý den', () => {
    const p = osobniPrutok(dny(10, 3), DNES)!
    expect(stropZPrutoku(p)).toBe(3)
  })

  it('nikdy nespadne na nulu — to by hlásilo každý úkol', () => {
    const p = osobniPrutok(dny(10, 0), DNES)
    expect(p).toBeUndefined() // dny bez práce se ani nepočítají
    expect(stropZPrutoku({ dnu: 9, median: 0, dobryDen: 0, nejlepsi: 0 })).toBe(1)
  })

  // Skutečné rozdělení z provozu: 7 dnů po jednom úkolu, 8 dnů po dvou,
  // 2 dny po třech. Medián 2, dobrý den 2, rekord 3 — a strop tedy 2,
  // takže se appka ozve teprve od čtyř úkolů na den.
  it('na skutečném rozdělení vyjde strop 2', () => {
    const p = osobniPrutok([...dny(7, 1), ...dny(8, 2, 8), ...dny(2, 3, 16)], DNES)!
    expect(p.dnu).toBe(17)
    expect(p.median).toBe(2)
    expect(p.nejlepsi).toBe(3)
    expect(stropZPrutoku(p)).toBe(2)
  })
})
