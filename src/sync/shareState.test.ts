import { describe, expect, it } from 'vitest'
import { clientsToForget, parseFingerprint, sharesFingerprint, type MyShare } from './shareState'

const owner = (clientId: string, projectIds: string[] = []): MyShare => ({
  clientId,
  isOwner: true,
  projectIds,
})
const member = (clientId: string, projectIds: string[] = []): MyShare => ({
  clientId,
  isOwner: false,
  projectIds,
})

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

  // Tohle je celý důvod, proč výběr projektů v otisku vůbec je: odškrtnutím
  // se kolegovi zúží rozsah, ale řádkům se `updated_at` nehne. Kdyby se
  // otisk nezměnil, kurzorový pull se o tom nedozví a úklid se nespustí —
  // odebraný projekt by mu zůstal ležet v zařízení.
  it('rozliší změnu výběru projektů u téhož sdílení', () => {
    expect(sharesFingerprint([member('a', ['p1'])])).not.toBe(
      sharesFingerprint([member('a', ['p1', 'p2'])]),
    )
    expect(sharesFingerprint([member('a', ['p1'])])).not.toBe(sharesFingerprint([member('a')]))
  })

  // Server vrací pole v libovolném pořadí. Bez setřídění by se otisk
  // „měnil" i beze změny a plný pull by jel při každé synchronizaci.
  it('na pořadí projektů nezáleží', () => {
    expect(sharesFingerprint([member('a', ['p2', 'p1'])])).toBe(
      sharesFingerprint([member('a', ['p1', 'p2'])]),
    )
  })
})

describe('parseFingerprint', () => {
  it('projde tam a zpátky', () => {
    const shares = [owner('a'), member('b', ['p1', 'p2'])]
    expect(parseFingerprint(sharesFingerprint(shares))).toEqual(
      [...shares].sort((x, y) => x.clientId.localeCompare(y.clientId)),
    )
  })

  it('prázdný otisk je prázdný seznam', () => {
    expect(parseFingerprint('')).toEqual([])
  })

  // Otisk uložený před zavedením projektů má jen dva díly. Musí se dál
  // přečíst — jinak by upgrade spadl na nečitelném stavu místo aby se
  // rozsah jednou přepočítal.
  it('starý dvoudílný otisk se přečte jako sdílení bez projektů', () => {
    expect(parseFingerprint('a:m,b:o')).toEqual([
      { clientId: 'a', isOwner: false, projectIds: [] },
      { clientId: 'b', isOwner: true, projectIds: [] },
    ])
  })

  // …a proti starému otisku se pak nutně liší, takže se kurzory vynulují
  // a rozsah stáhne znovu. Přesně to se po změně pravidel stát má.
  it('starý otisk se od nového liší, i když se sdílení nezměnilo', () => {
    expect(parseFingerprint('a:m')[0].projectIds).toEqual([])
    expect(sharesFingerprint([member('a', ['p1'])])).not.toBe('a:m')
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
