import { describe, expect, it } from 'vitest'
import type { Task } from '../db/types'
import { sortTasks } from '../db/repo'
import { denUkolu, vseSkupiny, zaradDoKose } from './vseSkupiny'
import { DVOJKLIK_MS, vyhodnotStisk } from './dvojklik'

const u = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
  title: id,
  priority: 'normal',
  status: 'active',
  order: 0,
  ...extra,
})

// čtvrtek
const DNES = '2026-09-17'

describe('zaradDoKose', () => {
  it('řadí podle dne, týden končí nedělí', () => {
    expect(zaradDoKose(undefined, DNES)).toBe('bezTerminu')
    expect(zaradDoKose('2026-09-16', DNES)).toBe('poTerminu')
    expect(zaradDoKose(DNES, DNES)).toBe('dnes')
    expect(zaradDoKose('2026-09-18', DNES)).toBe('zitra')
    expect(zaradDoKose('2026-09-19', DNES)).toBe('tyden')
    expect(zaradDoKose('2026-09-20', DNES)).toBe('tyden') // neděle
    expect(zaradDoKose('2026-09-21', DNES)).toBe('pozdeji') // pondělí
  })

  it('zítřek vyhrává nad koncem týdne', () => {
    // v sobotu je zítřek neděle — pořád „zítra", ne „tento týden"
    expect(zaradDoKose('2026-09-20', '2026-09-19')).toBe('zitra')
  })

  it('den bere dřívější z naplánování a termínu', () => {
    expect(denUkolu(u('a', { dueDate: '2026-09-20', scheduledFor: '2026-09-18' }))).toBe('2026-09-18')
  })
})

describe('vseSkupiny', () => {
  it('vrací jen neprázdné koše v pevném pořadí', () => {
    const koše = vseSkupiny(
      [u('a', { dueDate: '2026-09-30' }), u('b'), u('c', { dueDate: '2026-09-01' })],
      DNES,
      sortTasks,
    )
    expect(koše.map((k) => k.id)).toEqual(['poTerminu', 'pozdeji', 'bezTerminu'])
  })

  it('uvnitř koše vyhrává den, priorita rozhoduje až při shodě', () => {
    const koš = vseSkupiny(
      [
        u('kritický později', { dueDate: '2026-12-01', priority: 'critical' }),
        u('běžný dřív', { dueDate: '2026-10-01' }),
        u('kritický dřív', { dueDate: '2026-10-01', priority: 'critical' }),
      ],
      DNES,
      sortTasks,
    )[0]
    expect(koš.ukoly.map((t) => t.id)).toEqual(['kritický dřív', 'běžný dřív', 'kritický později'])
  })

  it('bez termínu se řadí prioritou — den tam žádný není', () => {
    const koš = vseSkupiny([u('běžný'), u('hoří', { priority: 'critical' })], DNES, sortTasks)[0]
    expect(koš.ukoly.map((t) => t.id)).toEqual(['hoří', 'běžný'])
  })

  it('nezahodí ani jeden úkol', () => {
    const ukoly = [u('a'), u('b', { dueDate: DNES }), u('c', { dueDate: '2026-09-18' }), u('d', { scheduledFor: '2026-01-01' })]
    const spocteno = vseSkupiny(ukoly, DNES, sortTasks).reduce((n, k) => n + k.ukoly.length, 0)
    expect(spocteno).toBe(ukoly.length)
  })
})

describe('vyhodnotStisk', () => {
  it('dvě ťuknutí na tutéž záložku v okně jsou dvojité', () => {
    const prvni = vyhodnotStisk(null, 'today', 1000)
    expect(prvni.dvojite).toBe(false)
    expect(vyhodnotStisk(prvni.stav, 'today', 1000 + DVOJKLIK_MS).dvojite).toBe(true)
  })

  it('pomalé ťuknutí dvojité není', () => {
    const prvni = vyhodnotStisk(null, 'today', 1000)
    expect(vyhodnotStisk(prvni.stav, 'today', 1000 + DVOJKLIK_MS + 1).dvojite).toBe(false)
  })

  it('jiná záložka mezi tím dvojité ruší', () => {
    const prvni = vyhodnotStisk(null, 'today', 1000)
    const jina = vyhodnotStisk(prvni.stav, 'clients', 1050)
    expect(jina.dvojite).toBe(false)
    expect(vyhodnotStisk(jina.stav, 'today', 1100).dvojite).toBe(false)
  })

  it('trojité ťuknutí není dvojité dvakrát', () => {
    const a = vyhodnotStisk(null, 'today', 1000)
    const b = vyhodnotStisk(a.stav, 'today', 1100)
    expect(b.dvojite).toBe(true)
    expect(vyhodnotStisk(b.stav, 'today', 1200).dvojite).toBe(false)
  })
})
