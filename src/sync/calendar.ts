// Kalendářová vrstva (Fáze 3). Jediné místo klienta, které mluví s kalendářem —
// a to výhradně přes naši edge funkci `calendar` (Google klíče žijí na serveru).
// Události se cachují do Dexie, takže schůzky jsou vidět i offline.
// Zapisuje se JEN do vlastního kalendáře „Todo" (vynucuje server).

import { db } from '../db/db'
import { updateTask } from '../db/repo'
import type { CalendarEvent, Task } from '../db/types'
import { addDays, fromISODate, toISODate, todayISO, jePlatnyCas } from '../lib/dates'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { getSupabase } from './engine'
import { getSyncStatus, subscribeSyncStatus } from './status'

// Okno cache: půl roku dopředu — heatmapa i agenda tak vidí i vzdálené
// plány (svatby, dovolené, konference), ne jen nejbližší dny.
export const FETCH_WINDOW_DAYS = 180

// Obnova jezdí po minutě, ne po pěti. Dřív tu stálo pět minut kvůli ceně
// plné obnovy — jenže ta cena je jinde, než to vypadalo: stažení je jeden
// požadavek a zápis do Dexie je změřeně 9 ms na 500 událostí a 30 ms na
// 2000 (medián ze sedmi běhů). Za tohle se schůzky na obrazovce pět minut
// zpožďovat nemusí. O pět vteřin míň než minuta schválně: plánovač tiká
// po 30 s, takže s rovnou minutou by se obnova trefila až na druhý tik (90 s).
const REFRESH_MIN_INTERVAL_MS = 55_000

let lastFetchAt = 0
let refreshing = false

// Stav propojení kalendáře pro UI (SyncSheet) — chyby se dřív polykaly
// do konzole, kterou na iPhonu nikdo nevidí.
export interface CalendarStatus {
  lastSuccessAt?: string
  eventCount?: number
  lastError?: string
  // Google přestal uznávat uložený přístup. Dokud se člověk nepřihlásí
  // znovu, nemá smysl to zkoušet každých pět minut — jen by to plnilo
  // log pětistovkami a hlásilo pořád totéž.
  needsReauth?: boolean
}

let calStatus: CalendarStatus = {}
const calSubs = new Set<() => void>()

function setCalStatus(patch: CalendarStatus): void {
  calStatus = { ...calStatus, ...patch }
  calSubs.forEach((fn) => fn())
}

export const getCalendarStatus = (): CalendarStatus => calStatus
export function subscribeCalendarStatus(fn: () => void): () => void {
  calSubs.add(fn)
  return () => calSubs.delete(fn)
}

// Ruční test propojení: obejde throttle a hned obnoví cache; výsledek
// (úspěch i doslovná chyba) skončí v getCalendarStatus.
export async function testCalendar(): Promise<void> {
  lastFetchAt = 0
  setCalStatus({ needsReauth: false })
  await refreshCalendar()
}

export function initCalendar(): void {
  // Po každém úspěšném syncu (a při návratu do popředí) zkusit obnovit cache.
  subscribeSyncStatus(() => {
    const s = getSyncStatus()
    if (s.phase === 'idle' && s.lastSyncAt) void maybeRefreshCalendar()
  })
  // Návrat do popředí je jediná chvíle, kdy člověk na schůzky KOUKÁ a data
  // jsou zaručeně nejstarší — proto tu žádná pojistka není. Dřív i sem
  // platil minimální interval, takže po odemčení telefonu ukazovala appka
  // schůzky z doby, kdy ho člověk zamykal.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastFetchAt = 0
      void refreshCalendar()
    }
  })
}

// Obnova s pojistkou proti zbytečnému opakování — volá ji plánovač
// (src/sync/live.ts) i návrat do popředí.
export async function maybeRefreshCalendar(): Promise<void> {
  if (Date.now() - lastFetchAt < REFRESH_MIN_INTERVAL_MS) return
  await refreshCalendar()
}

async function callFn(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sb = getSupabase()
  if (!sb) throw new Error('sync není nakonfigurovaný')
  const { data } = await sb.auth.getSession()
  if (!data.session) throw new Error('nepřihlášeno')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/calendar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({ action, ...payload }),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = new Error(String(json.error ?? res.statusText)) as Error & { reauth?: boolean }
    err.reauth = json.reauth === true
    throw err
  }
  return json
}

export async function refreshCalendar(): Promise<void> {
  if (refreshing || !navigator.onLine || !getSupabase()) return
  // Odpojený Google se sám nespraví — čeká se na nové přihlášení.
  // Ruční „Otestovat" (testCalendar) příznak shodí a zkusí to znovu.
  if (calStatus.needsReauth) return
  refreshing = true
  lastFetchAt = Date.now()
  try {
    const from = todayISO()
    const to = toISODate(addDays(fromISODate(from), FETCH_WINDOW_DAYS))
    const res = await callFn('events', { from, to })
    const events = (res.events ?? []) as CalendarEvent[]
    const fetchedAt = new Date().toISOString()
    await db.transaction('rw', db.calendarEvents, async () => {
      await db.calendarEvents.clear()
      // Schůzka bez použitelného času se do cache vůbec nedostane —
      // jinak by v ní zůstala ležet i po opravě serveru.
      const pouzitelne = events.filter((e) => e.allDay || (jePlatnyCas(e.start) && jePlatnyCas(e.end)))
      await db.calendarEvents.bulkAdd(pouzitelne.map((e) => ({ ...e, fetchedAt })))
    })
    setCalStatus({
      lastSuccessAt: fetchedAt,
      eventCount: events.length,
      lastError: undefined,
      needsReauth: false,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('kalendář:', message)
    setCalStatus({
      lastError: message,
      needsReauth: (e as { reauth?: boolean }).reauth === true,
    })
  } finally {
    refreshing = false
  }
}

// Zabere blok v kalendáři „Todo" pro naplánovaný úkol (např. přijatý ranní
// návrh). Server najde první volné okno v pracovní době; délka = tichý odhad.
export async function scheduleBlockForTask(task: Task): Promise<void> {
  try {
    const res = await callFn('scheduleBlock', {
      title: task.title,
      date: task.scheduledFor ?? task.dueDate ?? todayISO(),
      durationMinutes: task.estimateMinutes ?? 60,
    })
    if (typeof res.eventId === 'string') {
      await updateTask(task.id, { calendarEventId: res.eventId })
    }
    lastFetchAt = 0
    void refreshCalendar()
  } catch (e) {
    console.warn('scheduleBlock:', e instanceof Error ? e.message : e)
  }
}

export async function deleteBlockForTask(task: Task): Promise<void> {
  if (!task.calendarEventId) return
  try {
    await callFn('deleteBlock', { eventId: task.calendarEventId })
    await updateTask(task.id, { calendarEventId: undefined })
    lastFetchAt = 0
    void refreshCalendar()
  } catch (e) {
    console.warn('deleteBlock:', e instanceof Error ? e.message : e)
  }
}
