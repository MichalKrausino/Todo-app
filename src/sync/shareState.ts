// Čistá logika sdílení (bez Dexie a Supabase) — pokrytá testy.
//
// Sdílení mění ROZSAH dat, která server posílá. To je pro kurzorový pull
// zrádné hned dvakrát:
//
//  1. Když mi někdo klienta nasdílí, jeho úkoly mají staré updated_at —
//     starší než můj pull kurzor. Běžný pull by je přeskočil a nikdy
//     nestáhl. Proto se při změně rozsahu kurzory nulují a stahuje se
//     znovu všechno.
//  2. Když mi sdílení vezme, zůstanou mi stažené řádky ležet v Dexie.
//     Musí se lokálně zahodit — ale NIKDY tombstonem: tombstone by se
//     odsynchronizoval zpátky a smazal data majiteli. Je to tvrdý lokální
//     výmaz, o kterém server neví.

export interface MyShare {
  clientId: string
  isOwner: boolean
  /**
   * Projekty klienta, které v tomhle sdílení vidím (jako ČLEN). Výběr dělá
   * majitel a výchozí stav je prázdno: nový projekt u sdíleného klienta
   * kolega nevidí, dokud mu ho někdo nezaškrtne.
   *
   * Majiteli se tím nebere nic — ten vidí u svého klienta vždycky všechno,
   * i to, co v odškrtnutém projektu založil kolega. Hlídá to server dvěma
   * oddělenými funkcemi (`vlastnicke_klient_ids` / `clenske_projekt_ids`),
   * viz `supabase/projekty-sdileni.sql`.
   */
  projectIds: string[]
}

// Otisk rozsahu sdílení. Mění se, jen když sdílení přibude, ubude, otočí se
// role, NEBO se změní výběr projektů — ne při každé změně dat, takže plný
// pull se nespouští zbytečně.
//
// Výběr projektů v něm musí být, a je to ta podstatná část: odškrtnutím
// projektu se kolegovi zúží rozsah, ale řádkům se `updated_at` nehne —
// kurzorový pull se o tom nedozví NIKDY. Změna otisku je jediné, co
// spustí úklid (`sweepVanished`), který mu ty řádky z Dexie zahodí.
// Pořadí projektů je ze serveru libovolné, proto se třídí: jinak by se
// otisk „změnil" pokaždé a plný pull by jel při každé synchronizaci.
export function sharesFingerprint(shares: MyShare[]): string {
  return shares
    .map((s) => `${s.clientId}:${s.isOwner ? 'o' : 'm'}:${[...s.projectIds].sort().join('+')}`)
    .sort()
    .join(',')
}

// Otisk zpátky na seznam. Engine si tak vystačí s jedním uloženým řetězcem
// místo dvou (otisk pro porovnání + seznam pro rozdíl).
//
// Dvoudílný tvar (`id:o`) je otisk uložený PŘED zavedením projektů. Čte se
// dál a bere se jako „žádné projekty": po upgradu se tím otisk jednou
// rozejde, kurzory se vynulují a stáhne se všechno znovu — což je přesně
// to, co se po změně pravidel rozsahu stát má.
export function parseFingerprint(fingerprint: string): MyShare[] {
  if (!fingerprint) return []
  return fingerprint.split(',').map((part) => {
    const [clientId, role, projekty] = part.split(':')
    return {
      clientId,
      isOwner: role === 'o',
      projectIds: projekty ? projekty.split('+').filter(Boolean) : [],
    }
  })
}

// Klienti, ke kterým jsem přišel jako ČLEN — jejich data si už nemám nechávat.
//
// Rozlišení majitel/člen je tu to podstatné: když sdílení zruším já jako
// majitel, klient mi taky zmizí ze seznamu sdílení — ale data jsou moje a
// musí zůstat. Zahazuje se jen to, co jsem viděl cizí milostí.
export function clientsToForget(prev: MyShare[], next: MyShare[]): string[] {
  const stillMember = new Set(next.filter((s) => !s.isOwner).map((s) => s.clientId))
  return prev
    .filter((s) => !s.isOwner && !stillMember.has(s.clientId))
    .map((s) => s.clientId)
}
