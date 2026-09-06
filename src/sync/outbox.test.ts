import { describe, expect, it } from 'vitest'
import { dirtyRecords, sendWithFallback, vanishedIds, type PushedVersions } from './outbox'

const rec = (id: string, updatedAt: string) => ({ id, updatedAt })
const pushed = (...pairs: Array<[string, string]>): PushedVersions => new Map(pairs)

describe('dirtyRecords', () => {
  it('co server nezná, jde ven', () => {
    expect(dirtyRecords([rec('a', '10:00')], pushed())).toEqual([rec('a', '10:00')])
  })

  it('co je odeslané v téže verzi, se neposílá znovu', () => {
    expect(dirtyRecords([rec('a', '10:00')], pushed(['a', '10:00']))).toEqual([])
  })

  it('změna po odeslání jde ven', () => {
    expect(dirtyRecords([rec('a', '11:00')], pushed(['a', '10:00']))).toEqual([rec('a', '11:00')])
  })

  it('řadí od nejstaršího', () => {
    const out = dirtyRecords([rec('b', '12:00'), rec('a', '10:00')], pushed())
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
  })

  // Tohle je celý důvod, proč evidence nahradila časový kurzor: razítko
  // z druhého zařízení (hodiny napřed) posunulo kurzor do budoucnosti a
  // všechno, co vzniklo tady, pod něj spadlo a neodeslalo se nikdy.
  it('starší změna se odešle i vedle novějšího cizího záznamu', () => {
    const zaznamy = [rec('moje', '12:02'), rec('cizi', '12:05')]
    const out = dirtyRecords(zaznamy, pushed(['cizi', '12:05']))
    expect(out).toEqual([rec('moje', '12:02')])
  })

  // Hodiny srovnané zpátky: nový zápis dostane nižší razítko, než jaké už
  // na serveru je. Podle času by propadl; podle verze jde ven.
  it('nižší razítko než odeslané je pořád změna', () => {
    expect(dirtyRecords([rec('a', '09:00')], pushed(['a', '10:00']))).toEqual([rec('a', '09:00')])
  })
})

describe('sendWithFallback', () => {
  const a = rec('a', '10:00')
  const b = rec('b', '11:00')

  it('když dávka projde, jde ven jedním voláním', async () => {
    let volani = 0
    const out = await sendWithFallback([a, b], async () => {
      volani++
      return null
    })
    expect(volani).toBe(1)
    expect(out).toEqual({ sent: [a, b], refused: 0 })
  })

  it('odmítnutý záznam nezablokuje zbytek dávky', async () => {
    const out = await sendWithFallback([a, b], async (rows) =>
      rows.length > 1 || rows[0].id === 'a' ? 'zamítnuto' : null,
    )
    expect(out.sent).toEqual([b])
    expect(out.refused).toBe(1)
  })

  // Zásadní: kdyby se odmítnutý záznam nahlásil jako odeslaný, evidence by
  // ho označila za vyřízený a už by se nikdy neposlal.
  it('odmítnutý záznam se nehlásí jako odeslaný', async () => {
    const out = await sendWithFallback([a, b], async (rows) =>
      rows.length > 1 || rows[0].id === 'a' ? 'zamítnuto' : null,
    )
    expect(out.sent.map((r) => r.id)).not.toContain('a')
  })

  // Výpadek sítě nesmí skončit tiše — jinak by se tvářil jako odesláno.
  it('když neprojde nic, je to chyba', async () => {
    await expect(sendWithFallback([a, b], async () => 'síť')).rejects.toThrow('síť')
  })

  // Jediný trvale odmítaný záznam nesmí shodit synchronizaci — chyba by
  // zastavila odesílání zbylých tabulek, a to napořád.
  it('jediný odmítnutý záznam sám v dávce jen zvýší počet', async () => {
    const out = await sendWithFallback([a], async () => 'zamítnuto')
    expect(out).toEqual({ sent: [], refused: 1 })
  })

  // Porucha se nesmí zvrhnout v posílání celé dávky po jednom.
  it('u poruchy se nezkouší celá dávka po jednom', async () => {
    const dávka = Array.from({ length: 100 }, (_, i) => rec(`r${i}`, '10:00'))
    let volani = 0
    await expect(
      sendWithFallback(dávka, async () => {
        volani++
        return 'síť'
      }),
    ).rejects.toThrow('síť')
    expect(volani).toBeLessThanOrEqual(6) // dávka + pár sond, ne 100
  })
})

describe('vanishedIds', () => {
  it('odeslaný záznam, který server nezná, se zahodí', () => {
    expect(vanishedIds(['a'], new Set(), new Set())).toEqual(['a'])
  })

  it('co server zná, zůstává', () => {
    expect(vanishedIds(['a'], new Set(['a']), new Set())).toEqual([])
  })

  // Nejdůležitější případ celého úklidu: práce, která vznikla offline,
  // ještě není na serveru — a to neznamená, že zmizela.
  it('neodeslaná práce se nezahazuje', () => {
    expect(vanishedIds(['a'], new Set(), new Set(['a']))).toEqual([])
  })

  it('zahodí jen to, co zmizelo a je odeslané', () => {
    const out = vanishedIds(['a', 'b', 'c'], new Set(['b']), new Set(['c']))
    expect(out).toEqual(['a'])
  })

  it('prázdno nikam nespadne', () => {
    expect(vanishedIds([], new Set(['a']), new Set())).toEqual([])
  })
})
