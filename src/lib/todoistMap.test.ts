import { describe, expect, it } from 'vitest'
import type { Task } from '../db/types'
import {
  datesFrom,
  mergeSubtasks,
  todoistSubId,
  priorityToTodoist,
  differs,
  estimateFrom,
  isMine,
  localDayTime,
  ownedFields,
  priorityFrom,
  subtasksFrom,
  type TodoistTask,
} from './todoistMap'

const td = (patch: Partial<TodoistTask> = {}): TodoistTask => ({
  id: '7001',
  projectId: '220',
  content: 'Připravit report',
  priority: 1,
  ...patch,
})

describe('priorityFrom', () => {
  it('p1 je kritická, p4 obyčejná', () => {
    expect(priorityFrom(4)).toBe('critical')
    expect(priorityFrom(3)).toBe('high')
    // p3 je jen mírné zvýraznění — kdyby bylo „vysoké", ztratí to význam
    expect(priorityFrom(2)).toBe('normal')
    expect(priorityFrom(1)).toBe('normal')
    expect(priorityFrom(undefined)).toBe('normal')
  })
})

describe('localDayTime', () => {
  it('bere lokální čas, ne UTC', () => {
    // pozdní večer nesmí přeskočit na další den
    const { day, time } = localDayTime('2026-03-15T23:30:00')
    expect(day).toBe('2026-03-15')
    expect(time).toBe('23:30')
  })

  it('nespadne na nesmyslu', () => {
    expect(localDayTime('nesmysl').time).toBe('')
  })
})

describe('datesFrom', () => {
  it('deadline je termín, due je naplánování', () => {
    const r = datesFrom(td({ deadline: { date: '2026-04-10' }, due: { date: '2026-04-08' } }))
    expect(r.dueDate).toBe('2026-04-10')
    expect(r.scheduledFor).toBe('2026-04-08')
  })

  it('samotné due se bere jako termín', () => {
    const r = datesFrom(td({ due: { date: '2026-04-08' } }))
    expect(r.dueDate).toBe('2026-04-08')
    expect(r.scheduledFor).toBeUndefined()
  })

  it('due s časem doplní dueTime', () => {
    const r = datesFrom(td({ due: { date: '2026-04-08', datetime: '2026-04-08T14:00:00' } }))
    expect(r.dueDate).toBe('2026-04-08')
    expect(r.dueTime).toBe('14:00')
  })

  it('bez termínu nic nevymýšlí', () => {
    expect(datesFrom(td())).toEqual({})
  })
})

describe('estimateFrom', () => {
  it('minuty bere rovnou, dny jako pracovní den, strop 8 h', () => {
    expect(estimateFrom({ amount: 45, unit: 'minute' })).toBe(45)
    expect(estimateFrom({ amount: 1, unit: 'day' })).toBe(480)
    expect(estimateFrom({ amount: 5, unit: 'day' })).toBe(480)
    expect(estimateFrom(null)).toBeUndefined()
    expect(estimateFrom({ amount: 0, unit: 'minute' })).toBeUndefined()
  })
})

describe('isMine', () => {
  it('nepřiřazené beru, cizí ne', () => {
    expect(isMine(td(), 'me')).toBe(true)
    expect(isMine(td({ responsibleUid: 'me' }), 'me')).toBe(true)
    expect(isMine(td({ responsibleUid: 'nekdo' }), 'me')).toBe(false)
  })
})

describe('subtasksFrom', () => {
  it('dělá checklist s hotovým stavem', () => {
    const subs = subtasksFrom([td({ id: '9', content: 'Data', checked: true })])
    expect(subs).toEqual([{ id: 'td-9', title: 'Data', done: true }])
    expect(subtasksFrom([])).toBeUndefined()
  })
})

describe('podúkoly a Todoist', () => {
  it('pozná krok, za kterým stojí úkol v Todoistu', () => {
    expect(todoistSubId('td-9001')).toBe('9001')
    expect(todoistSubId('vlastni-krok')).toBeUndefined()
  })

  it('vlastní kroky přežijí stažení', () => {
    const mine = [{ id: 'muj', title: 'Můj krok', done: false }]
    const theirs = [{ id: 'td-9001', title: 'Krok z Todoistu', done: true }]
    expect(mergeSubtasks(mine, theirs)).toEqual([...theirs, ...mine])
    expect(mergeSubtasks(mine, undefined)).toEqual(mine)
    expect(mergeSubtasks(undefined, undefined)).toBeUndefined()
  })

  it('kroky z Todoistu se nezdvojí — nahradí se novým seznamem', () => {
    const stary = [{ id: 'td-9001', title: 'Starý název', done: false }]
    const novy = [{ id: 'td-9001', title: 'Nový název', done: true }]
    expect(mergeSubtasks(stary, novy)).toEqual(novy)
  })
})

describe('priorityToTodoist', () => {
  it('vrací se na todoistí škálu, nízká končí jako výchozí', () => {
    expect(priorityToTodoist('critical')).toBe(4)
    expect(priorityToTodoist('high')).toBe(3)
    expect(priorityToTodoist('normal')).toBe(1)
    expect(priorityToTodoist('low')).toBe(1)
  })
})

describe('ownedFields + differs', () => {
  const link = { clientId: 'c1', projectId: 'p1' }

  it('přeloží úkol i s prázdným názvem', () => {
    const f = ownedFields(td({ content: '   ' }), [], link)
    expect(f.title).toBe('(bez názvu)')
    expect(f.clientId).toBe('c1')
    expect(f.todoistId).toBe('7001')
  })

  it('beze změny nechce zápis', () => {
    const f = ownedFields(td({ updatedAt: '2026-04-01T10:00:00Z' }), [], link)
    const existing = { ...f, id: 'x', createdAt: '', updatedAt: '', status: 'active', order: 0 } as unknown as Task
    expect(differs(existing, f)).toBe(false)
  })

  it('změna názvu i checklistu se pozná', () => {
    const f = ownedFields(td(), [], link)
    const existing = { ...f, id: 'x', createdAt: '', updatedAt: '', status: 'active', order: 0 } as unknown as Task
    expect(differs({ ...existing, title: 'Něco jiného' }, f)).toBe(true)
    const withSubs = ownedFields(td(), [td({ id: '8', content: 'Krok' })], link)
    expect(differs(existing, withSubs)).toBe(true)
  })
})
