// Sdílí se ÚKOL, ne klient — čistá logika (bez Dexie a sítě), pokrytá testy.
//
// Úkol je soukromý svému autorovi a sdílí se po jednom, konkrétním lidem
// (`Task.sharedWith`, seznam id). Platí to OBĚMA SMĚRY: majitel klienta
// sdílí kolegovi a kolega majiteli stejným slotem. Klient a jeho projekty
// se sdílejí celé — kolega vidí strukturu, do které může sám zakládat,
// ale obsah mu přichází jen ten, který mu někdo dá.
//
// O viditelnosti rozhoduje server (`supabase/sdileni-ukolu.sql`): úkol vidí
// jeho autor a ti, kdo jsou v `sharedWith` A zároveň ve živém sdílení
// klienta. Tady se jen skládá, co se do `sharedWith` zapíše.
//
// VÝCHOZÍ STAV JE „JEN JÁ" A NEPAMATUJE SE. Každý nový úkol začíná
// soukromý, i když byl ten předchozí u téhož klienta sdílený — série úkolů
// pro kolegu tím stojí jedno ťuknutí navíc, ale nikdy se omylem nenasdílí
// nic soukromého. Zkrátit se to dá kdykoli; vzít zpátky, co kolega viděl,
// ne.

export interface KdoUkolVidi {
  sharedWith?: string[]
  ownerId?: string
  assignedTo?: string
}

/** Seznam bez duplicit a bez prázdných hodnot; prázdný seznam = `undefined`. */
function uklid(ids: Iterable<string | undefined>): string[] | undefined {
  const set = new Set<string>()
  for (const id of ids) if (id) set.add(id)
  return set.size ? [...set] : undefined
}

export const sPridanym = (sharedWith: readonly string[] | undefined, id: string) =>
  uklid([...(sharedWith ?? []), id])

export const sOdebranym = (sharedWith: readonly string[] | undefined, id: string) =>
  uklid((sharedWith ?? []).filter((u) => u !== id))

/**
 * Sdílení nového výskytu opakovaného úkolu.
 *
 * Nový výskyt zakládá zařízení toho, kdo odškrtl — řádek pak patří JEMU.
 * Kdyby si výskyt nesl jen původní `sharedWith`, vypadl by z něj autor
 * předchozího (u Benova úkolu odškrtnutého Michalem by ho Ben přestal
 * vidět, i když je mu přidělený). To je úkol, o kterém neví nikdo —
 * a u opakovaného se to stane při KAŽDÉM odškrtnutí.
 *
 * Proto: přidělený člověk ho vidět musí vždycky (přidělit = ukázat) a autor
 * předchozího výskytu taky, pokud se úkol vůbec sdílel. U úkolu, který se
 * nikdy nesdílel, se nepřidá nic — jinak by každý opakovaný úkol člověka,
 * který pracuje sám, dostal `sharedWith: [já]`, tedy šum v datech.
 */
export function sdileniDalsihoVyskytu(t: KdoUkolVidi): string[] | undefined {
  const kdo = [...(t.sharedWith ?? [])]
  if (t.assignedTo) kdo.push(t.assignedTo)
  if (kdo.length > 0 && t.ownerId) kdo.push(t.ownerId)
  return uklid(kdo)
}

/**
 * Komu jde u úkolu sdílet: všichni lidé u klienta kromě mě — majitel
 * i členové, protože se sdílí oběma směry. Pozvánka, která ještě čeká na
 * první přihlášení, nemá id, takže jí zatím nasdílet nejde.
 */
export function komuLzeSdilet<T extends { userId: string; pending?: boolean }>(
  lide: readonly T[],
  ja: string | undefined,
): T[] {
  return lide.filter((l) => !!l.userId && !l.pending && l.userId !== ja)
}

/**
 * Co mi někdo nasdílel a já to ještě neviděl.
 *
 * Na Dnes se úkol v seznamu objeví, jen když je PŘIDĚLENÝ mně — Dnes
 * odpovídá na „co mám dělat já" a cizí úkoly by mi naplnily den i kroužek
 * postupu. Jenže nasdílené a nepřidělené by pak šlo najít jedině ve Vše,
 * tedy vůbec ne, když člověk neví, že tam má hledat. Tohle je most mezi
 * tím: chip „Nové pro tebe" na Dnes.
 *
 * Nové = nasdílené mně, cizí (autor nejsem já), otevřené a ještě neviděné
 * na TOMHLE zařízení. „Viděno" je osobní stav a leží jen lokálně: kdyby
 * šlo do sdíleného řádku, přepisoval by ho last-write-wins s úpravami
 * autora, a kolega by navíc viděl, co jsem si prohlédl.
 */
export function noveProMe<
  T extends { id: string; sharedWith?: string[]; ownerId?: string; status: string; deletedAt?: string },
>(ukoly: readonly T[], ja: string | undefined, videne: ReadonlySet<string>): T[] {
  if (!ja) return []
  return ukoly.filter(
    (u) =>
      !u.deletedAt &&
      (u.status === 'active' || u.status === 'inbox') &&
      !!u.ownerId &&
      u.ownerId !== ja &&
      (u.sharedWith ?? []).includes(ja) &&
      !videne.has(u.id),
  )
}
