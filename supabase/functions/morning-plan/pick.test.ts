import { describe, expect, it } from 'vitest'
import {
  type Rec,
  type Rozhodnuti,
  type Scored,
  historieZPlanu,
  IGNOROVANI_STROP,
  ohodnot,
  pametUkolu,
  pickSuggestions,
  scoreAndReason,
  TOTAL,
  UNDATED_MAX,
  ZTRATA_ZA_IGNOROVANI,
  ZTRATA_ZA_ODMITNUTI,
} from './pick.ts'

const TODAY = '2026-08-31'
const NO_CLIENTS = new Map<string, Rec>()

let seq = 0
const task = (t: Partial<Rec> = {}): Rec => ({
  id: `t${++seq}`,
  title: `úkol ${seq}`,
  status: 'inbox',
  priority: 'normal',
  createdAt: `${TODAY}T08:00:00.000Z`,
  ...t,
})

const scored = (tasks: Rec[]): Scored[] =>
  tasks.map((t) => ({ t, ...scoreAndReason(t, NO_CLIENTS, TODAY) }))

const prios = (picked: Scored[]) => picked.map((p) => p.t.priority)

describe('skórování úkolu bez termínu', () => {
  it('projde filtrem score > 0 i s normální prioritou', () => {
    // Jádro věci: dřív dostal za datum nulu, takže se nikdy nenabídl.
    expect(scoreAndReason(task(), NO_CLIENTS, TODAY).score).toBeGreaterThan(0)
  })

  it('projde i s nízkou prioritou, která bere bod', () => {
    expect(scoreAndReason(task({ priority: 'low' }), NO_CLIENTS, TODAY).score).toBeGreaterThan(0)
  })

  it('vyšší priorita skóruje výš', () => {
    const s = (p: string) => scoreAndReason(task({ priority: p }), NO_CLIENTS, TODAY).score
    expect(s('critical')).toBeGreaterThan(s('high'))
    expect(s('high')).toBeGreaterThan(s('normal'))
    expect(s('normal')).toBeGreaterThan(s('low'))
  })

  it('ležák stárnutím předběhne čerstvý úkol téže priority', () => {
    const stary = task({ createdAt: '2026-08-01T08:00:00.000Z' })
    const novy = task()
    expect(scoreAndReason(stary, NO_CLIENTS, TODAY).score).toBeGreaterThan(
      scoreAndReason(novy, NO_CLIENTS, TODAY).score,
    )
  })

  it('u ležáku řekne, jak dlouho leží; u čerstvého jen že nemá termín', () => {
    expect(scoreAndReason(task({ createdAt: '2026-08-01T08:00:00.000Z' }), NO_CLIENTS, TODAY).reason)
      .toBe('bez termínu, leží tu 30 dní')
    expect(scoreAndReason(task(), NO_CLIENTS, TODAY).reason).toBe('nemá termín')
  })

  it('rozbitý createdAt nespadne ani nezkreslí skóre', () => {
    expect(scoreAndReason(task({ createdAt: 'nesmysl' }), NO_CLIENTS, TODAY).score).toBeGreaterThan(0)
  })
})

describe('výběr návrhů', () => {
  it('úkoly bez termínu se nabídnou, i když je dost úkolů s termínem', () => {
    const sTerminem = Array.from({ length: 10 }, () =>
      task({ status: 'active', dueDate: TODAY, clientId: `c${++seq}` }),
    )
    const bezTerminu = [task(), task(), task()]
    const picked = pickSuggestions(scored([...sTerminem, ...bezTerminu]))

    expect(picked).toHaveLength(TOTAL)
    const bez = picked.filter((p) => !p.t.dueDate)
    expect(bez.length).toBeGreaterThanOrEqual(2) // rezervované sloty
  })

  it('nabídka bez termínu je vážená prioritou — víc těch nejvyšších', () => {
    const bezTerminu = [
      ...Array.from({ length: 4 }, () => task({ priority: 'critical' })),
      ...Array.from({ length: 4 }, () => task({ priority: 'high' })),
      ...Array.from({ length: 4 }, () => task({ priority: 'normal' })),
      ...Array.from({ length: 4 }, () => task({ priority: 'low' })),
    ]
    const picked = pickSuggestions(scored(bezTerminu))
    const p = prios(picked)

    expect(picked).toHaveLength(UNDATED_MAX)
    expect(p.filter((x) => x === 'critical').length).toBeGreaterThanOrEqual(2)
    // nízká priorita se do plné nabídky vyšších už nevejde
    expect(p).not.toContain('low')
  })

  it('bez kritických nabídku vyplní nižší priority, ne prázdno', () => {
    const picked = pickSuggestions(
      scored(Array.from({ length: 6 }, () => task({ priority: 'normal' }))),
    )
    expect(picked).toHaveLength(UNDATED_MAX)
    expect(prios(picked).every((x) => x === 'normal')).toBe(true)
  })

  it('jediný úkol bez termínu se nabídne taky', () => {
    expect(pickSuggestions(scored([task({ priority: 'low' })]))).toHaveLength(1)
  })

  it('drží pestrost — nejvýš dva úkoly od jednoho klienta', () => {
    const picked = pickSuggestions(
      scored(Array.from({ length: 6 }, () => task({ clientId: 'stejny' }))),
    )
    expect(picked).toHaveLength(2)
  })

  it('ale úkoly bez klienta ten strop nesdílejí', () => {
    // Vlastní úkoly bez klienta spolu nesouvisí; kdyby padly pod jeden klíč,
    // nabídly by se vždycky jen dva, ať je inbox jakkoli plný.
    const picked = pickSuggestions(scored(Array.from({ length: 6 }, () => task())))
    expect(picked).toHaveLength(UNDATED_MAX)
  })

  it('naléhavé termíny nevytlačí úplně, jen ustoupí o rezervu', () => {
    const poTerminu = Array.from({ length: 8 }, () =>
      task({ status: 'active', dueDate: '2026-08-20', clientId: `c${++seq}` }),
    )
    const picked = pickSuggestions(scored([...poTerminu, task(), task()]))
    expect(picked.filter((p) => p.t.dueDate)).toHaveLength(TOTAL - 2)
  })

  it('nic k nabídnutí = prázdný návrh', () => {
    expect(pickSuggestions([])).toHaveLength(0)
  })
})

const plan = (date: string, suggestions: Array<[string, string]>): Rec => ({
  id: `p-${date}`,
  date,
  suggestions: suggestions.map(([taskId, decision]) => ({ taskId, decision, reason: '' })),
})

const rozhodnuti = (date: string, taskId: string, decision: string): Rozhodnuti => ({ date, taskId, decision })

describe('paměť návrhu — historie z plánů', () => {
  it('bere jen posledních 14 dní a ne dnešek', () => {
    const h = historieZPlanu(
      [
        plan('2026-08-30', [['a', 'rejected']]),
        plan('2026-08-17', [['b', 'ignored']]),
        plan('2026-08-16', [['c', 'ignored']]),
        plan(TODAY, [['d', 'ignored']]),
      ],
      TODAY,
    )
    expect(h.map((x) => x.taskId)).toEqual(['a', 'b'])
  })

  it('rozbitý plán přeskočí, chybějící rozhodnutí bere jako ignorované', () => {
    const h = historieZPlanu(
      [{ id: 'x', date: 'kdysi', suggestions: [{ taskId: 'a' }] }, { id: 'y', date: '2026-08-30', suggestions: [{ taskId: 'a' }, { nic: 1 }] }],
      TODAY,
    )
    expect(h).toEqual([{ date: '2026-08-30', taskId: 'a', decision: 'ignored' }])
  })
})

describe('paměť návrhu — jeden úkol', () => {
  it('bez historie nic nemění', () => {
    expect(pametUkolu('a', [], TODAY)).toEqual({ delta: 0, pauza: false })
  })

  it('jedno odmítnutí = odložit na zítra: nabídne se znovu, jen níž', () => {
    const p = pametUkolu('a', [rozhodnuti('2026-08-30', 'a', 'rejected')], TODAY)
    expect(p.pauza).toBe(false)
    expect(p.delta).toBe(-ZTRATA_ZA_ODMITNUTI)
  })

  it('dvě odmítnutí = týden pokoj', () => {
    const h = [rozhodnuti('2026-08-28', 'a', 'rejected'), rozhodnuti('2026-08-30', 'a', 'rejected')]
    expect(pametUkolu('a', h, TODAY).pauza).toBe(true)
    // po týdnu od posledního odmítnutí se vrací
    expect(pametUkolu('a', h, '2026-09-07').pauza).toBe(false)
  })

  it('ignorování ubírá po kouskách a má strop', () => {
    const h = Array.from({ length: IGNOROVANI_STROP + 3 }, (_, i) =>
      rozhodnuti(`2026-08-${String(20 + i).padStart(2, '0')}`, 'a', 'ignored'),
    )
    expect(pametUkolu('a', h.slice(0, 2), TODAY).delta).toBeCloseTo(-2 * ZTRATA_ZA_IGNOROVANI)
    expect(pametUkolu('a', h, TODAY).delta).toBeCloseTo(-IGNOROVANI_STROP * ZTRATA_ZA_IGNOROVANI)
  })

  it('rozhodnutí u jiných úkolů se nepletou', () => {
    const h = [rozhodnuti('2026-08-30', 'b', 'rejected'), rozhodnuti('2026-08-29', 'b', 'rejected')]
    expect(pametUkolu('a', h, TODAY)).toEqual({ delta: 0, pauza: false })
  })
})

describe('paměť návrhu — kandidáti', () => {
  it('dvakrát odmítnutý úkol se nenabídne', () => {
    const a = task({ id: 'a', dueDate: TODAY })
    const b = task({ id: 'b', dueDate: TODAY })
    const h = [rozhodnuti('2026-08-29', 'a', 'rejected'), rozhodnuti('2026-08-30', 'a', 'rejected')]
    expect(ohodnot([a, b], NO_CLIENTS, TODAY, h).map((c) => c.t.id)).toEqual(['b'])
  })

  it('ignorovaný úkol bez termínu ustoupí čerstvému téže priority', () => {
    const stary = task({ id: 'stary', createdAt: '2026-08-20T08:00:00.000Z' })
    const cerstvy = task({ id: 'cerstvy' })
    const bez = ohodnot([stary, cerstvy], NO_CLIENTS, TODAY)
    expect(bez[0].t.id).toBe('stary') // stárnutí ho dřív drželo nahoře
    const h = [rozhodnuti('2026-08-29', 'stary', 'ignored'), rozhodnuti('2026-08-30', 'stary', 'ignored')]
    const s = ohodnot([stary, cerstvy], NO_CLIENTS, TODAY, h).sort((x, y) => y.score - x.score)
    expect(s[0].t.id).toBe('cerstvy')
  })

  it('úkol s dnešním termínem ignorování nevyřadí', () => {
    const a = task({ id: 'a', dueDate: TODAY })
    const h = Array.from({ length: 6 }, (_, i) => rozhodnuti(`2026-08-2${i}`, 'a', 'ignored'))
    expect(ohodnot([a], NO_CLIENTS, TODAY, h)).toHaveLength(1)
  })

  it('hotové a zahozené úkoly se nenabízejí', () => {
    expect(ohodnot([task({ status: 'done', dueDate: TODAY }), task({ status: 'dropped', dueDate: TODAY })], NO_CLIENTS, TODAY)).toEqual([])
  })
})
