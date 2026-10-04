import { describe, expect, it } from 'vitest'
import type { Task } from '../db/types'
import { nabidka, potrebujeZpresneni, pouzij, zadaniPro, type Platnost } from './zpresneni'

const zaklad = { title: 'po schůzce připravit 3 varianty banneru a poslat Benovi', clientId: 'c1', priority: 'normal' as const }
const ukol = (o: Partial<Task> = {}): Task => ({
  id: 't1',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  title: zaklad.title,
  clientId: 'c1',
  priority: 'normal',
  status: 'inbox',
  order: 0,
  zadani: { text: 'po schůzce s Panelorou připravit 3 varianty banneru a poslat Benovi', zaklad },
  ...o,
})
const P: Platnost = {
  klienti: new Set(['c1', 'c2']),
  projekty: new Map([['p1', 'c1'], ['p2', 'c2']]),
  lzePredat: (_k, komu) => komu === 'u-ben',
  dnes: '2026-10-01',
}

describe('potrebujeZpresneni', () => {
  it('krátký název parser zvládl, dlouhý zbytek ne', () => {
    expect(potrebujeZpresneni('Zavolat Pavlovi')).toBe(false)
    expect(potrebujeZpresneni(zaklad.title)).toBe(true)
  })
  // „…ať to udělá Ben" je krátké, ale je to předání, a to parser nezná.
  it('jméno kolegy v textu stačí i u krátkého názvu (i skloňované)', () => {
    expect(potrebujeZpresneni('banner ať udělá Ben', ['ben'])).toBe(true)
    expect(potrebujeZpresneni('poslat Benovi report', ['ben'])).toBe(true)
    expect(potrebujeZpresneni('Benzín do auta', ['ben'])).toBe(true) // radši zeptat zbytečně než nikdy
    expect(potrebujeZpresneni('Objednat benzín', [])).toBe(false)
  })
  it('zadaniPro: nic pro krátký úkol, prázdný či obří text', () => {
    expect(zadaniPro('Zavolat Pavlovi', { title: 'Zavolat Pavlovi', priority: 'normal' })).toBeUndefined()
    expect(zadaniPro('x'.repeat(700), zaklad)).toBeUndefined()
    expect(zadaniPro('  text  ', zaklad)?.text).toBe('text')
  })
})

describe('nabidka', () => {
  it('nabídne jen to, co se liší od úkolu', () => {
    const z = nabidka(ukol(), { nazev: 'Připravit 3 varianty banneru', termin: '2026-10-02', projektId: 'p1', kroky: ['a', 'b'] }, P)
    expect(z.map((x) => x.pole)).toEqual(['nazev', 'projekt', 'termin', 'kroky'])
  })

  // Hlavní pojistka: co člověk změnil sám (třeba offline na druhém
  // zařízení, než návrh dorazil), návrh už nepřebije.
  it('ručně změněné pole se nenabízí', () => {
    const t = ukol({ title: 'Banner pro Panelora', dueDate: '2026-10-05', priority: 'high' })
    const z = nabidka(t, { nazev: 'Připravit banner', termin: '2026-10-02', priorita: 'critical' }, P)
    expect(z).toEqual([])
  })

  it('projekt cizího klienta se nenabízí, když klient na úkolu je ruční', () => {
    const t = ukol({ clientId: 'c1', zadani: { text: 'x', zaklad: { ...zaklad, clientId: undefined } } })
    expect(nabidka(t, { projektId: 'p2' }, P)).toEqual([])
  })

  it('projekt přinese klienta, když úkol žádného nemá', () => {
    const t = ukol({ clientId: undefined, zadani: { text: 'x', zaklad: { ...zaklad, clientId: undefined } } })
    expect(nabidka(t, { projektId: 'p2' }, P)).toEqual([
      { pole: 'klient', hodnota: 'c2' },
      { pole: 'projekt', hodnota: 'p2' },
    ])
  })

  it('smazaný projekt, cizí člověk a minulý termín se nenabízí', () => {
    const z = nabidka(ukol(), { projektId: 'p9', komu: 'u-jana', termin: '2026-09-01' }, P)
    expect(z).toEqual([])
  })

  it('předání jen bez přidělení a kroky jen do prázdného checklistu', () => {
    expect(nabidka(ukol(), { komu: 'u-ben' }, P)).toEqual([{ pole: 'komu', hodnota: 'u-ben' }])
    expect(nabidka(ukol({ assignedTo: 'u-x' }), { komu: 'u-ben' }, P)).toEqual([])
    expect(nabidka(ukol({ subtasks: [{ id: 's', title: 'a', done: false }] }), { kroky: ['x', 'y'] }, P)).toEqual([])
  })

  it('úkol z Todoistu, hotový nebo bez zadání nenabízí nic', () => {
    const n = { nazev: 'Jiný název' }
    expect(nabidka(ukol({ todoistId: '1' }), n, P)).toEqual([])
    expect(nabidka(ukol({ status: 'done' }), n, P)).toEqual([])
    expect(nabidka(ukol({ zadani: undefined }), n, P)).toEqual([])
  })

  it('čas jen s termínem', () => {
    expect(nabidka(ukol(), { cas: '10:00' }, P)).toEqual([])
    expect(nabidka(ukol(), { cas: '10:00', termin: '2026-10-03' }, P).map((x) => x.pole)).toEqual(['termin', 'cas'])
  })
})

describe('pouzij', () => {
  it('přijetí i zahození smaže zadání — nabídka zmizí na všech zařízeních', () => {
    expect(pouzij(ukol(), [])).toEqual({ zadani: undefined })
  })

  it('termín vytáhne úkol z inboxu, předání úkol nasdílí, kroky dostanou id', () => {
    const p = pouzij(ukol({ sharedWith: ['u-x'] }), [
      { pole: 'termin', hodnota: '2026-10-02' },
      { pole: 'komu', hodnota: 'u-ben' },
      { pole: 'kroky', hodnota: ['a', 'b'] },
    ])
    expect(p.dueDate).toBe('2026-10-02')
    expect(p.status).toBe('active')
    expect(p.assignedTo).toBe('u-ben')
    expect(p.sharedWith).toEqual(['u-x', 'u-ben'])
    expect(p.subtasks?.map((s) => [s.title, s.done, typeof s.id])).toEqual([['a', false, 'string'], ['b', false, 'string']])
  })
})
