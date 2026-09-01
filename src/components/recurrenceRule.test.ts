// Pravidlo opakování v šabloně umí víc dnů v týdnu naráz („po, čt") —
// galerie takové šablony rovnou nabízí a parser je z „každý všední den"
// vyrábí taky. Výběr dnů s tím musí umět pracovat, jinak by první ťuknutí
// tiše zahodilo všechny dny kromě jednoho.
import { describe, expect, it } from 'vitest'
import { buildRule, bydayToSet, setToByday } from './RecurrencePicker'
import { humanizeRule } from '../lib/rrule'

describe('dny v týdnu v pravidle', () => {
  it('přečte jeden i víc dnů', () => {
    expect([...bydayToSet('MO')]).toEqual(['MO'])
    expect([...bydayToSet('MO,TH')].sort()).toEqual(['MO', 'TH'])
  })

  it('poskládá dny vždy v pořadí týdne, ne v pořadí klikání', () => {
    expect(setToByday(new Set(['TH', 'MO']))).toBe('MO,TH')
    expect(setToByday(new Set(['SU', 'WE', 'MO']))).toBe('MO,WE,SU')
  })

  it('prázdný seznam nevyrobí nesmyslné pravidlo', () => {
    expect(setToByday(new Set())).toBe('')
  })

  it('kolečko pravidlo → dny → pravidlo nic neztratí', () => {
    const pravidlo = 'FREQ=WEEKLY;BYDAY=MO,TH'
    const dny = bydayToSet(pravidlo.split('BYDAY=')[1])
    expect(buildRule('weekly', setToByday(dny), 1, 1)).toBe(pravidlo)
  })

  it('týdně v pondělí se popíše česky', () => {
    expect(humanizeRule(buildRule('weekly', 'MO', 1, 1))).toBe('týdně (po)')
    expect(humanizeRule(buildRule('biweekly', 'MO,TH', 1, 1))).toBe('každé 2 týdny (po, čt)')
  })
})
