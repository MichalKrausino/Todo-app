// Paměť ranního návrhu na straně appky. Appka dováží TÝŽ pick.ts, který
// ráno počítá server — tenhle test hlídá právě ten slib: co appka ukáže
// jako „vrátí se v pátek", to server v pátek udělá. Serverová strana má
// vlastní testy (pick.test.ts), tady jde o klientský dovoz.

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { kdySeVrati } from './navrhPamet'
import type { Rozhodnuti } from './navrhPamet'
import { PAUZA_DNI } from './navrhPamet'

const DNES = '2026-09-14'
const rozh = (date: string, decision: Rozhodnuti['decision'], until?: string, taskId = 't1'): Rozhodnuti =>
  ({ date, taskId, decision, until }) as Rozhodnuti

describe('kdy se úkol vrátí', () => {
  it('„Volnější den" uspí hned a vrátí zvolený den', () => {
    expect(kdySeVrati('t1', [], 'snoozed', '2026-09-17', DNES)).toBe('2026-09-17')
  })

  it('bez zvoleného dne platí pevný týden', () => {
    // PAUZA_DNI se počítá ode dne rozhodnutí, ne od zítřka.
    expect(PAUZA_DNI).toBe(7)
    expect(kdySeVrati('t1', [], 'snoozed', undefined, DNES)).toBe('2026-09-21')
  })

  it('první „Dnes ne" nic neodkládá — zítra se nabídne znovu', () => {
    expect(kdySeVrati('t1', [], 'rejected', undefined, DNES)).toBeUndefined()
  })

  it('druhé „Dnes ne" během čtrnácti dní znamená týden pokoj', () => {
    const hist = [rozh('2026-09-10', 'rejected')]
    expect(kdySeVrati('t1', hist, 'rejected', undefined, DNES)).toBe('2026-09-21')
  })

  it('u druhého „Dnes ne" se ctí den zvolený appkou', () => {
    const hist = [rozh('2026-09-10', 'rejected')]
    expect(kdySeVrati('t1', hist, 'rejected', '2026-09-18', DNES)).toBe('2026-09-18')
  })

  it('odpověď přepíše dnešní dřívější odpověď, nesčítá se s ní', () => {
    // Člověk ťukne „Dnes ne" a hned to změní na „Volnější den" — do
    // výpočtu smí jít jen ta nová, jinak by dvě dnešní odmítnutí
    // spustila pauzu, kterou nikdo nezvolil.
    const hist = [rozh('2026-09-10', 'rejected'), rozh(DNES, 'rejected')]
    expect(kdySeVrati('t1', hist, 'rejected', undefined, DNES)).toBe('2026-09-21')
    expect(kdySeVrati('t1', hist, 'snoozed', '2026-09-16', DNES)).toBe('2026-09-16')
  })

  it('den návratu v minulosti se ignoruje a spadne se na týden', () => {
    expect(kdySeVrati('t1', [], 'snoozed', '2026-09-10', DNES)).toBe('2026-09-21')
    expect(kdySeVrati('t1', [], 'snoozed', DNES, DNES)).toBe('2026-09-21')
  })

  it('rozhodnutí o jiných úkolech do toho nemluví', () => {
    const hist = [rozh('2026-09-10', 'rejected', undefined, 'jiny'), rozh('2026-09-11', 'rejected', undefined, 'jiny')]
    expect(kdySeVrati('t1', hist, 'rejected', undefined, DNES)).toBeUndefined()
  })

  it('delší pauza vyhrává nad kratší — odložení se nezkracuje', () => {
    const hist = [rozh('2026-09-12', 'snoozed', '2026-09-30')]
    expect(kdySeVrati('t1', hist, 'snoozed', '2026-09-16', DNES)).toBe('2026-09-30')
  })
})
