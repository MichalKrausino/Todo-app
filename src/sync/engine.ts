// Synchronizační vrstva (Fáze 2). Běží na pozadí vedle UI:
// UI čte a zapisuje jen lokální Dexie přes repo, engine se stará o výměnu
// se Supabase. Pořadí každého běhu: pull všech tabulek → push všech tabulek.
// Konflikty řeší last-write-wins podle updatedAt (viz supabase/schema.sql).
//
// Engine zapisuje do Dexie přímo (bulkPut stažených záznamů) a záměrně
// nerazítkuje updatedAt — zapisuje cizí záznamy tak, jak jsou.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { db } from '../db/db'
import { onRepoWrite } from '../db/events'
import { reconcileTemplates } from '../db/templates'
import type { Table } from 'dexie'
import { SUPABASE_ANON_KEY, SUPABASE_URL, VAPID_PUBLIC_KEY, isSupabaseConfigured } from './config'
import {
  LOCAL_TABLE_NAMES,
  REMOTE_TABLES,
  applyPull,
  maxUpdatedAt,
  pendingPush,
  type LocalTableName,
  type PulledRow,
  type Syncable,
} from './merge'
import { setSyncStatus } from './status'

const PAGE_SIZE = 500
const WRITE_DEBOUNCE_MS = 2500

let sb: SupabaseClient | null = null
let syncing = false
let queued = false
let debounceTimer: ReturnType<typeof setTimeout> | undefined

const localTable = (name: LocalTableName): Table<Syncable, string> =>
  db.table(name) as Table<Syncable, string>

export function initSync(): void {
  if (!isSupabaseConfigured) {
    setSyncStatus({ phase: 'unconfigured' })
    return
  }
  sb = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)

  // Zachytí i INITIAL_SESSION po startu, takže se appka srovná hned po otevření.
  sb.auth.onAuthStateChange((_event, session) => {
    if (session) {
      setSyncStatus({ phase: 'idle', email: session.user.email })
      void syncNow()
    } else {
      setSyncStatus({ phase: 'signedOut', email: undefined })
    }
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
  })
  window.addEventListener('online', () => void syncNow())

  onRepoWrite(() => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => void syncNow(), WRITE_DEBOUNCE_MS)
  })
}

export async function syncNow(): Promise<void> {
  if (!sb) return
  if (syncing) {
    queued = true
    return
  }
  const { data } = await sb.auth.getSession()
  const session = data.session
  if (!session) {
    setSyncStatus({ phase: 'signedOut' })
    return
  }
  if (!navigator.onLine) {
    setSyncStatus({ phase: 'offline' })
    return
  }

  syncing = true
  setSyncStatus({ phase: 'syncing' })
  try {
    await ensureAccount(session.user.id)
    for (const name of LOCAL_TABLE_NAMES) await pullTable(name)
    for (const name of LOCAL_TABLE_NAMES) await pushTable(name)
    setSyncStatus({ phase: 'idle', lastSyncAt: new Date().toISOString(), error: undefined })
    // Pull mohl přinést změny šablon z druhého zařízení — dogenerovat instance.
    await reconcileTemplates()
  } catch (e) {
    setSyncStatus({ phase: 'error', error: e instanceof Error ? e.message : String(e) })
  } finally {
    syncing = false
    if (queued) {
      queued = false
      void syncNow()
    }
  }
}

// Při přihlášení jiného účtu, než se kterým se synchronizovalo naposledy,
// se kurzory vynulují — proběhne plný pull i push (appka je pro jednoho
// uživatele, tohle jen brání tichému smíchání dat po překliknutí účtu).
async function ensureAccount(userId: string): Promise<void> {
  const meta = await db.syncState.get('meta')
  if (meta?.userId === userId) return
  await db.syncState.clear()
  await db.syncState.put({ id: 'meta', userId })
}

async function pullTable(name: LocalTableName): Promise<void> {
  const table = localTable(name)
  const stateId = `pull:${name}`
  let cursor = (await db.syncState.get(stateId))?.cursor ?? ''

  for (;;) {
    let query = sb!
      .from(REMOTE_TABLES[name])
      .select('id,data,updated_at')
      .order('updated_at', { ascending: true })
      .limit(PAGE_SIZE)
    if (cursor) query = query.gt('updated_at', cursor)

    const { data, error } = await query
    if (error) throw new Error(`${name}: ${error.message}`)
    const rows = (data ?? []) as PulledRow[]
    if (rows.length === 0) break

    const locals = await table.bulkGet(rows.map((r) => r.id))
    const puts = applyPull(locals, rows)
    if (puts.length > 0) await table.bulkPut(puts)

    cursor = rows[rows.length - 1].updated_at
    await db.syncState.put({ id: stateId, cursor })
    if (rows.length < PAGE_SIZE) break
  }
}

async function pushTable(name: LocalTableName): Promise<void> {
  const table = localTable(name)
  const stateId = `push:${name}`
  const cursor = (await db.syncState.get(stateId))?.cursor ?? ''

  const all = await table.toArray()
  const rows = pendingPush(all, cursor)
  if (rows.length === 0) return

  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const batch = rows.slice(i, i + PAGE_SIZE)
    const payload = batch.map((r) => ({
      id: r.id,
      data: r,
      updated_at: r.updatedAt,
      deleted_at: r.deletedAt ?? null,
    }))
    const { error } = await sb!.from(REMOTE_TABLES[name]).upsert(payload)
    if (error) throw new Error(`${name}: ${error.message}`)
    await db.syncState.put({ id: stateId, cursor: maxUpdatedAt(batch, cursor) })
  }
}

const AUTH_ERRORS_CZ: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'Nesprávný e-mail nebo heslo.'],
  [/email not confirmed/i, 'E-mail ještě není potvrzený — klikni na odkaz v e-mailu.'],
  [/already registered/i, 'Účet s tímhle e-mailem už existuje — přihlas se.'],
  [/password should be at least/i, 'Heslo musí mít aspoň 6 znaků.'],
  [/signup.*(disabled|not allowed)/i, 'Registrace jsou v Supabase vypnuté.'],
  [/rate limit/i, 'Příliš mnoho pokusů, zkus to za chvíli.'],
  [/fetch|network/i, 'Nepodařilo se spojit se serverem. Jsi online?'],
]

const czAuthError = (message: string): string =>
  AUTH_ERRORS_CZ.find(([re]) => re.test(message))?.[1] ?? message

// Vrací česky přeloženou chybu, nebo null při úspěchu.
export async function signInWithPassword(email: string, password: string): Promise<string | null> {
  if (!sb) return 'Synchronizace není nakonfigurovaná.'
  const { error } = await sb.auth.signInWithPassword({ email, password })
  return error ? czAuthError(error.message) : null
}

// Registrace e-mailem. needsConfirm = Supabase poslal potvrzovací e-mail
// a přihlášení bude fungovat až po kliknutí na odkaz v něm.
export async function signUpWithPassword(
  email: string,
  password: string,
): Promise<{ error?: string; needsConfirm?: boolean }> {
  if (!sb) return { error: 'Synchronizace není nakonfigurovaná.' }
  const { data, error } = await sb.auth.signUp({ email, password })
  if (error) return { error: czAuthError(error.message) }
  return { needsConfirm: !data.session }
}

export async function signInWithGoogle(): Promise<void> {
  await sb?.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
}

export async function signOutUser(): Promise<void> {
  await sb?.auth.signOut()
}

// ---------- Push notifikace (ranní návrh dne, Fáze 6) ----------

export const isPushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function base64UrlToUint8Array(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function getPushEnabled(): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== 'granted') return false
  const reg = await navigator.serviceWorker.ready
  return (await reg.pushManager.getSubscription()) !== null
}

// Zapne odběr: povolení od systému → subscribe → uložit na server.
// Vrací česky popsanou chybu, nebo null při úspěchu.
export async function enablePush(): Promise<string | null> {
  if (!sb) return 'Synchronizace není nakonfigurovaná.'
  if (!isPushSupported()) {
    return 'Tohle zařízení push nepodporuje. Na iPhonu musí být appka přidaná na ploše.'
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return 'Notifikace jsou zakázané. Povol je v nastavení systému.'
  }
  const reg = await navigator.serviceWorker.ready
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
    }))
  const { error } = await sb.from('push_subscriptions').upsert(
    { endpoint: subscription.endpoint, subscription: subscription.toJSON() },
    { onConflict: 'endpoint' },
  )
  return error ? error.message : null
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.getSubscription()
  if (!subscription) return
  await sb?.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  await subscription.unsubscribe()
}
