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
}

// Otisk rozsahu sdílení. Mění se, jen když sdílení přibude, ubude, nebo se
// otočí role — ne při každé změně dat, takže plný pull se nespouští zbytečně.
export function sharesFingerprint(shares: MyShare[]): string {
  return shares
    .map((s) => `${s.clientId}:${s.isOwner ? 'o' : 'm'}`)
    .sort()
    .join(',')
}

// Otisk zpátky na seznam. Engine si tak vystačí s jedním uloženým řetězcem
// místo dvou (otisk pro porovnání + seznam pro rozdíl).
export function parseFingerprint(fingerprint: string): MyShare[] {
  if (!fingerprint) return []
  return fingerprint.split(',').map((part) => {
    const at = part.lastIndexOf(':')
    return { clientId: part.slice(0, at), isOwner: part.slice(at + 1) === 'o' }
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
