// Kalendářová vrstva (Fáze 3). Jediné místo klienta, které mluví s kalendářem —
// a to výhradně přes naši edge funkci `calendar` (Google klíče žijí na serveru).
// Události se cachují do Dexie, takže schůzky jsou vidět i offline.
// Zapisuje se JEN do vlastního kalendáře „Todo" (vynucuje server).

import { db } from '../db/db'
import { updateTask } from '../db/repo'
import type { CalendarEvent, Task } from '../db/types'
import { addDays, fromISODate, toISODate, todayISO } from '../lib/dates'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { getSupabase } from './engine'
import { getSyncStatus, subscribeSyncStatus } from './status'

const FETCH_WINDOW_DAYS = 14
const REFRESH_MIN_INTERVAL_MS = 10 * 60_000

let lastFetchAt = 0
let refreshing = false

// Stav propojení kalendáře pro UI (SyncSheet) — chyby se dřív polykaly
// do konzole, kterou na iPhonu nikdo nevidí.
export interface CalendarStatus {
  lastSuccessAt?: string
  eventCount?: number
  lastError?: string
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
  await refreshCalendar()
}

export function initCalendar(): void {
  // Po každém úspěšném syncu (a při návratu do popředí) zkusit obnovit cache.
  subscribeSyncStatus(() => {
    const s = getSyncStatus()
    if (s.phase === 'idle' && s.lastSyncAt) void maybeRefresh()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void maybeRefresh()
  })
}

async function maybeRefresh(): Promise<void> {
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
  if (!res.ok) throw new Error(String(json.error ?? res.statusText))
  return json
}

export async function refreshCalendar(): Promise<void> {
  if (refreshing || !navigator.onLine || !getSupabase()) return
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
      await db.calendarEvents.bulkAdd(events.map((e) => ({ ...e, fetchedAt })))
    })
    setCalStatus({ lastSuccessAt: fetchedAt, eventCount: events.length, lastError: undefined })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('kalendář:', message)
    setCalStatus({ lastError: message })
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
