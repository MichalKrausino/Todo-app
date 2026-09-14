// Rozpad projektu na kroky. Testy hlídají hlavně to, co by z funkce
// udělalo hluk: falešnou podobnost (dva projekty jednoho klienta), duplicitu
// s tím, co v projektu už je, a nabídku tam, kde se nic nepodobá.

import { describe, expect, it } from 'vitest'
import { PRAH_SHODY, STROP_KROKU, navrhniKroky, shoda, slova, type ZdrojProjekt } from './rozpad'

const projekt = (name: string, ukoly: string[], extra: Partial<ZdrojProjekt> = {}): ZdrojProjekt => ({
  id: name,
  name,
  ukoly,
  ...extra,
})

describe('slova', () => {
  it('sundá diakritiku, spojky a interpunkci', () => {
    expect([...slova('Kampaň pro Vánoce 2026!')]).toEqual(['kampan', 'vanoce', '2026'])
  })

  it('vyškrtne jména klientů, ať se porovnává práce, ne zákazník', () => {
    expect([...slova('Rebranding webu Alza', ['Alza'])]).toEqual(['rebranding', 'webu'])
  })

  it('jméno klienta o víc slovech taky', () => {
    expect([...slova('SEO pro V Bílém', ['V Bílém'])]).toEqual(['seo'])
  })
})

describe('shoda jmen', () => {
  it('delší jméno téhož projektu není jiný projekt', () => {
    // Proti Jaccardu: „Rebranding webu" ⊂ „Rebranding webu pro e-shop".
    expect(shoda(slova('Rebranding webu'), slova('Rebranding webu pro e-shop'))).toBe(1)
  })

  it('nic společného je nula', () => {
    expect(shoda(slova('Rebranding webu'), slova('Fakturace'))).toBe(0)
  })

  it('prázdné jméno se nepodobá ničemu', () => {
    expect(shoda(new Set<string>(), slova('cokoliv'))).toBe(0)
  })
})

describe('návrh kroků', () => {
  const historie = [
    projekt('Rebranding webu', ['Analýza současného webu', 'Návrh vizuálu', 'Copy na podstránky'], {
      clientName: 'Alza',
    }),
    projekt('Fakturace Q3', ['Vystavit faktury', 'Odeslat přehled']),
  ]

  it('vezme kroky z podobného projektu a řekne, odkud jsou', () => {
    const kroky = navrhniKroky({ name: 'Rebranding webu pro Bosch' }, historie, [], ['Bosch', 'Alza'])
    expect(kroky.map((k) => k.title)).toEqual([
      'Analýza současného webu',
      'Návrh vizuálu',
      'Copy na podstránky',
    ])
    expect(kroky[0].duvod).toBe('podle „Rebranding webu" · Alza')
    expect(kroky[0].zdrojId).toBe('Rebranding webu')
  })

  it('u vlastního klienta se jméno vynechá — neříká nic', () => {
    // „· Alza" pod každým krokem na obrazovce klienta Alza jen třikrát
    // zopakuje, kde jsem. Smysl má teprve u kroků od někoho jiného.
    const kroky = navrhniKroky(
      { name: 'Rebranding webu pro e-shop', clientName: 'Alza' },
      historie,
      [],
      ['Alza'],
    )
    expect(kroky[0].duvod).toBe('podle „Rebranding webu"')
  })

  it('bez jména klienta se popisek nezlomí', () => {
    const kroky = navrhniKroky({ name: 'Fakturace Q4' }, historie, [], [])
    expect(kroky[0].duvod).toBe('podle „Fakturace Q3"')
  })

  it('když se nic nepodobá, nenabídne nic', () => {
    expect(navrhniKroky({ name: 'Focení produktů' }, historie, [], [])).toEqual([])
  })

  it('dva projekty téhož klienta nejsou příbuzné jen proto, že je klient týž', () => {
    // „PPC Alza" a „SEO Alza" sdílejí jen jméno klienta — to se vyškrtne.
    const h = [projekt('PPC Alza', ['Kontrola sestav'], { clientName: 'Alza' })]
    expect(navrhniKroky({ name: 'SEO Alza' }, h, [], ['Alza'])).toEqual([])
    // Bez vyškrtnutí klienta by to falešně sedlo — tím se pojistka ověří.
    expect(navrhniKroky({ name: 'SEO Alza' }, h, [], []).length).toBeGreaterThan(0)
  })

  it('co v projektu už je, se nenabízí znovu — ani s jinou diakritikou a velikostí', () => {
    const kroky = navrhniKroky(
      { name: 'Rebranding webu' },
      historie,
      ['NÁVRH VIZUÁLU', '  copy na podstránky  '],
      [],
    )
    expect(kroky.map((k) => k.title)).toEqual(['Analýza současného webu'])
  })

  it('týž krok ze dvou zdrojů se nabídne jednou', () => {
    const h = [
      projekt('Rebranding webu A', ['Návrh vizuálu', 'Copy']),
      projekt('Rebranding webu B', ['Návrh vizuálu', 'Testování']),
    ]
    expect(navrhniKroky({ name: 'Rebranding webu' }, h, [], []).map((k) => k.title)).toEqual([
      'Návrh vizuálu',
      'Copy',
      'Testování',
    ])
  })

  it('nejpodobnější projekt jde první', () => {
    const h = [
      projekt('Rebranding značky', ['Vzdálený krok']),
      projekt('Rebranding webu', ['Blízký krok']),
    ]
    const kroky = navrhniKroky({ name: 'Rebranding webu' }, h, [], [])
    expect(kroky[0].title).toBe('Blízký krok')
  })

  it('nabídka má strop — dvacet řádků není návrh, to je zase seznam', () => {
    const moc = projekt('Rebranding webu', Array.from({ length: 30 }, (_, i) => `Krok ${i}`))
    expect(navrhniKroky({ name: 'Rebranding webu' }, [moc], [], []).length).toBe(STROP_KROKU)
    expect(navrhniKroky({ name: 'Rebranding webu' }, [moc], [], [], 3).length).toBe(3)
  })

  it('projekt bez úkolů není zdroj', () => {
    expect(navrhniKroky({ name: 'Rebranding webu' }, [projekt('Rebranding webu', [])], [], [])).toEqual([])
  })

  it('projekt bez jména se neptá historie vůbec', () => {
    expect(navrhniKroky({ name: '   ' }, historie, [], [])).toEqual([])
  })

  it('do porovnání se počítá i cíl projektu', () => {
    const h = [projekt('Zimní kampaň', ['Brief', 'Kreativa'])]
    // Jméno samo nesedí, cíl ano.
    expect(navrhniKroky({ name: 'Prosinec', goal: 'Zimní kampaň na svíčky' }, h, [], []).length).toBe(2)
  })

  it('práh shody je poloviční překryv', () => {
    expect(PRAH_SHODY).toBe(0.5)
    const h = [projekt('Roční audit webu', ['Krok'])]
    // {audit, webu} ∩ {audit, kampani} = 1/2 → přesně na prahu, projde.
    expect(navrhniKroky({ name: 'Audit kampaní' }, h, [], []).length).toBe(1)
    // {report} ∩ {rocni, audit, webu} = 0 → neprojde.
    expect(navrhniKroky({ name: 'Report' }, h, [], []).length).toBe(0)
  })
})
