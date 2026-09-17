import { describe, expect, it } from 'vitest'
import { planPoZmeneTerminu } from './terminPlan'

describe('planPoZmeneTerminu', () => {
  it('přepsaný termín zahodí naplánování, kterého se nikdo nedotkl', () => {
    // Přesně ten případ ze skutečných dat: ranní návrh dal úkol na pátek,
    // člověk přepsal termín na neděli — a úkol zůstal viset na Dnes,
    // protože „kdy to je" bere dřívější z obou dat.
    expect(
      planPoZmeneTerminu({
        puvodniTermin: '2026-09-18',
        novyTermin: '2026-09-20',
        puvodniPlan: '2026-09-18',
        novyPlan: '2026-09-18',
      }),
    ).toBeUndefined()
  })

  it('zahodí i naplánování bez původního termínu', () => {
    // Úkol z ranního návrhu termín většinou vůbec nemá — dvanáct ze
    // třinácti ve skutečných datech. Přidat termín je proto ta nejběžnější
    // změna a musí platit stejně.
    expect(
      planPoZmeneTerminu({
        novyTermin: '2026-09-20',
        puvodniPlan: '2026-09-18',
        novyPlan: '2026-09-18',
      }),
    ).toBeUndefined()
  })

  it('zahodí i naplánování, které leží AŽ ZA novým termínem', () => {
    // Plán po termínu je propadlá práce, ne rozhodnutí. Pravidlo je jedno
    // pro obě strany, aby se nedalo splést, kdy platí.
    expect(
      planPoZmeneTerminu({
        puvodniTermin: '2026-09-30',
        novyTermin: '2026-09-20',
        puvodniPlan: '2026-09-25',
        novyPlan: '2026-09-25',
      }),
    ).toBeUndefined()
  })

  it('nechá naplánování, se kterým člověk v témže panelu sám pohnul', () => {
    // Dvě vědomá rozhodnutí vedle sebe: „termín je neděle, dělat to budu
    // v pátek." Do toho appka mluvit nemá.
    expect(
      planPoZmeneTerminu({
        puvodniTermin: '2026-09-18',
        novyTermin: '2026-09-20',
        puvodniPlan: '2026-09-18',
        novyPlan: '2026-09-19',
      }),
    ).toBe('2026-09-19')
  })

  it('nechá naplánování, když se termín nezměnil', () => {
    expect(
      planPoZmeneTerminu({
        puvodniTermin: '2026-09-20',
        novyTermin: '2026-09-20',
        puvodniPlan: '2026-09-18',
        novyPlan: '2026-09-18',
      }),
    ).toBe('2026-09-18')
  })

  it('nechá naplánování, když se termín SMAZAL', () => {
    // „Tohle nemá deadline" není „tohle je jindy" — den, který si na to
    // člověk vyhradil, tím neztrácí smysl.
    expect(
      planPoZmeneTerminu({
        puvodniTermin: '2026-09-20',
        novyTermin: '',
        puvodniPlan: '2026-09-18',
        novyPlan: '2026-09-18',
      }),
    ).toBe('2026-09-18')
  })

  it('bez naplánování nevrací nic', () => {
    expect(
      planPoZmeneTerminu({ puvodniTermin: '2026-09-18', novyTermin: '2026-09-20' }),
    ).toBeUndefined()
    expect(
      planPoZmeneTerminu({ novyTermin: '2026-09-20', puvodniPlan: '', novyPlan: '' }),
    ).toBeUndefined()
  })

  it('prázdný řetězec z pole je totéž co nevyplněno', () => {
    // Pole v detailu drží '' místo undefined; bez normalizace by
    // '' !== undefined vypadalo jako ruční změna a pravidlo by se nikdy
    // nespustilo.
    expect(
      planPoZmeneTerminu({
        puvodniTermin: '',
        novyTermin: '2026-09-20',
        puvodniPlan: '2026-09-18',
        novyPlan: '2026-09-18',
      }),
    ).toBeUndefined()
  })
})
