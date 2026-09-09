import { describe, expect, it } from 'vitest'
import { najdiOdkazy } from './links'

describe('najdiOdkazy', () => {
  it('vytáhne https odkaz i s cestou a popíše ho doménou', () => {
    expect(najdiOdkazy('schválit banner https://www.canva.com/design/abc/edit')).toEqual([
      { url: 'https://www.canva.com/design/abc/edit', popisek: 'canva.com' },
    ])
  })

  it('holé www. doplní o https', () => {
    expect(najdiOdkazy('viz www.example.com/brief')).toEqual([
      { url: 'https://www.example.com/brief', popisek: 'example.com' },
    ])
  })

  it('tečku, čárku a závorku za odkazem nechá větě', () => {
    expect(najdiOdkazy('podklady (https://docs.google.com/x), pak https://a.cz/b.').map((o) => o.url)).toEqual([
      'https://docs.google.com/x',
      'https://a.cz/b',
    ])
  })

  it('závorku, kterou odkaz sám otevřel, si nechá', () => {
    expect(najdiOdkazy('https://cs.wikipedia.org/wiki/Praha_(mesto)').map((o) => o.url)).toEqual([
      'https://cs.wikipedia.org/wiki/Praha_(mesto)',
    ])
  })

  it('bere víc textů najednou a stejný odkaz nezdvojí', () => {
    const r = najdiOdkazy('https://a.cz', 'poznámka https://a.cz a https://b.cz')
    expect(r.map((o) => o.url)).toEqual(['https://a.cz', 'https://b.cz'])
  })

  it('bez odkazu vrátí prázdno, i pro undefined', () => {
    expect(najdiOdkazy('jen text', undefined)).toEqual([])
    expect(najdiOdkazy('https://')).toEqual([])
  })
})
