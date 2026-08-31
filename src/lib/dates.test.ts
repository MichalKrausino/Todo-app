// Denní data stojí na místním čase (pravidlo č. 3 v CLAUDE.md), takže tyhle
// testy dávají smysl jen v pražském pásmu — `npm test` ho nastavuje.
// V UTC by většina z nich prošla i s rozbitým kódem, protože se místní
// a UTC den nikdy nerozejdou.
import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysSince,
  formatDayLabel,
  fromISODate,
  mondayOf,
  nextMonday,
  toISODate,
  todayISO,
} from './dates'

const iso = (s: string) => toISODate(fromISODate(s))

describe('převod dne tam a zpět', () => {
  it('zachová datum', () => {
    for (const d of ['2026-01-01', '2026-08-31', '2026-12-31']) expect(iso(d)).toBe(d)
  })

  it('doplní nuly u jednociferných hodnot', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('todayISO je místní den, ne UTC', () => {
    expect(todayISO()).toBe(toISODate(new Date()))
  })
})

describe('addDays přes přechod letního času', () => {
  // V roce 2026 se v EU přechází 29. 3. (den má 23 h) a 25. 10. (25 h).
  // Kdyby se dny přičítaly přes +86400000 ms, tady by to ujelo.
  it('den dopředu přes jarní posun', () => {
    expect(toISODate(addDays(fromISODate('2026-03-28'), 1))).toBe('2026-03-29')
    expect(toISODate(addDays(fromISODate('2026-03-29'), 1))).toBe('2026-03-30')
  })

  it('den dopředu přes podzimní posun', () => {
    expect(toISODate(addDays(fromISODate('2026-10-24'), 1))).toBe('2026-10-25')
    expect(toISODate(addDays(fromISODate('2026-10-25'), 1))).toBe('2026-10-26')
  })

  it('delší skok přes posun sedí taky', () => {
    expect(toISODate(addDays(fromISODate('2026-03-27'), 7))).toBe('2026-04-03')
    expect(toISODate(addDays(fromISODate('2026-10-20'), 30))).toBe('2026-11-19')
  })

  it('zpátky do minulosti i přes konec měsíce', () => {
    expect(toISODate(addDays(fromISODate('2026-03-01'), -1))).toBe('2026-02-28')
    expect(toISODate(addDays(fromISODate('2028-03-01'), -1))).toBe('2028-02-29') // přestupný
  })
})

describe('týdenní kotvy', () => {
  it('nextMonday z pondělí skočí na další, ne na dnešek', () => {
    expect(toISODate(nextMonday(fromISODate('2026-08-31')))).toBe('2026-09-07') // po
  })

  it('nextMonday z neděle je hned zítra', () => {
    expect(toISODate(nextMonday(fromISODate('2026-08-30')))).toBe('2026-08-31') // ne
  })

  it('mondayOf bere neděli k týdnu, který končí', () => {
    expect(mondayOf('2026-08-31')).toBe('2026-08-31') // pondělí samo
    expect(mondayOf('2026-09-06')).toBe('2026-08-31') // neděle
    expect(mondayOf('2026-09-02')).toBe('2026-08-31') // středa
  })
})

describe('daysSince', () => {
  const dnes = todayISO()

  it('noční aktivita patří dnešku, ne včerejšku', () => {
    // Regrese: razítka jsou UTC (`toISOString()`), a uříznutí na 10 znaků
    // hodilo všechno mezi místní půlnocí a 02:00 na předchozí den —
    // klient pak vyšel o den zanedbanější, než doopravdy byl.
    const rano = new Date(2026, 7, 31, 1, 0) // 31. 8. 2026, 01:00 místního
    expect(daysSince(rano.toISOString(), '2026-08-31')).toBe(0)
  })

  it('večerní aktivita zůstává týmž dnem', () => {
    const vecer = new Date(2026, 7, 31, 23, 30)
    expect(daysSince(vecer.toISOString(), '2026-08-31')).toBe(0)
  })

  it('počítá celé dny dozadu', () => {
    const pred = new Date(2026, 7, 21, 14, 0)
    expect(daysSince(pred.toISOString(), '2026-08-31')).toBe(10)
  })

  it('zvládne i holý den bez času', () => {
    expect(daysSince('2026-08-24', '2026-08-31')).toBe(7)
  })

  it('rozdíl přes přechod času nezkreslí hodinový posun', () => {
    const pred = new Date(2026, 9, 20, 12, 0) // 20. 10., ještě letní čas
    expect(daysSince(pred.toISOString(), '2026-10-30')).toBe(10)
  })

  it('nesmysl vrátí nulu, ne NaN', () => {
    expect(daysSince('rozbité', dnes)).toBe(0)
  })
})

describe('formatDayLabel', () => {
  const dnes = todayISO()

  it('pojmenuje včerejšek, dnešek a zítřek', () => {
    expect(formatDayLabel(dnes)).toBe('Dnes')
    expect(formatDayLabel(toISODate(addDays(fromISODate(dnes), 1)))).toBe('Zítra')
    expect(formatDayLabel(toISODate(addDays(fromISODate(dnes), -1)))).toBe('Včera')
  })

  it('vzdálenější den ukáže datem', () => {
    const daleko = toISODate(addDays(fromISODate(dnes), 10))
    const popisek = formatDayLabel(daleko)
    expect(popisek).not.toMatch(/Dnes|Zítra|Včera/)
    expect(popisek).toMatch(/\d/)
  })
})
