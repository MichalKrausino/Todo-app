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
  type LocalTableName,
  type PulledRow,
  type Syncable,
} from './merge'
import { dirtyRecords, sendWithFallback, vanishedIds, type PushedVersions } from './outbox'
import {
  clientsToForget,
  parseFingerprint,
  sharesFingerprint,
  type MyShare,
} from './shareState'
import { setSyncStatus } from './status'

const PAGE_SIZE = 500
const WRITE_DEBOUNCE_MS = 2500

let sb: SupabaseClient | null = null

// Pro sesterské moduly sync vrstvy (kalendář) — komponenty klienta nepoužívají.
export const getSupabase = (): SupabaseClient | null => sb

// Chyba posledního uložení Google tokenu (RPC store_google_token) — UI ji
// ukazuje v sekci Google kalendář, ať selhání není neviditelné.
let googleTokenError: string | undefined
export const getGoogleTokenError = (): string | undefined => googleTokenError

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
      // Google refresh token patří na server (Fáze 3 — kalendář). Prohlížečem
      // jen proteče hned po OAuth přihlášení; RPC je pro klienta write-only.
      if (session.provider_refresh_token) {
        void sb!
          .rpc('store_google_token', { token: session.provider_refresh_token })
          .then(({ error }) => {
            googleTokenError = error?.message
            if (error) console.warn('store_google_token:', error.message)
          })
      }
      void syncNow()
      void healPushSubscription()
    } else {
      setSyncStatus({ phase: 'signedOut', email: undefined })
    }
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void syncNow()
      void healPushSubscription()
    }
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
  refusedCount = 0
  try {
    await ensureAccount(session.user.id)
    const scopeChanged = await ensureShareScope()
    for (const name of LOCAL_TABLE_NAMES) await pullTable(name)
    for (const name of LOCAL_TABLE_NAMES) await pushTable(name)
    // Úklid zmizelých běží po odeslání (aby se neodeslaná práce počítala
    // jako neodeslaná, ne jako zmizelá) a jen když se rozsah mohl zúžit,
    // nebo jednou za den jako pojistka.
    if (scopeChanged || (await sweepDue())) {
      await sweepVanished()
      await db.syncState.put({ id: 'sweep', cursor: new Date().toISOString() })
    }
    setSyncStatus({
      phase: 'idle',
      lastSyncAt: new Date().toISOString(),
      error: undefined,
      refused: refusedCount || undefined,
    })
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

// Přihlásil se jiný účet, než se kterým se synchronizovalo naposledy.
//
// Kurzory se vynulují (proběhne plný pull) a lokální data se zahodí. Ten
// výmaz je nutný, ne opatrnický: push posílá všechno za kurzorem, takže bez
// něj by se data předchozího uživatele nahrála do účtu toho nového. Je to
// tvrdý výmaz bez tombstonů — na serveru záznamy zůstávají původnímu majiteli.
//
// Výjimka je první přihlášení (žádný předchozí účet): tam lokální data
// vznikla offline, patří přihlašujícímu se a mají se nahrát.
async function ensureAccount(userId: string): Promise<void> {
  const meta = await db.syncState.get('meta')
  if (meta?.userId === userId) return
  const previous = meta?.userId
  await db.syncState.clear()
  if (previous && previous !== userId) {
    for (const name of LOCAL_TABLE_NAMES) await localTable(name).clear()
    await db.calendarEvents.clear()
    await db.pushState.clear()
  }
  await db.syncState.put({ id: 'meta', userId })
}

// Sdílení (Fáze 9) mění rozsah dat, která server vydá. Pull jede podle
// kurzoru `updated_at`, takže na změnu rozsahu sám nereaguje: nově
// zpřístupněné řádky mají staré razítko a kurzor je přeskočí. Proto se při
// každé změně otisku sdílení kurzory vynulují a stáhne se znovu všechno.
//
// Druhý směr — sdílení mi vzali — se musí uklidit lokálně, a to výhradně
// tvrdým výmazem. Tombstone by se odsynchronizoval zpátky a smazal data
// tomu, kdo mi je půjčil.
async function ensureShareScope(): Promise<boolean> {
  const shares = await fetchMyShares()
  // Nevíme, jak na tom sdílení je — nechat všechno být. Kdyby se selhání
  // bralo jako „nic nesdílím", vzal by výpadek sítě na pár vteřin za záminku
  // smazat lokální kopii sdílených dat a stáhnout celý účet znovu.
  if (!shares) return false
  const fingerprint = sharesFingerprint(shares)
  const stored = (await db.syncState.get('shares'))?.cursor ?? ''
  if (stored === fingerprint) return false

  const zapomenout = clientsToForget(parseFingerprint(stored), shares)
  if (zapomenout.length > 0) {
    // Napřed odeslat, co čeká. Kdo byl offline a stihl si u sdíleného
    // klienta založit vlastní úkoly, o ně jinak přijde: úklid je smaže
    // dřív, než se vůbec dostanou na server. Vlastní záznamy projdou i
    // po odebrání sdílení — patří jemu, ne sdílení.
    for (const name of LOCAL_TABLE_NAMES) await pushTable(name)
    for (const clientId of zapomenout) await forgetClientLocally(clientId)
  }

  // Kurzory pull, ať se rozšířený rozsah stáhne celý. Evidence odeslaného
  // zůstává: co je na serveru, tam je, a zapomenuté řádky se nesmí poslat
  // znovu — ostatně už nejsou ani v Dexie.
  const pullCursors = await db.syncState
    .filter((row) => row.id.startsWith('pull:'))
    .toArray()
  await db.syncState.bulkDelete(pullCursors.map((row) => row.id))
  await db.syncState.put({ id: 'shares', cursor: fingerprint })
  return true
}

// Pojistka pro případy, které otisk sdílení nezachytí — třeba úkol, který
// majitel přesunul ze sdíleného klienta jinam, nebo který u sebe schoval
// před konkrétním člověkem (`hiddenFrom`).
//
// Kdo o řádek přijde, se to nemá jak dozvědět: kurzorový pull stahuje jen
// to, co přibylo, a zmizelý řádek prostě nepřijde. Jediný, kdo si toho
// všimne, je tenhle úklid — a proto běží u sdílejících po půlhodině místo
// jednou za den. Bez sdílení nemá co uklízet, tam denně stačí.
const UKLID_BEZNY = 24 * 3600_000
const UKLID_SDILENI = 30 * 60_000

async function sweepDue(): Promise<boolean> {
  const last = (await db.syncState.get('sweep'))?.cursor
  if (!last) return true
  const sdilim = ((await db.syncState.get('shares'))?.cursor ?? '') !== ''
  return Date.now() - new Date(last).getTime() > (sdilim ? UKLID_SDILENI : UKLID_BEZNY)
}

// null = nepodařilo se zjistit. Buď SQL ze supabase/shares.sql ještě
// neproběhlo (funkce neexistuje, sdílení není zapnuté), nebo vypadla síť.
// Obojí se řeší stejně — nesahat na nic a zkusit to při příštím synku.
async function fetchMyShares(): Promise<MyShare[] | null> {
  const { data, error } = await sb!.rpc('my_shares')
  if (error) return null
  return ((data ?? []) as Array<{ client_id: string; is_owner: boolean }>).map((r) => ({
    clientId: r.client_id,
    isOwner: r.is_owner,
  }))
}

// Zahodí lokální kopii cizího klienta i všeho pod ním. Bez tombstonů a bez
// emitRepoWrite — server o tomhle úklidu nesmí vědět.
async function forgetClientLocally(clientId: string): Promise<void> {
  const ukoly = await db.tasks.where('clientId').equals(clientId).primaryKeys()
  const projekty = await db.projects.where('clientId').equals(clientId).primaryKeys()
  await db.tasks.bulkDelete(ukoly)
  await db.projects.bulkDelete(projekty)
  await db.clients.delete(clientId)
  await db.pushState.bulkDelete([
    ...ukoly.map((id) => pushKey('tasks', id)),
    ...projekty.map((id) => pushKey('projects', id)),
    pushKey('clients', clientId),
  ])
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

const pushKey = (name: LocalTableName, id: string): string => `${name}:${id}`

// Verze, ve kterých už záznamy odešly. Podle nich (ne podle času) se pozná,
// co je potřeba odeslat — viz src/sync/outbox.ts.
async function pushedVersions(name: LocalTableName, records: Syncable[]): Promise<PushedVersions> {
  const states = await db.pushState.bulkGet(records.map((r) => pushKey(name, r.id)))
  const pushed: PushedVersions = new Map()
  records.forEach((r, i) => {
    const state = states[i]
    if (state) pushed.set(r.id, state.updatedAt)
  })
  return pushed
}

// Zapíše se právě ta verze, která odešla — ne ta, co je zrovna v Dexie.
// Když se záznam během odesílání změnil, evidence se s ním rozejde a
// příští běh ho pošle znovu. Tím se nemůže ztratit změna udělaná v půlce
// synchronizace.
async function markPushed(name: LocalTableName, sent: Syncable[]): Promise<void> {
  await db.pushState.bulkPut(sent.map((r) => ({ id: pushKey(name, r.id), updatedAt: r.updatedAt })))
}

async function upsertRows(name: LocalTableName, rows: Syncable[]): Promise<string | null> {
  const { error } = await sb!.from(REMOTE_TABLES[name]).upsert(
    rows.map((r) => ({
      id: r.id,
      data: r,
      updated_at: r.updatedAt,
      deleted_at: r.deletedAt ?? null,
    })),
  )
  return error ? error.message : null
}

// Kolik záznamů server odmítl. Nula neznamená „nic se neposlalo", ale
// „nic neuvázlo" — UI to ukazuje, aby odmítnutá změna nevypadala jako klid.
let refusedCount = 0

async function pushTable(name: LocalTableName): Promise<void> {
  const table = localTable(name)
  const all = await table.toArray()
  const rows = dirtyRecords(all, await pushedVersions(name, all))
  if (rows.length === 0) return

  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const batch = rows.slice(i, i + PAGE_SIZE)
    const { sent, refused } = await sendWithFallback(batch, (r) => upsertRows(name, r))
    if (sent.length > 0) await markPushed(name, sent)
    refusedCount += refused
  }
}

// Úklid záznamů, které lokálně leží, ale server je nezná.
//
// Kurzorový pull stahuje jen to, co přibylo — o tom, že něco ubylo z
// dosahu, se nedozví. Sdílení přitom rozsah zužuje běžně: majitel přesune
// úkol ze sdíleného klienta jinam, odebere sdílení. Bez tohohle úklidu by
// tu cizí kopie ležela napořád.
//
// Bezpečnostní pojistky, bez kterých by to bylo mazání dat:
//   1. Neodeslaná práce se nikdy nezahazuje (offline změny čekající na síť
//      server taky „nezná").
//   2. Když seznam ze serveru nedojde celý, tabulka se přeskočí. Půlka
//      seznamu vypadá jako „zbytek zmizel".
//   3. Maže se tvrdě, bez tombstonů — je to lokální kopie cizích dat.
async function sweepVanished(): Promise<void> {
  for (const name of LOCAL_TABLE_NAMES) {
    const serverIds = new Set<string>()
    let cursor = ''
    let complete = true

    for (;;) {
      let query = sb!
        .from(REMOTE_TABLES[name])
        .select('id')
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)
      if (cursor) query = query.gt('id', cursor)

      const { data, error } = await query
      if (error) {
        complete = false
        break
      }
      const rows = (data ?? []) as Array<{ id: string }>
      if (rows.length === 0) break
      for (const row of rows) serverIds.add(row.id)
      cursor = rows[rows.length - 1].id
      if (rows.length < PAGE_SIZE) break
    }
    if (!complete) continue

    const table = localTable(name)
    const all = await table.toArray()
    const pushed = await pushedVersions(name, all)
    const dirty = new Set(dirtyRecords(all, pushed).map((r) => r.id))
    const gone = vanishedIds(
      all.map((r) => r.id),
      serverIds,
      dirty,
    )
    if (gone.length === 0) continue
    await table.bulkDelete(gone)
    await db.pushState.bulkDelete(gone.map((id) => pushKey(name, id)))
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
    options: {
      redirectTo: window.location.origin + import.meta.env.BASE_URL,
      // Kalendář (Fáze 3): čteme všechny kalendáře, zapisovat budeme jen
      // do vlastního kalendáře „Todo". Offline access = refresh token.
      scopes: 'https://www.googleapis.com/auth/calendar',
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })
}

export async function signOutUser(): Promise<void> {
  await sb?.auth.signOut()
}

// ---------- Push notifikace (ranní návrh dne, Fáze 6) ----------

// iOS umí push odběr potichu zahodit (např. po delší neaktivitě appky).
// Flag drží záměr uživatele („chci push“) přes localStorage, aby se odběr
// uměl sám obnovit, aniž bychom obnovovali i vědomě vypnutý.
const PUSH_WANTED_KEY = 'todo.pushWanted'

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
  if (!error) localStorage.setItem(PUSH_WANTED_KEY, '1')
  return error ? error.message : null
}

export async function disablePush(): Promise<void> {
  localStorage.removeItem(PUSH_WANTED_KEY)
  const reg = await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.getSubscription()
  if (!subscription) return
  await sb?.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  await subscription.unsubscribe()
}

// Samoléčba odběru: když uživatel push chce a systém odběr zahodil (nebo
// vyměnil endpoint), potichu se znovu přihlásí a obnoví záznam na serveru.
// Bez dialogů — běží jen s už uděleným povolením. Throttle drží síťový
// šum na jednom pokusu za pár hodin.
let lastHealAt = 0

async function healPushSubscription(): Promise<void> {
  if (!sb || localStorage.getItem(PUSH_WANTED_KEY) !== '1') return
  if (!isPushSupported() || Notification.permission !== 'granted') return
  if (Date.now() - lastHealAt < 4 * 3600_000) return
  lastHealAt = Date.now()
  try {
    const reg = await navigator.serviceWorker.ready
    const subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
      }))
    await sb.from('push_subscriptions').upsert(
      { endpoint: subscription.endpoint, subscription: subscription.toJSON() },
      { onConflict: 'endpoint' },
    )
  } catch {
    lastHealAt = 0 // neúspěch neblokuje další pokus při příštím probuzení
  }
}
