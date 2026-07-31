import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from './quickAdd'

// Středa 29. 7. 2026
const TODAY = new Date(2026, 6, 29)
const CLIENTS = [
  { id: 'c1', name: 'Klient X' },
  { id: 'c2', name: 'Acme' },
]

describe('parseQuickAdd', () => {
  it('rozpozná den v týdnu, klienta i prioritu', () => {
    const r = parseQuickAdd('ve čtvrtek poslat report @klientx !vysoká', CLIENTS, TODAY)
    expect(r.title).toBe('poslat report')
    expect(r.dueDate).toBe('2026-07-30')
    expect(r.clientId).toBe('c1')
    expect(r.priority).toBe('high')
  })

  it('funguje bez diakritiky', () => {
    const r = parseQuickAdd('ve ctvrtek report !vysoka', CLIENTS, TODAY)
    expect(r.dueDate).toBe('2026-07-30')
    expect(r.priority).toBe('high')
    expect(r.title).toBe('report')
  })

  it('rozpozná zítra a pozítří', () => {
    expect(parseQuickAdd('zítra zavolat Petrovi', [], TODAY).dueDate).toBe('2026-07-30')
    expect(parseQuickAdd('pozítří fakturace', [], TODAY).dueDate).toBe('2026-07-31')
    expect(parseQuickAdd('zítra zavolat Petrovi', [], TODAY).title).toBe('zavolat Petrovi')
  })

  it('rozpozná „za X dní“ číslem i slovem', () => {
    expect(parseQuickAdd('za 3 dny fakturace', [], TODAY).dueDate).toBe('2026-08-01')
    expect(parseQuickAdd('za tři dny fakturace', [], TODAY).dueDate).toBe('2026-08-01')
    expect(parseQuickAdd('za dva týdny revize', [], TODAY).dueDate).toBe('2026-08-12')
  })

  it('rozpozná numerické datum a roluje do dalšího roku', () => {
    expect(parseQuickAdd('15.9. návrh landing page', [], TODAY).dueDate).toBe('2026-09-15')
    expect(parseQuickAdd('1.2. revize strategie', [], TODAY).dueDate).toBe('2027-02-01')
    expect(parseQuickAdd('15. 9. návrh', [], TODAY).dueDate).toBe('2026-09-15')
    expect(parseQuickAdd('24.12.2026 dárky', [], TODAY).dueDate).toBe('2026-12-24')
  })

  it('rozpozná příští týden a příští pátek', () => {
    expect(parseQuickAdd('příští týden strategie', [], TODAY).dueDate).toBe('2026-08-03')
    expect(parseQuickAdd('příští pátek oběd', [], TODAY).dueDate).toBe('2026-08-07')
  })

  it('víkendové dny v akuzativu', () => {
    expect(parseQuickAdd('v sobotu úklid', [], TODAY).dueDate).toBe('2026-08-01')
    expect(parseQuickAdd('v neděli plán týdne', [], TODAY).dueDate).toBe('2026-08-02')
  })

  it('bez tokenů vrátí čistý inbox úkol', () => {
    const r = parseQuickAdd('koupit mléko', CLIENTS, TODAY)
    expect(r.title).toBe('koupit mléko')
    expect(r.dueDate).toBeUndefined()
    expect(r.clientId).toBeUndefined()
    expect(r.priority).toBe('normal')
  })

  it('neznámý @klient zůstane v názvu', () => {
    const r = parseQuickAdd('poslat @nikdo report', CLIENTS, TODAY)
    expect(r.clientId).toBeUndefined()
    expect(r.title).toBe('poslat @nikdo report')
  })

  it('klienta pozná i podle prefixu', () => {
    expect(parseQuickAdd('report @kli', CLIENTS, TODAY).clientId).toBe('c1')
    expect(parseQuickAdd('report @acme', CLIENTS, TODAY).clientId).toBe('c2')
  })

  it('dnešní den v týdnu znamená dnes', () => {
    expect(parseQuickAdd('ve středu standup', [], TODAY).dueDate).toBe('2026-07-29')
  })

  it('rozpozná „každý pátek" jako opakování s termínem na nejbližší pátek', () => {
    const r = parseQuickAdd('každý pátek kontrola kampaní', [], TODAY)
    expect(r.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=FR')
    expect(r.dueDate).toBe('2026-07-31')
    expect(r.title).toBe('kontrola kampaní')
  })

  it('rozpozná každý den / měsíc a intervaly', () => {
    expect(parseQuickAdd('každý den standup', [], TODAY).recurrenceRule).toBe('FREQ=DAILY')
    expect(parseQuickAdd('každý měsíc report', [], TODAY).recurrenceRule).toBe('FREQ=MONTHLY;BYMONTHDAY=29')
    expect(parseQuickAdd('každých 14 dní fakturace', [], TODAY).recurrenceRule).toBe('FREQ=DAILY;INTERVAL=14')
    expect(parseQuickAdd('každé 2 týdny plánování', [], TODAY).recurrenceRule).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE',
    )
  })

  it('bez „každý" se opakování nenastaví', () => {
    expect(parseQuickAdd('v pátek report', [], TODAY).recurrenceRule).toBeUndefined()
  })
})
