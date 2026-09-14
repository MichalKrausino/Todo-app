// Stavová řádka klienta. Pořadí částí je záměrné: na 320 px se řádka
// ořezává ZPRAVA, takže co je vlevo, to přežije. Audit rozhraní měří
// rozvržení, ne pořadí vět — bez tohohle testu se dá pořadí prohodit
// úpravou, kterou nikdo nezachytí.

import { describe, expect, it } from 'vitest'
import type { Client, Task } from '../db/types'
import { addDays, fromISODate, toISODate, todayISO } from './dates'
import { stavKlienta } from './clientStatus'

const DNES = todayISO()
const posun = (n: number) => toISODate(addDays(fromISODate(DNES), n))

const klient = (extra: Partial<Client> = {}): Client =>
  ({
    id: 'c1',
    name: 'Alza',
    color: '#007AFF',
    kind: 'client',
    status: 'active',
    templateIds: [],
    createdAt: '',
    updatedAt: '',
    ...extra,
  }) as Client

const ukol = (extra: Partial<Task> = {}): Task =>
  ({
    id: Math.random().toString(36).slice(2),
    title: 'x',
    status: 'active',
    priority: 'normal',
    order: 0,
    createdAt: '',
    updatedAt: '',
    ...extra,
  }) as Task

const texty = (casti: ReturnType<typeof stavKlienta>) => casti.map((c) => c.text)

describe('stav klienta', () => {
  it('bez úkolů řekne, že žádné nejsou', () => {
    expect(texty(stavKlienta(klient(), []))).toEqual(['žádné úkoly'])
  })

  it('úkoly bez termínu jsou „nic naplánováno"', () => {
    expect(texty(stavKlienta(klient(), [ukol()]))).toEqual(['nic naplánováno'])
  })

  it('propadlé hoří a nesou tón danger', () => {
    const casti = stavKlienta(klient(), [ukol({ dueDate: posun(-3) }), ukol({ dueDate: posun(-1) })])
    expect(casti[0]).toEqual({ text: '2 po termínu', tone: 'danger' })
  })

  it('nejbližší den se bere jen z toho, co teprve přijde', () => {
    // Dřív se do „nejbližšího dne" započítal i propadlý termín a řádek
    // ukazoval minulé datum — to se čte jako plán, ne jako průšvih.
    const casti = stavKlienta(klient(), [ukol({ dueDate: posun(-5) }), ukol({ dueDate: posun(1) })])
    expect(texty(casti)).toEqual(['1 po termínu', 'zítra'])
  })

  it('vedle propadlých se „nic naplánováno" neříká — je to hluk', () => {
    expect(texty(stavKlienta(klient(), [ukol({ dueDate: posun(-1) })]))).toEqual(['1 po termínu'])
  })

  it('scheduledFor vyhrává nad pozdějším dueDate', () => {
    const casti = stavKlienta(klient(), [ukol({ dueDate: posun(9), scheduledFor: posun(1) })])
    expect(texty(casti)).toEqual(['zítra'])
  })

  it('den je malými písmeny, ať stojí v řádce tiše', () => {
    const casti = stavKlienta(klient(), [ukol({ dueDate: posun(1) })])
    expect(casti[0].text).toBe('zítra')
    // Vzdálený den je datum, ne slovo — ale pořád malými.
    const daleko = stavKlienta(klient(), [ukol({ dueDate: posun(40) })])[0].text
    expect(daleko).toMatch(/\d+\./)
    expect(daleko).toBe(daleko.toLowerCase())
  })

  it('ticho nese tón note a stojí hned za propadlými', () => {
    const c = klient({ checkIntervalDays: 7, lastActivityAt: `${posun(-12)}T09:00:00.000Z` })
    const casti = stavKlienta(c, [ukol({ dueDate: posun(-1) }), ukol({ dueDate: posun(3) })])
    expect(casti[0].tone).toBe('danger')
    expect(casti[1].tone).toBe('note')
    expect(casti[1].text).toMatch(/^ticho \d+ dní$/)
  })

  it('druh se hlásí u oblastí, ne u klienta', () => {
    expect(texty(stavKlienta(klient({ kind: 'client' }), []))).toEqual(['žádné úkoly'])
    expect(texty(stavKlienta(klient({ kind: 'internal' }), []))).toEqual(['žádné úkoly', 'Interní'])
    expect(texty(stavKlienta(klient({ kind: 'personal' }), []))).toEqual(['žádné úkoly', 'Osobní'])
  })

  it('pořadí je pořadí důležitosti — přívlastky jdou nakonec', () => {
    const c = klient({
      kind: 'internal',
      checkIntervalDays: 5,
      lastActivityAt: `${posun(-20)}T09:00:00.000Z`,
    })
    const casti = stavKlienta(
      c,
      [ukol({ dueDate: posun(-2) }), ukol({ dueDate: posun(1) })],
      { sdileno: true, todoist: true },
    )
    expect(texty(casti)).toEqual([
      '1 po termínu',
      casti[1].text, // ticho N dní — počet závisí na dnešku
      'zítra',
      'Interní',
      'sdíleno',
      'Todoist',
    ])
    expect(casti[1].text).toMatch(/^ticho /)
  })

  it('ticho mlčí, dokud klient nemá nastavený interval kontroly', () => {
    const c = klient({ lastActivityAt: `${posun(-99)}T09:00:00.000Z` })
    expect(texty(stavKlienta(c, []))).toEqual(['žádné úkoly'])
  })
})
