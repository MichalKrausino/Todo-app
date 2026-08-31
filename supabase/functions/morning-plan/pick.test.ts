import { describe, expect, it } from 'vitest'
import {
  type Rec,
  type Scored,
  pickSuggestions,
  scoreAndReason,
  TOTAL,
  UNDATED_MAX,
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
