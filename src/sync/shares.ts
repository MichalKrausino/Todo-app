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
  // Id se hodí k `Task.sharedWith` — do sdílených dat se píše id, ne e-mail.
  // U nevyzvednuté pozvánky je prázdné: ten člověk ještě id nemá.
  userId: string
  // Pozvánka čeká na první přihlášení. Zvoucí to musí vidět, jinak by
  // nepoznal „už je uvnitř" od „leží mu to v e-mailu".
  pending: boolean
}

const OFFLINE = 'Sdílení potřebuje připojení k serveru.'

// Výsledky RPC share_client / unshare_client přeložené do češtiny.
// null = povedlo se.
const SHARE_RESULTS_CZ: Record<string, string> = {
  self: 'Tohle je tvůj vlastní e-mail.',
  not_owner: 'Sdílet klienta může jen jeho zakladatel.',
}

/**
 * `pozvanka` znamená, že pod tím e-mailem zatím nikdo účet nemá — sdílení
 * se proto uložilo jako pozvánka a samo se uplatní, až se ten člověk
 * poprvé přihlásí. Dřív se to bralo jako chyba („ať se nejdřív
 * zaregistruje"), takže sdílení nešlo ZAČÍT, jen dokončit.
 */
export type VysledekSdileni = { ok: true; pozvanka: boolean } | { ok: false; chyba: string }

export async function shareClient(clientId: string, email: string): Promise<VysledekSdileni> {
  const sb = getSupabase()
  if (!sb) return { ok: false, chyba: OFFLINE }
  const { data, error } = await sb.rpc('share_client', { p_client_id: clientId, p_email: email })
  if (error) return { ok: false, chyba: error.message }
  const chyba = SHARE_RESULTS_CZ[data as string]
  if (chyba) return { ok: false, chyba }
  return { ok: true, pozvanka: data === 'invited' }
}

// Vyzvednutí pozvánek. Volá se před zjištěním rozsahu sdílení, takže se
// nově získaný klient rovnou promítne do otisku a appka si kvůli němu
// stáhne všechno znovu (nové řádky mají staré `updated_at`, kurzorový
// pull by je přeskočil).
//
// Škrceno: sync se spouští i po každém zápisu, takže bez toho by dávka
// úprav znamenala dávku dotazů. Minuta je dost — pozvánka není nic,
// na co by se čekalo se stopkami.
const CLAIM_INTERVAL_MS = 60_000
let posledniClaim = 0

export async function claimInvites(force = false): Promise<number> {
  const sb = getSupabase()
  if (!sb) return 0
  if (!force && Date.now() - posledniClaim < CLAIM_INTERVAL_MS) return 0
  posledniClaim = Date.now()
  const { data, error } = await sb.rpc('claim_invites')
  if (error) return 0
  return typeof data === 'number' ? data : 0
}

/** Zruší sdílení i nevyzvednutou pozvánku — překlep v e-mailu musí jít vzít zpátky. */
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
  return (
    data as Array<{ email: string; is_owner: boolean; user_id: string; pending?: boolean }>
  ).map((r) => ({
    email: r.email,
    isOwner: r.is_owner,
    userId: r.user_id,
    pending: r.pending === true,
  }))
}

/**
 * Umí server sdílení po úkolech (`supabase/sdileni-ukolu.sql`), případně
 * po projektech (`supabase/sdileni-projektu.sql`)?
 *
 * `true` = ano, `false` = starý server (funkce chybí), `undefined` = nevím
 * (offline, nepřihlášen). Rozlišit se to musí: starý server sdílí CELÉHO
 * klienta, takže by přepínač „Jen já" lhal o tom, kdo úkol vidí. „Nevím"
 * se neprohlašuje za „ne" — selhaný dotaz znamená nevím, ne nic.
 *
 * Kladná odpověď se pamatuje: SQL se jednou spustí a zpátky už nejde.
 */
export type Sonda = 'sdileni_po_ukolech' | 'sdileni_po_projektech'
const umi = new Set<Sonda>()
export async function serverUmi(sonda: Sonda): Promise<boolean | undefined> {
  if (umi.has(sonda)) return true
  const sb = getSupabase()
  if (!sb) return undefined
  const { data, error } = await sb.rpc(sonda)
  if (!error) {
    if (data === true) umi.add(sonda)
    return data === true
  }
  // PGRST202 = funkce na serveru není. Cokoli jiného (síť, výpadek) je „nevím".
  if (error.code === 'PGRST202') return false
  return undefined
}

export const serverUmiSdileniUkolu = () => serverUmi('sdileni_po_ukolech')
