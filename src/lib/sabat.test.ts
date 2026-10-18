import { describe, expect, it } from 'vitest'
import {
  casPraha,
  denVTydnu,
  jeSabat,
  konecPracePatek,
  oknoSabatu,
  patecniUzaverka,
  vetaSabatu,
  zacatekUzaverky,
  zapadSlunce,
} from './sabat'

// Okamžik z pražského místního času (testy nesmí záviset na pásmu stroje).
const praha = (den: string, cas: string, letni: boolean) =>
  Date.parse(`${den}T${cas}:00${letni ? '+02:00' : '+01:00'}`)

const minuty = (hm: string) => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

describe('západ slunce v Praze', () => {
  // Hodnoty z tabulek pro Prahu. „Zhruba" stačí — tři minuty jsou v tom.
  it.each([
    ['2026-06-21', '21:15'],
    ['2026-12-21', '16:02'],
    ['2026-03-20', '18:11'],
    ['2026-10-16', '18:10'],
  ])('%s zapadá kolem %s', (den, ocekavany) => {
    expect(Math.abs(minuty(casPraha(zapadSlunce(den))) - minuty(ocekavany))).toBeLessThanOrEqual(3)
  })

  // Juliánské datum od poledne místo od půlnoci posune výpočet o den.
  it('je to západ TOHO dne, ne následujícího', () => {
    const z = zapadSlunce('2026-10-16')
    expect(new Date(z).toISOString().slice(0, 10)).toBe('2026-10-16')
  })

  it('po přechodu na zimní čas zapadá o hodinu dřív na hodinách', () => {
    expect(casPraha(zapadSlunce('2026-10-24')).startsWith('17:')).toBe(true)
    expect(casPraha(zapadSlunce('2026-10-26')).startsWith('16:')).toBe(true)
  })
})

describe('okno šabatu', () => {
  it('pátek a sobota sdílejí jedno okno, ostatní dny žádné', () => {
    expect(denVTydnu('2026-10-16')).toBe(5)
    const patek = oknoSabatu('2026-10-16')
    expect(patek).toEqual(oknoSabatu('2026-10-17'))
    expect(patek!.od).toBe(zapadSlunce('2026-10-16'))
    expect(patek!.do).toBe(zapadSlunce('2026-10-17'))
    expect(oknoSabatu('2026-10-15')).toBeNull()
    expect(oknoSabatu('2026-10-18')).toBeNull()
  })

  it('platí od pátečního západu do sobotního', () => {
    expect(jeSabat('2026-10-16', praha('2026-10-16', '17:30', true))).toBe(false)
    expect(jeSabat('2026-10-16', praha('2026-10-16', '18:30', true))).toBe(true)
    expect(jeSabat('2026-10-17', praha('2026-10-17', '09:00', true))).toBe(true)
    expect(jeSabat('2026-10-17', praha('2026-10-17', '18:30', true))).toBe(false)
    expect(jeSabat('2026-10-18', praha('2026-10-18', '09:00', true))).toBe(false)
  })
})

describe('věta k pátku a sobotě', () => {
  it('na den dopředu říká, kdy klid začíná a kdy končí', () => {
    expect(vetaSabatu('2026-10-16')).toBe(`od ${casPraha(zapadSlunce('2026-10-16'))} šabat`)
    expect(vetaSabatu('2026-10-17')).toBe(`šabat · práce až po ${casPraha(zapadSlunce('2026-10-17'))}`)
    expect(vetaSabatu('2026-10-15')).toBeNull()
  })

  it('dnes mluví o tom, co platí teď — a po sobotním západu mlčí', () => {
    expect(vetaSabatu('2026-10-16', praha('2026-10-16', '19:00', true))).toMatch(/^šabat · do zítřka /)
    expect(vetaSabatu('2026-10-17', praha('2026-10-17', '10:00', true))).toMatch(/^šabat · práce až po /)
    expect(vetaSabatu('2026-10-17', praha('2026-10-17', '19:00', true))).toBeNull()
  })
})

describe('pátek', () => {
  // V zimě zapadá kolem čtvrté — uzávěrka v 16:00 by přišla po začátku šabatu.
  it('uzávěrka se v zimě posune před západ, v létě zůstane v 16:00', () => {
    expect(zacatekUzaverky('2026-12-18')).toBeLessThan(minuty(casPraha(zapadSlunce('2026-12-18'))))
    expect(zacatekUzaverky('2026-12-18')).toBeLessThan(16 * 60)
    expect(zacatekUzaverky('2026-06-19')).toBe(16 * 60)
    expect(zacatekUzaverky('2026-12-17')).toBe(16 * 60)
  })

  it('práce v pátek končí západem slunce, jindy pracovní doba platí', () => {
    expect(konecPracePatek('2026-12-18')).toBe(minuty(casPraha(zapadSlunce('2026-12-18'))))
    expect(konecPracePatek('2026-12-17')).toBeUndefined()
  })

  it('serverová uzávěrka odejde nejpozději hodinu před západem', () => {
    const bezne = Date.parse('2026-12-18T15:30:00Z')
    expect(patecniUzaverka('2026-12-18', bezne)).toBe(zapadSlunce('2026-12-18') - 3_600_000)
    const leto = Date.parse('2026-06-19T15:30:00Z')
    expect(patecniUzaverka('2026-06-19', leto)).toBe(leto)
  })
})

// Páteční uzávěrku posílá cron úloha `reminders-shutdown-patek`, která
// běží jen 14:00–15:45 UTC (`*/15 14-15 * * 5`). Cíl musí do toho okna
// padnout každý pátek v roce — jinak by uzávěrka ten den tiše vypadla.
it('páteční uzávěrka padne každý pátek do okna cron úlohy', () => {
  let patek = '2026-01-02'
  for (let i = 0; i < 53; i++) {
    const cil = patecniUzaverka(patek, Date.parse(`${patek}T15:30:00Z`))
    const utc = new Date(cil).getUTCHours() * 60 + new Date(cil).getUTCMinutes()
    expect(utc, patek).toBeGreaterThanOrEqual(14 * 60)
    expect(utc, patek).toBeLessThan(16 * 60)
    expect(cil, patek).toBeLessThan(zapadSlunce(patek))
    patek = new Date(Date.parse(`${patek}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10)
  }
})
