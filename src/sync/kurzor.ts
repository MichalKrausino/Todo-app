// Kurzor stahování podle SERVEROVÉHO razítka (supabase/razitko-serveru.sql).
//
// Stahování se dřív ptalo podle `updated_at`, tedy podle hodin zařízení,
// které zápis udělalo. Kurzor pak stál na posledním vlastním zápisu a
// cokoli, co na server dorazilo později se starším razítkem (odškrtnutí
// z telefonu, který byl offline; pár vteřin rozjetých hodin), už se
// nestáhlo nikdy. `synced_at` píše server ve chvíli, kdy zápis opravdu
// projde, takže co přijde později, má vždycky pozdější razítko.
//
// Kurzor je dvojice (razítko, id): řádky se stejným razítkem se řadí podle
// id a na hraně stránky žádný nevypadne. Dřív se stránkovalo jen podle
// času s `gt`, takže dva řádky se stejným razítkem — import z Todoistu
// i kaskáda mazání jich dávají celé dávky — na hraně stránky přeskočil.

export interface Kurzor {
  at: string
  id: string
}

export const zakodujKurzor = (k: Kurzor): string => `${k.at}|${k.id}`

// Uložený kurzor ve starém tvaru (holé `updated_at` bez id) se nebere —
// patří k jinému sloupci. Stáhne se tedy jednou všechno a dál už se jede
// podle nového razítka; zápis je idempotentní (last-write-wins), takže
// opakované stažení nic nerozbije.
export function dekodujKurzor(ulozeny: string | undefined): Kurzor | null {
  if (!ulozeny) return null
  const i = ulozeny.lastIndexOf('|')
  if (i <= 0 || i === ulozeny.length - 1) return null
  return { at: ulozeny.slice(0, i), id: ulozeny.slice(i + 1) }
}

// Filtr pro PostgREST `or=(…)`: řádky za kurzorem v pořadí (synced_at, id).
// Razítko je v uvozovkách — obsahuje `:` a `+`, které by jinak rozbily
// zápis logického stromu.
export const filtrZaKurzorem = (k: Kurzor): string =>
  `synced_at.gt."${k.at}",and(synced_at.eq."${k.at}",id.gt.${k.id})`
