import { describe, expect, it } from 'vitest'
import { estimateTaskMinutes } from './estimate'

describe('estimateTaskMinutes', () => {
  it('odhaduje podle druhu činnosti', () => {
    expect(estimateTaskMinutes('Zavolat Pepovi')).toBe(30)
    expect(estimateTaskMinutes('kontrola kampaní')).toBe(30)
    expect(estimateTaskMinutes('Poslat podklady klientovi')).toBe(30)
    expect(estimateTaskMinutes('Fakturace za červenec')).toBe(45)
    expect(estimateTaskMinutes('Schůzka s Acme')).toBe(60)
    expect(estimateTaskMinutes('Připravit měsíční report')).toBe(90)
    expect(estimateTaskMinutes('Napsat článek na blog')).toBe(90)
    expect(estimateTaskMinutes('SEO audit webu')).toBe(120)
    expect(estimateTaskMinutes('Analýza konkurence')).toBe(120)
  })

  it('funguje bez diakritiky a s velkými písmeny', () => {
    expect(estimateTaskMinutes('ZAVOLAT dodavateli')).toBe(30)
    expect(estimateTaskMinutes('pripravit navrh bannerů')).toBe(90)
  })

  it('výjimka: napsat zprávu / odpovědět je krátké', () => {
    expect(estimateTaskMinutes('Napsat zprávu klientovi')).toBe(30)
    expect(estimateTaskMinutes('Odpovědět na poptávku')).toBe(30)
  })

  it('report má přednost před „poslat"', () => {
    expect(estimateTaskMinutes('Poslat report klientovi')).toBe(90)
  })

  it('neznámá činnost → undefined (kalendář si vezme 60)', () => {
    expect(estimateTaskMinutes('Koupit mléko')).toBeUndefined()
  })
})
