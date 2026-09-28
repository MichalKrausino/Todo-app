import { describe, expect, it } from 'vitest'
import {
  komuLzeSdilet,
  noveProMe,
  sdileniDalsihoVyskytu,
  sOdebranym,
  sPridanym,
} from './sdileniUkolu'

const JA = 'u-michal'
const BEN = 'u-ben'
const JANA = 'u-jana'

describe('sdílení jednoho úkolu', () => {
  it('přidat neudělá duplicitu', () => {
    expect(sPridanym([BEN], BEN)).toEqual([BEN])
    expect(sPridanym(undefined, BEN)).toEqual([BEN])
  })

  // Prázdný seznam se ukládá jako nic: v datech nemá co ležet a „nesdílený"
  // je jeden stav, ne dva.
  it('odebrat posledního = žádné sdílení', () => {
    expect(sOdebranym([BEN], BEN)).toBeUndefined()
    expect(sOdebranym([BEN, JANA], BEN)).toEqual([JANA])
  })
})

describe('další výskyt opakovaného úkolu', () => {
  // Jádro: nový výskyt založí ten, kdo odškrtl, a řádek je pak jeho.
  // Autor předchozího se z něj nesmí ztratit.
  it('Benův úkol odškrtnutý Michalem vidí Ben dál', () => {
    const vysledek = sdileniDalsihoVyskytu({ ownerId: BEN, sharedWith: [JA] })
    expect(vysledek).toContain(BEN)
    expect(vysledek).toContain(JA)
  })

  it('přidělený ho vidí vždycky — přidělit znamená ukázat', () => {
    expect(sdileniDalsihoVyskytu({ ownerId: JA, assignedTo: BEN })).toEqual(
      expect.arrayContaining([BEN, JA]),
    )
  })

  // Kdo pracuje sám, nesmí dostat do každého opakovaného úkolu
  // `sharedWith: [já]` — šum v datech, který by nic neznamenal.
  it('nesdílený úkol zůstane nesdílený', () => {
    expect(sdileniDalsihoVyskytu({ ownerId: JA })).toBeUndefined()
    expect(sdileniDalsihoVyskytu({})).toBeUndefined()
  })
})

describe('komu lze sdílet', () => {
  const lide = [
    { userId: JA, email: 'michal@x.cz' },
    { userId: BEN, email: 'ben@x.cz' },
    { userId: '', email: 'jana@x.cz', pending: true },
  ]

  it('všem u klienta kromě mě — oběma směry', () => {
    expect(komuLzeSdilet(lide, JA).map((l) => l.userId)).toEqual([BEN])
    expect(komuLzeSdilet(lide, BEN).map((l) => l.userId)).toEqual([JA])
  })

  it('pozvánka bez účtu se nenabízí — nemá id, pod kterým by to viděla', () => {
    expect(komuLzeSdilet(lide, JA).some((l) => l.pending)).toBe(false)
  })
})

describe('nové pro mě', () => {
  const ukol = (o: Partial<{ id: string; sharedWith: string[]; ownerId: string; status: string; deletedAt: string }>) => ({
    id: 't1',
    status: 'active',
    ...o,
  })

  it('cizí úkol nasdílený mně je nový', () => {
    expect(noveProMe([ukol({ ownerId: BEN, sharedWith: [JA] })], JA, new Set())).toHaveLength(1)
  })

  it('jakmile ho vidím, nový není', () => {
    expect(noveProMe([ukol({ ownerId: BEN, sharedWith: [JA] })], JA, new Set(['t1']))).toHaveLength(0)
  })

  it('vlastní úkol není nový, i když ho sdílím', () => {
    expect(noveProMe([ukol({ ownerId: JA, sharedWith: [BEN] })], JA, new Set())).toHaveLength(0)
  })

  it('nesdílený mně, hotový ani smazaný se nepočítá', () => {
    expect(noveProMe([ukol({ ownerId: BEN, sharedWith: [JANA] })], JA, new Set())).toHaveLength(0)
    expect(noveProMe([ukol({ ownerId: BEN, sharedWith: [JA], status: 'done' })], JA, new Set())).toHaveLength(0)
    expect(
      noveProMe([ukol({ ownerId: BEN, sharedWith: [JA], deletedAt: '2026-09-28' })], JA, new Set()),
    ).toHaveLength(0)
  })

  // Úkol bez razítka majitele ještě neprošel serverem — založil jsem ho já
  // na tomhle zařízení. Kdyby se počítal, ukázal by se mi vlastní úkol jako
  // „nový pro tebe".
  it('úkol bez razítka majitele je můj, ne cizí', () => {
    expect(noveProMe([ukol({ sharedWith: [JA] })], JA, new Set())).toHaveLength(0)
  })

  it('nepřihlášený nemá nic nového', () => {
    expect(noveProMe([ukol({ ownerId: BEN, sharedWith: [JA] })], undefined, new Set())).toHaveLength(0)
  })
})
