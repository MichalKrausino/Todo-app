import { describe, expect, it } from 'vitest'
import {
  type Rec,
  addDaysISO,
  HLIDANI_VYCHOZI_DNI,
  type Rozhodnuti,
  type Scored,
  DUVOD_NAVRATU,
  historieZPlanu,
  IGNOROVANI_STROP,
  NAVRAT_BONUS,
  NAVRAT_MAX,
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

const plan = (date: string, suggestions: Array<[string, string]>, seenAt?: string): Rec => ({
  id: `p-${date}`,
  date,
  suggestions: suggestions.map(([taskId, decision]) => ({ taskId, decision, reason: '' })),
  ...(seenAt ? { seenAt } : {}),
})

// `videno` je ve výchozím stavu true: rozhodnutí v testu je vědomé,
// pokud test neříká opak. Ráno, které člověk neviděl, se zapisuje
// výslovně (`false`) — je to výjimka, ne norma.
const rozhodnuti = (date: string, taskId: string, decision: string, videno = true): Rozhodnuti => ({
  date,
  taskId,
  decision,
  videno,
})

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

  it('rozbitý plán přeskočí, chybějící rozhodnutí bere jako ignorované, den návratu přenese', () => {
    const h = historieZPlanu(
      [
        { id: 'x', date: 'kdysi', suggestions: [{ taskId: 'a' }] },
        { id: 'y', date: '2026-08-30', suggestions: [{ taskId: 'a' }, { nic: 1 }, { taskId: 'b', decision: 'snoozed', until: '2026-09-02' }, { taskId: 'c', decision: 'snoozed', until: 'brzy' }] },
      ],
      TODAY,
    )
    expect(h).toEqual([
      { date: '2026-08-30', taskId: 'a', decision: 'ignored', until: undefined, videno: true },
      { date: '2026-08-30', taskId: 'b', decision: 'snoozed', until: '2026-09-02', videno: true },
      { date: '2026-08-30', taskId: 'c', decision: 'snoozed', until: undefined, videno: true },
    ])
  })
})

describe('paměť návrhu — viděl to vůbec někdo', () => {
  // Měřeno na 44 ránech skutečného provozu: 21 z nich nedostalo ani
  // jednu odpověď a leželo v nich 85 % všech ignorovaných. Appka se
  // učila z toho, že byla zavřená.
  it('ráno bez jediné odpovědi a bez razítka se bere jako neviděné', () => {
    const h = historieZPlanu([plan('2026-08-30', [['a', 'ignored'], ['b', 'ignored']])], TODAY)
    expect(h.every((x) => x.videno)).toBe(false)
  })

  it('razítko z otevřeného panelu udělá ráno viděným, i když nikdo neodpověděl', () => {
    const h = historieZPlanu(
      [plan('2026-08-30', [['a', 'ignored']], '2026-08-30T06:12:00.000Z')],
      TODAY,
    )
    expect(h[0]).toMatchObject({ taskId: 'a', decision: 'ignored', videno: true })
  })

  it('odpověď na JINÝ úkol prozradí otevřený panel i u starých plánů bez razítka', () => {
    const h = historieZPlanu([plan('2026-08-30', [['a', 'ignored'], ['b', 'accepted']])], TODAY)
    expect(h.map((x) => [x.taskId, x.videno])).toEqual([['a', true], ['b', true]])
  })

  it('neviděné ignorování úkol netrestá — ani když jich je přes strop', () => {
    const neviděno = Array.from({ length: IGNOROVANI_STROP + 2 }, (_, i) =>
      rozhodnuti(`2026-08-${String(20 + i).padStart(2, '0')}`, 'a', 'ignored', false),
    )
    expect(pametUkolu('a', neviděno, TODAY).delta).toBe(0)
  })

  it('a viděné ignorování trestá dál — jinak by se appka neučila vůbec', () => {
    const videno = Array.from({ length: 2 }, (_, i) =>
      rozhodnuti(`2026-08-${String(20 + i).padStart(2, '0')}`, 'a', 'ignored'),
    )
    expect(pametUkolu('a', videno, TODAY).delta).toBeCloseTo(-2 * ZTRATA_ZA_IGNOROVANI)
  })

  it('odmítnutí platí bez ohledu na razítko — je to vědomá odpověď', () => {
    const p = pametUkolu('a', [rozhodnuti('2026-08-30', 'a', 'rejected', false)], TODAY)
    expect(p.delta).toBeCloseTo(-ZTRATA_ZA_ODMITNUTI)
  })
})

describe('paměť návrhu — jeden úkol', () => {
  it('bez historie nic nemění', () => {
    expect(pametUkolu('a', [], TODAY)).toEqual({ delta: 0, pauza: false, pauzaDo: undefined, navrat: false })
  })

  it('jedno odmítnutí = odložit na zítra: nabídne se znovu, jen níž', () => {
    const p = pametUkolu('a', [rozhodnuti('2026-08-30', 'a', 'rejected')], TODAY)
    expect(p.pauza).toBe(false)
    expect(p.delta).toBe(-ZTRATA_ZA_ODMITNUTI)
  })

  it('dvě odmítnutí = týden pokoj s viditelným datem návratu', () => {
    const h = [rozhodnuti('2026-08-28', 'a', 'rejected'), rozhodnuti('2026-08-30', 'a', 'rejected')]
    expect(pametUkolu('a', h, TODAY)).toEqual({ delta: 0, pauza: true, pauzaDo: '2026-09-06', navrat: false })
  })

  it('„až za týden" = týden pokoj rovnou', () => {
    const p = pametUkolu('a', [rozhodnuti('2026-08-30', 'a', 'snoozed')], TODAY)
    expect(p).toEqual({ delta: 0, pauza: true, pauzaDo: '2026-09-06', navrat: false })
  })

  it('odložení není zapomenutí: po pauze se tři rána vrací přednostně, pak zase běžně', () => {
    const h = [rozhodnuti('2026-08-30', 'a', 'snoozed')]
    for (const den of ['2026-09-06', '2026-09-07', '2026-09-08']) {
      const p = pametUkolu('a', h, den)
      expect(p.navrat).toBe(true)
      expect(p.delta).toBe(NAVRAT_BONUS)
      expect(p.pauzaDo).toBe('2026-09-06')
    }
    const po = pametUkolu('a', h, '2026-09-09')
    expect(po.navrat).toBe(false)
    expect(po.pauza).toBe(false)
  })

  it('další „dnes ne" po návratu = zase týden pokoj', () => {
    const h = [
      rozhodnuti('2026-08-20', 'a', 'rejected'),
      rozhodnuti('2026-08-21', 'a', 'rejected'),
      rozhodnuti('2026-08-28', 'a', 'rejected'), // po návratu 28. 8.
    ]
    expect(pametUkolu('a', h, TODAY)).toMatchObject({ pauza: true, pauzaDo: '2026-09-04' })
  })

  it('ignorování ubírá po kouskách a má strop', () => {
    const h = Array.from({ length: IGNOROVANI_STROP + 3 }, (_, i) =>
      rozhodnuti(`2026-08-${String(20 + i).padStart(2, '0')}`, 'a', 'ignored'),
    )
    expect(pametUkolu('a', h.slice(0, 2), TODAY).delta).toBeCloseTo(-2 * ZTRATA_ZA_IGNOROVANI)
    expect(pametUkolu('a', h, TODAY).delta).toBeCloseTo(-IGNOROVANI_STROP * ZTRATA_ZA_IGNOROVANI)
  })

  it('zvolený den návratu má přednost před pevným týdnem', () => {
    const h: Rozhodnuti[] = [{ date: '2026-08-30', taskId: 'a', decision: 'snoozed', until: '2026-09-02' }]
    expect(pametUkolu('a', h, TODAY)).toMatchObject({ pauza: true, pauzaDo: '2026-09-02' })
    expect(pametUkolu('a', h, '2026-09-02')).toMatchObject({ navrat: true })
    // i u pauzy po druhém odmítnutí — a nesmyslný (dřívější) den se ignoruje
    const r: Rozhodnuti[] = [
      { date: '2026-08-28', taskId: 'a', decision: 'rejected' },
      { date: '2026-08-30', taskId: 'a', decision: 'rejected', until: '2026-09-03' },
    ]
    expect(pametUkolu('a', r, TODAY).pauzaDo).toBe('2026-09-03')
    const spatne: Rozhodnuti[] = [{ date: '2026-08-30', taskId: 'a', decision: 'snoozed', until: '2026-08-01' }]
    expect(pametUkolu('a', spatne, TODAY).pauzaDo).toBe('2026-09-06')
  })

  it('rozhodnutí u jiných úkolů se nepletou', () => {
    const h = [rozhodnuti('2026-08-30', 'b', 'rejected'), rozhodnuti('2026-08-29', 'b', 'rejected')]
    expect(pametUkolu('a', h, TODAY)).toMatchObject({ delta: 0, pauza: false })
  })
})

describe('paměť návrhu — kandidáti', () => {
  it('odpočívající úkol se nenabídne', () => {
    const a = task({ id: 'a', dueDate: TODAY })
    const b = task({ id: 'b', dueDate: TODAY })
    const h = [rozhodnuti('2026-08-29', 'a', 'rejected'), rozhodnuti('2026-08-30', 'a', 'rejected')]
    expect(ohodnot([a, b], NO_CLIENTS, TODAY, h).map((c) => c.t.id)).toEqual(['b'])
  })

  it('vracející se úkol nese důvod návratu a v návrhu stojí první, i před termíny', () => {
    const vraci = task({ id: 'vraci', priority: 'low' })
    const dnes = task({ id: 'dnes', dueDate: TODAY, priority: 'critical' })
    const h = [rozhodnuti('2026-08-24', 'vraci', 'snoozed')] // pauza do 31. 8. = TODAY
    const kandidati = ohodnot([dnes, vraci], NO_CLIENTS, TODAY, h)
    expect(kandidati.find((c) => c.t.id === 'vraci')?.reason).toBe(DUVOD_NAVRATU)
    expect(pickSuggestions(kandidati).map((c) => c.t.id)).toEqual(['vraci', 'dnes'])
  })

  it('návratů je za ráno nejvýš NAVRAT_MAX, zbytek počká na další ráno', () => {
    const tasks = Array.from({ length: NAVRAT_MAX + 2 }, (_, i) => task({ id: `v${i}` }))
    const h = tasks.map((t) => rozhodnuti('2026-08-24', t.id as string, 'snoozed'))
    const picked = pickSuggestions(ohodnot(tasks, NO_CLIENTS, TODAY, h))
    expect(picked.filter((c) => c.navrat)).toHaveLength(NAVRAT_MAX)
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

// Hlídání ticha u klienta má výchozí práh (HLIDANI_VYCHOZI_DNI) — appka
// i server musí říkat totéž. Kdyby ho měla jen appka, ukazoval by řádek
// klienta „ticho 45 dní" a ranní návrh by o tom klientovi mlčel.
describe('ticho u klienta', () => {
  const klient = (c: Partial<Rec> = {}): Map<string, Rec> =>
    new Map([['k1', { id: 'k1', name: 'Alza', kind: 'client', ...c }]])
  const ukol = () => task({ clientId: 'k1' })
  const tichoOd = (dni: number) => addDaysISO(TODAY, -dni)

  it('klient bez nastaveného intervalu se po výchozím prahu ozve', () => {
    const r = scoreAndReason(
      ukol(),
      klient({ lastActivityAt: `${tichoOd(HLIDANI_VYCHOZI_DNI + 1)}T08:00:00.000Z` }),
      TODAY,
    )
    expect(r.reason).toBe(`u klienta Alza se ${HLIDANI_VYCHOZI_DNI + 1} dní nic nedělo`)
  })

  it('pod prahem mlčí', () => {
    const r = scoreAndReason(
      ukol(),
      klient({ lastActivityAt: `${tichoOd(HLIDANI_VYCHOZI_DNI)}T08:00:00.000Z` }),
      TODAY,
    )
    expect(r.reason).not.toMatch(/nic nedělo/)
  })

  it('oblast se nehlídá — „Osobní" není vztah, který může utichnout', () => {
    const r = scoreAndReason(
      ukol(),
      klient({ kind: 'personal', name: 'Osobní', lastActivityAt: `${tichoOd(45)}T08:00:00.000Z` }),
      TODAY,
    )
    expect(r.reason).not.toMatch(/nic nedělo/)
  })

  it('vlastní interval se ctí i u oblasti — kdo si ho nastavil, rozhodl se', () => {
    const r = scoreAndReason(
      ukol(),
      klient({
        kind: 'internal',
        name: 'Interní',
        checkIntervalDays: 3,
        lastActivityAt: `${tichoOd(5)}T08:00:00.000Z`,
      }),
      TODAY,
    )
    expect(r.reason).toBe('u klienta Interní se 5 dní nic nedělo')
  })

  it('nula je vědomé vypnuto, ne „hlídej po výchozím prahu"', () => {
    const r = scoreAndReason(
      ukol(),
      klient({ checkIntervalDays: 0, lastActivityAt: `${tichoOd(45)}T08:00:00.000Z` }),
      TODAY,
    )
    expect(r.reason).not.toMatch(/nic nedělo/)
  })

  it('a bez razítka aktivity se nehlídá nic', () => {
    expect(scoreAndReason(ukol(), klient(), TODAY).reason).not.toMatch(/nic nedělo/)
  })
})
