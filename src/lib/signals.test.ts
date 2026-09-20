import { describe, expect, it } from 'vitest'
import type { Client, Project, Task } from '../db/types'
import { computeSignals, hasAnySignal, HLIDANI_VYCHOZI_DNI, neglectedDays } from './signals'

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

const task = (over: Partial<Task> = {}): Task => ({
  id: over.id ?? 't1',
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
  title: 'Úkol',
  priority: 'normal',
  status: 'active',
  order: 0,
  ...over,
})

const project = (over: Partial<Project> = {}): Project => ({
  id: over.id ?? 'p1',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
  clientId: 'c1',
  name: 'Projekt',
  status: 'active',
  order: 0,
  ...over,
})

describe('computeSignals', () => {
  it('hlásí zanedbaného klienta a vynechá ho z „nic naplánovaného"', () => {
    const c = client({ checkIntervalDays: 7, lastActivityAt: '2026-07-10T08:00:00.000Z' })
    const s = computeSignals([c], [], [], TODAY)
    expect(s.neglected).toEqual([{ client: c, days: 19 }])
    expect(s.unplanned).toEqual([])
  })

  it('klient bez budoucího úkolu je „nic naplánovaného", s budoucím ne', () => {
    const c = client()
    expect(computeSignals([c], [], [], TODAY).unplanned).toEqual([c])
    const planned = task({ clientId: 'c1', dueDate: '2026-08-01' })
    expect(computeSignals([c], [], [planned], TODAY).unplanned).toEqual([])
  })

  it('novému klientovi nenadává (ochranná lhůta)', () => {
    const fresh = client({ createdAt: '2026-07-28T10:00:00.000Z' })
    expect(computeSignals([fresh], [], [], TODAY).unplanned).toEqual([])
  })

  it('oblasti (internal/personal) se do „nic naplánovaného" nepočítají', () => {
    const personal = client({ kind: 'personal' })
    expect(computeSignals([personal], [], [], TODAY).unplanned).toEqual([])
  })

  it('projekt bez otevřeného úkolu stojí; s úkolem ne', () => {
    const c = client()
    const p = project()
    expect(computeSignals([c], [p], [], TODAY).stalledProjects).toEqual([{ project: p, client: c }])
    const t = task({ clientId: 'c1', projectId: 'p1' })
    expect(computeSignals([c], [p], [t], TODAY).stalledProjects).toEqual([])
  })

  it('projekt archivovaného klienta se nehlásí', () => {
    const c = client({ status: 'archived' })
    expect(computeSignals([c], [project()], [], TODAY).stalledProjects).toEqual([])
  })

  it('inbox ležák se hlásí až po týdnu', () => {
    const old = task({ id: 'a', status: 'inbox', createdAt: '2026-07-15T10:00:00.000Z' })
    const freshT = task({ id: 'b', status: 'inbox', createdAt: '2026-07-27T10:00:00.000Z' })
    const s = computeSignals([], [], [old, freshT], TODAY)
    expect(s.agingInbox.map((t) => t.id)).toEqual(['a'])
  })

  it('hlásí opakovaně odkládané úkoly, seřazené podle počtu odkladů', () => {
    const a = task({ id: 'a', postponeCount: 3, dueDate: '2026-08-01' })
    const b = task({ id: 'b', postponeCount: 5, dueDate: '2026-08-01' })
    const c = task({ id: 'c', postponeCount: 2, dueDate: '2026-08-01' })
    const s = computeSignals([], [], [a, b, c], TODAY)
    expect(s.postponed.map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('hotové a smazané úkoly signály netriggerují', () => {
    const doneT = task({ id: 'a', status: 'done', postponeCount: 9 })
    const deleted = task({ id: 'b', deletedAt: '2026-07-20T10:00:00.000Z', postponeCount: 9 })
    const s = computeSignals([], [], [doneT, deleted], TODAY)
    expect(hasAnySignal(s)).toBe(false)
  })
})

describe('hlídání zanedbání se nemusí zapínat', () => {
  // Změřeno na skutečných datech: `checkIntervalDays` neměl nastavený
  // ANI JEDEN z pěti klientů, takže signál zanedbání nemohl vzniknout
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

  it('a signál z toho opravdu vyjde i bez nastavení', () => {
    const s = computeSignals([client({ lastActivityAt: pred(45) })], [], [], TODAY)
    expect(s.neglected.map((n) => n.days)).toEqual([45])
  })
})
