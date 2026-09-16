// Tři údaje, které potřebuje každá obrazovka, jakmile se něco sdílí:
// kdo jsem, jak se jmenují ostatní a jestli se vůbec něco sdílí.
//
// Všechny tři jdou z Dexie, ne ze sítě — appka na síť nikdy nečeká a
// „čí je tenhle úkol" musí platit i v metru. `useLiveQuery` se na ně
// naváže, takže se seznam sám přerovná, když sdílení přibude nebo ubude.

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { listClientShares, sharedClientIds, type ClientShare } from '../sync/shares'
import { kratkaJmena } from './tymUkoly'

/**
 * Moje id — totéž, co razítkuje `ownerId` u mých řádků.
 *
 * Bere se z lokálního účetnictví synchronizace, ne ze session: session
 * po startu chvíli není a v tom okně by všechny cizí úkoly probliskly
 * jako moje. Zapsané id přežije i restart a offline.
 */
export function useJa(): string | undefined {
  return useLiveQuery(() => db.syncState.get('meta').then((r) => r?.userId), [])
}

/** Id uživatele → krátké jméno k zobrazení. Prázdná, dokud se nic nesdílí. */
export function useLide(): Map<string, string> {
  const rows = useLiveQuery(() => db.lide.toArray(), [], [])
  return useMemo(() => {
    const kratka = kratkaJmena(rows.map((r) => r.email))
    return new Map(rows.map((r) => [r.userId, kratka.get(r.email) ?? r.email]))
  }, [rows])
}

/**
 * Sdílím vůbec něco?
 *
 * Tohle je vypínač celé týmové části rozhraní. Kdo pracuje sám — a to je
 * výchozí stav — nemá vidět ani slot „Kdo to má", ani přepínač lidí, ani
 * jméno u úkolu. Týmová appka pro jednoho člověka je horší než appka pro
 * jednoho člověka.
 */
export function useSdilim(): boolean {
  const ids = useLiveQuery(sharedClientIds, [], new Set<string>())
  return ids.size > 0
}

/** Je tenhle klient sdílený? Pro sloty, které se jinak nemají ukazovat. */
export function useSdilenyKlient(clientId: string | undefined): boolean {
  const ids = useLiveQuery(sharedClientIds, [], new Set<string>())
  return !!clientId && ids.has(clientId)
}

/**
 * Kdo všechno je u tohohle klienta — majitel i členové, s id.
 *
 * Jedno místo pro obě věci, které to potřebují (komu úkol přiřadit a kdo
 * ho vidí). Dřív si každá dělala vlastní dotaz a v otevřeném detailu
 * úkolu se tak volalo dvakrát totéž.
 *
 * Nesdílený klient se neptá vůbec — a `nacetlo` odlišuje „nikdo tu není"
 * od „ještě se to nenačetlo", což je u sdílení rozdíl mezi pravdou a lží.
 */
export function useKolegove(clientId: string | undefined): {
  lide: ClientShare[]
  nacetlo: boolean
} {
  const sdileny = useSdilenyKlient(clientId)
  const [lide, setLide] = useState<ClientShare[]>([])
  const [nacetlo, setNacetlo] = useState(false)

  useEffect(() => {
    if (!sdileny || !clientId) {
      setLide([])
      setNacetlo(false)
      return
    }
    let live = true
    void listClientShares(clientId).then((rows) => {
      if (!live) return
      setLide(rows)
      setNacetlo(true)
    })
    return () => {
      live = false
    }
  }, [clientId, sdileny])

  return { lide, nacetlo }
}
