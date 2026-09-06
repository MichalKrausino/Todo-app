import { describe, expect, it } from 'vitest'
import { clientsToForget, parseFingerprint, sharesFingerprint, type MyShare } from './shareState'

const owner = (clientId: string): MyShare => ({ clientId, isOwner: true })
const member = (clientId: string): MyShare => ({ clientId, isOwner: false })

describe('sharesFingerprint', () => {
  it('nezáleží na pořadí — server ho může vrátit jinak', () => {
    expect(sharesFingerprint([owner('a'), member('b')])).toBe(
      sharesFingerprint([member('b'), owner('a')]),
    )
  })

  it('rozliší nové sdílení', () => {
    expect(sharesFingerprint([owner('a')])).not.toBe(sharesFingerprint([owner('a'), member('b')]))
  })

  it('rozliší změnu role u téhož klienta', () => {
    expect(sharesFingerprint([owner('a')])).not.toBe(sharesFingerprint([member('a')]))
  })

  it('beze sdílení je prázdný', () => {
    expect(sharesFingerprint([])).toBe('')
  })
})

describe('parseFingerprint', () => {
  it('projde tam a zpátky', () => {
    const shares = [owner('a'), member('b')]
    expect(parseFingerprint(sharesFingerprint(shares))).toEqual(
      [...shares].sort((x, y) => x.clientId.localeCompare(y.clientId)),
    )
  })

  it('prázdný otisk je prázdný seznam', () => {
    expect(parseFingerprint('')).toEqual([])
  })

  it('id s dvojtečkou se nerozpadne', () => {
    // Uuid dvojtečku nemá, ale rozdělovat od konce je zadarmo a nemůže selhat.
    expect(parseFingerprint('a:b:m')).toEqual([{ clientId: 'a:b', isOwner: false }])
  })
})

describe('clientsToForget', () => {
  it('odebrané členství se zahazuje', () => {
    expect(clientsToForget([member('a')], [])).toEqual(['a'])
  })

  it('vlastního klienta si nechávám i po zrušení sdílení', () => {
    // Zruším sdílení jako majitel: klient zmizí ze seznamu sdílení, ale
    // data jsou moje. Zahodit je by znamenalo smazat si vlastní práci.
    expect(clientsToForget([owner('a')], [])).toEqual([])
  })

  it('trvající členství se nezahazuje', () => {
    expect(clientsToForget([member('a')], [member('a')])).toEqual([])
  })

  it('zahodí jen to členství, které skončilo', () => {
    expect(clientsToForget([member('a'), member('b'), owner('c')], [member('b')])).toEqual(['a'])
  })

  it('nové členství není co zahazovat', () => {
    expect(clientsToForget([], [member('a')])).toEqual([])
  })
})
