import { describe, expect, it } from 'vitest'
import {
  RULE_EPOCH,
  alignDueDate,
  firstOccurrenceFrom,
  humanizeRule,
  nextOccurrence,
  occurrencesBetween,
  partsFromRule,
  presetFromRule,
  ruleFromParts,
  ruleFromPreset,
} from './rrule'
import { deterministicUuid } from './deterministicId'

describe('occurrencesBetween', () => {
  it('týdenní pravidlo vrací všechny pátky v okně', () => {
    expect(occurrencesBetween('FREQ=WEEKLY;BYDAY=FR', RULE_EPOCH, '2026-07-29', '2026-08-31')).toEqual([
      '2026-07-31',
      '2026-08-07',
      '2026-08-14',
      '2026-08-21',
      '2026-08-28',
    ])
  })

  it('dvoutýdenní pravidlo je deterministické díky pevné kotvě', () => {
    const a = occurrencesBetween('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', RULE_EPOCH, '2026-07-29', '2026-09-30')
    const b = occurrencesBetween('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', RULE_EPOCH, '2026-07-29', '2026-09-30')
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(3)
    for (let i = 1; i < a.length; i++) {
      const diff = (Date.parse(a[i]) - Date.parse(a[i - 1])) / 86400000
      expect(diff).toBe(14)
    }
  })

  it('měsíční pravidlo na 1. den', () => {
    expect(occurrencesBetween('FREQ=MONTHLY;BYMONTHDAY=1', RULE_EPOCH, '2026-07-29', '2026-08-28')).toEqual([
      '2026-08-01',
    ])
  })

  it('čtvrtletní pravidlo běží v lednu/dubnu/červenci/říjnu', () => {
    const dates = occurrencesBetween(
      'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=5',
      RULE_EPOCH,
      '2026-01-01',
      '2026-12-31',
    )
    expect(dates).toEqual(['2026-01-05', '2026-04-05', '2026-07-05', '2026-10-05'])
  })
})

describe('nextOccurrence', () => {
  it('vrací nejbližší další výskyt po dni (exkluzivně)', () => {
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=FR', '2026-07-31', '2026-07-31')).toBe('2026-08-07')
    expect(nextOccurrence('FREQ=DAILY', '2026-07-29', '2026-07-29')).toBe('2026-07-30')
  })
})

describe('ruleFromPreset / presetFromRule', () => {
  it('jsou vzájemně konzistentní', () => {
    const presets = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const
    for (const p of presets) {
      expect(presetFromRule(ruleFromPreset(p, '2026-09-15'))).toBe(p)
    }
  })

  it('týdenní předvolba si vezme den z termínu', () => {
    expect(ruleFromPreset('weekly', '2026-07-31')).toBe('FREQ=WEEKLY;BYDAY=FR')
  })
})

describe('humanizeRule', () => {
  it('popisuje pravidla česky', () => {
    expect(humanizeRule('FREQ=DAILY')).toBe('denně')
    expect(humanizeRule('FREQ=WEEKLY;BYDAY=FR')).toBe('týdně (pá)')
    expect(humanizeRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')).toBe('každé 2 týdny (po)')
    expect(humanizeRule('FREQ=MONTHLY;BYMONTHDAY=15')).toBe('měsíčně 15.')
    expect(humanizeRule('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=5')).toBe('čtvrtletně 5.')
    expect(humanizeRule('FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=15')).toBe('ročně 15. 9.')
  })
})

describe('deterministicUuid', () => {
  it('je stabilní a má tvar UUID', async () => {
    const a = await deterministicUuid('tpl', 'client1', 'item1', '2026-08-01')
    const b = await deterministicUuid('tpl', 'client1', 'item1', '2026-08-01')
    const c = await deterministicUuid('tpl', 'client1', 'item1', '2026-08-02')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('části pravidla (frekvence + den)', () => {
  it('kolečko části → pravidlo → části nic neztratí', () => {
    const p = { preset: 'weekly' as const, byday: ['TH', 'MO'], dom: 1, month: 1 }
    const rule = ruleFromParts(p)
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=MO,TH') // v pořadí týdne, ne ťukání
    expect(partsFromRule(rule)?.byday).toEqual(['MO', 'TH'])
    expect(partsFromRule('FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=14')).toEqual({ preset: 'yearly', byday: ['MO'], dom: 14, month: 9 })
    expect(partsFromRule('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=5')?.preset).toBe('quarterly')
  })

  it('pravidlo mimo předvolby vrátí null a nechá se být', () => {
    expect(partsFromRule('FREQ=WEEKLY;INTERVAL=3;BYDAY=FR')).toBeNull()
  })

  it('každou neděli: první výskyt od středy je nejbližší neděle', () => {
    expect(firstOccurrenceFrom('FREQ=WEEKLY;BYDAY=SU', '2026-09-09')).toBe('2026-09-13')
    // den, který pravidlo trefuje, je výskyt sám
    expect(firstOccurrenceFrom('FREQ=WEEKLY;BYDAY=WE', '2026-09-09')).toBe('2026-09-09')
    expect(firstOccurrenceFrom('FREQ=MONTHLY;BYMONTHDAY=1', '2026-09-09')).toBe('2026-10-01')
  })

  it('termín se srovná na první výskyt od dneška', () => {
    const dnes = '2026-09-09' // středa
    expect(alignDueDate('FREQ=WEEKLY;BYDAY=SU', '2026-09-09', dnes)).toBe('2026-09-13')
    // propadlý termín nezůstává v minulosti
    expect(alignDueDate('FREQ=WEEKLY;BYDAY=SU', '2026-08-30', dnes)).toBe('2026-09-13')
    // vzdálený termín, který pravidlo trefuje, zůstane
    expect(alignDueDate('FREQ=WEEKLY;BYDAY=SU', '2026-10-25', dnes)).toBe('2026-10-25')
    // bez termínu → první výskyt od dneška
    expect(alignDueDate('FREQ=DAILY', undefined, dnes)).toBe(dnes)
  })

  it('respawn po neděli trefí zase neděli, i u dvou dnů v týdnu', () => {
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=SU', '2026-09-13', '2026-09-13')).toBe('2026-09-20')
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=MO,TH', '2026-09-14', '2026-09-14')).toBe('2026-09-17')
  })
})
