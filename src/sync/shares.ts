// Sdílení klienta s dalším uživatelem (Fáze 9) — tenká vrstva nad RPC
// funkcemi ze supabase/shares.sql. UI sahá jen sem, nikdy přímo na síť.
//
// Vlastní přenos sdílených dat tenhle modul neřeší: o ten se stará běžný
// pull/push v engine.ts, kterému se rozšířením RLS jen zvětšil rozsah.

import { db } from '../db/db'
import { getSupabase } from './engine'
import { parseFingerprint } from './shareState'

// Kteří klienti jsou sdílení — čte se z otisku, který si engine ukládá při
// každé synchronizaci. Tedy bez dotazu na síť: funguje to i offline a
// v letadle ukazuje poslední známý stav místo prázdna.
//
// Skrz Dexie schválně: `useLiveQuery` se na ten dotaz naváže, takže se
// označení v seznamu samo přerovná, jakmile sdílení přibude nebo ubude.
export async function sharedClientIds(): Promise<Set<string>> {
  const row = await db.syncState.get('shares')
  return new Set(parseFingerprint(row?.cursor ?? '').map((s) => s.clientId))
}

export interface ClientShare {
  email: string
  isOwner: boolean
  // Id se hodí k `Task.hiddenFrom` — do sdílených dat se píše id, ne e-mail.
  userId: string
}

const OFFLINE = 'Sdílení potřebuje připojení k serveru.'

// Výsledky RPC share_client / unshare_client přeložené do češtiny.
// null = povedlo se.
const SHARE_RESULTS_CZ: Record<string, string> = {
  not_found: 'S tímhle e-mailem tu zatím nikdo účet nemá. Ať se nejdřív zaregistruje.',
  self: 'Tohle je tvůj vlastní e-mail.',
  not_owner: 'Sdílet klienta může jen jeho zakladatel.',
}

export async function shareClient(clientId: string, email: string): Promise<string | null> {
  const sb = getSupabase()
  if (!sb) return OFFLINE
  const { data, error } = await sb.rpc('share_client', { p_client_id: clientId, p_email: email })
  if (error) return error.message
  return SHARE_RESULTS_CZ[data as string] ?? null
}

export async function unshareClient(clientId: string, email: string): Promise<string | null> {
  const sb = getSupabase()
  if (!sb) return OFFLINE
  const { data, error } = await sb.rpc('unshare_client', { p_client_id: clientId, p_email: email })
  if (error) return error.message
  return SHARE_RESULTS_CZ[data as string] ?? null
}

// S kým je klient sdílený. Prázdné pole = jen můj (nebo ještě nenačteno).
export async function listClientShares(clientId: string): Promise<ClientShare[]> {
  const sb = getSupabase()
  if (!sb) return []
  const { data, error } = await sb.rpc('list_client_shares', { p_client_id: clientId })
  if (error || !data) return []
  return (data as Array<{ email: string; is_owner: boolean; user_id: string }>).map((r) => ({
    email: r.email,
    isOwner: r.is_owner,
    userId: r.user_id,
  }))
}
