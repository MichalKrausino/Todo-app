import { describe, expect, it } from 'vitest'
import {
  jeMuj,
  kdoMa,
  kratkaJmena,
  mojeUkoly,
  skupinyLidi,
  zavislaPrirazeni,
} from './tymUkoly'

const JA = 'u-ja'
const KOLEGA = 'u-kolega'

const u = (patch: { ownerId?: string; assignedTo?: string } = {}) => patch

describe('čí je úkol', () => {
  it('nepřihlášenému patří všechno — i řádky stažené dřív', () => {
    expect(jeMuj(u({ ownerId: KOLEGA, assignedTo: KOLEGA }), undefined)).toBe(true)
  })

  it('bez razítka i bez přiřazení je úkol můj (nesdílím, nebo ještě neodešel)', () => {
    expect(jeMuj(u(), JA)).toBe(true)
  })

  it('co jsem založil, je moje', () => {
    expect(jeMuj(u({ ownerId: JA }), JA)).toBe(true)
  })

  it('co založil kolega, moje není', () => {
    expect(jeMuj(u({ ownerId: KOLEGA }), JA)).toBe(false)
  })

  it('přiřazení přebíjí zakladatele — oběma směry', () => {
    expect(jeMuj(u({ ownerId: KOLEGA, assignedTo: JA }), JA)).toBe(true)
    expect(jeMuj(u({ ownerId: JA, assignedTo: KOLEGA }), JA)).toBe(false)
  })

  it('kdoMa vrací přiřazeného, jinak zakladatele, jinak mě', () => {
    expect(kdoMa(u({ ownerId: JA, assignedTo: KOLEGA }), JA)).toBe(KOLEGA)
    expect(kdoMa(u({ ownerId: KOLEGA }), JA)).toBe(KOLEGA)
    expect(kdoMa(u(), JA)).toBe(JA)
  })

  it('mojeUkoly vybere jen moje a pořadí nemění', () => {
    const list = [
      u({ ownerId: JA }),
      u({ ownerId: KOLEGA }),
      u({ ownerId: KOLEGA, assignedTo: JA }),
      u(),
    ]
    expect(mojeUkoly(list, JA)).toEqual([list[0], list[2], list[3]])
  })

  it('nepřihlášenému mojeUkoly nic neubere', () => {
    expect(mojeUkoly([u({ ownerId: KOLEGA })], undefined)).toHaveLength(1)
  })
})

describe('krátká jména', () => {
  it('bere část před zavináčem a před tečkou', () => {
    expect(kratkaJmena(['jana.novakova@firma.cz']).get('jana.novakova@firma.cz')).toBe('jana')
  })

  it('e-mail bez tečky zůstane celou místní částí', () => {
    expect(kratkaJmena(['michal@firma.cz']).get('michal@firma.cz')).toBe('michal')
  })

  it('dvě Jany se nesloučí — jde se o patro zpátky', () => {
    const m = kratkaJmena(['jana.novakova@firma.cz', 'jana.dvorakova@firma.cz'])
    expect(m.get('jana.novakova@firma.cz')).toBe('jana.novakova')
    expect(m.get('jana.dvorakova@firma.cz')).toBe('jana.dvorakova')
  })

  it('kolize i v místní části ukáže celý e-mail', () => {
    const m = kratkaJmena(['jana@firma.cz', 'jana@jinafirma.cz'])
    expect(m.get('jana@firma.cz')).toBe('jana@firma.cz')
    expect(m.get('jana@jinafirma.cz')).toBe('jana@jinafirma.cz')
  })

  it('kolize se řeší jen u těch, kdo kolidují', () => {
    const m = kratkaJmena(['jana.a@f.cz', 'jana.b@f.cz', 'petr.c@f.cz'])
    expect(m.get('petr.c@f.cz')).toBe('petr')
  })

  it('prázdné a duplicitní vstupy neshodí', () => {
    const m = kratkaJmena(['', '  ', 'a@b.cz', 'a@b.cz'])
    expect(m.size).toBe(1)
    expect(m.get('a@b.cz')).toBe('a')
  })
})

describe('rozdělení po lidech', () => {
  const jmena = new Map([
    [KOLEGA, 'jana'],
    ['u-treti', 'adam'],
  ])

  it('já jsem první, ostatní podle jména', () => {
    const list = [u({ ownerId: 'u-treti' }), u({ ownerId: KOLEGA }), u({ ownerId: JA })]
    expect(skupinyLidi(list, JA, jmena).map((s) => s.nazev)).toEqual(['Já', 'adam', 'jana'])
  })

  it('moje skupina sbírá i to, co mi kolega přiřadil', () => {
    const list = [u({ ownerId: JA }), u({ ownerId: KOLEGA, assignedTo: JA })]
    const skupiny = skupinyLidi(list, JA, jmena)
    expect(skupiny).toHaveLength(1)
    expect(skupiny[0].ukoly).toHaveLength(2)
  })

  it('neznámý člověk nezmizí, jen nemá jméno', () => {
    const skupiny = skupinyLidi([u({ assignedTo: 'u-kdosi' })], JA, jmena)
    expect(skupiny.map((s) => s.nazev)).toEqual(['někdo další'])
    expect(skupiny[0].ukoly).toHaveLength(1)
  })

  it('žádný úkol se po cestě neztratí ani nezdvojí', () => {
    const list = [
      u({ ownerId: JA }),
      u({ ownerId: KOLEGA }),
      u({ ownerId: KOLEGA }),
      u({ assignedTo: 'u-treti' }),
      u(),
    ]
    const skupiny = skupinyLidi(list, JA, jmena)
    expect(skupiny.reduce((n, s) => n + s.ukoly.length, 0)).toBe(list.length)
  })
})

describe('zavislá přiřazení', () => {
  const t = (id: string, clientId?: string, assignedTo?: string) => ({ id, clientId, assignedTo })
  const mapa = new Map([['k1', new Set([JA, KOLEGA])]])

  it('kolega u klienta zůstává — nic se neruší', () => {
    expect(zavislaPrirazeni([t('a', 'k1', KOLEGA)], mapa, JA)).toEqual([])
  })

  it('kdo u klienta není, je zavislé přiřazení', () => {
    expect(zavislaPrirazeni([t('a', 'k1', 'u-byvaly')], mapa, JA)).toEqual(['a'])
  })

  it('nesdílený klient nemá komu patřit než mně', () => {
    expect(zavislaPrirazeni([t('a', 'k2', KOLEGA)], mapa, JA)).toEqual(['a'])
  })

  it('úkol bez klienta se nesdílí, takže přiřazení nedává smysl', () => {
    expect(zavislaPrirazeni([t('a', undefined, KOLEGA)], mapa, JA)).toEqual(['a'])
  })

  it('vlastní přiřazení se neruší nikdy', () => {
    expect(zavislaPrirazeni([t('a', 'k9', JA), t('b', undefined, JA)], mapa, JA)).toEqual([])
  })

  it('nepřiřazený úkol se nepočítá', () => {
    expect(zavislaPrirazeni([t('a', 'k1')], mapa, JA)).toEqual([])
  })
})
