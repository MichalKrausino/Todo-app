// Kalendářová brána (Fáze 3). Klient s ní mluví přes POST {action, ...}:
//   events        {from, to}            → normalizované události všech kalendářů
//   scheduleBlock {title, date, durationMinutes} → blok v kalendáři „Todo"
//   deleteBlock   {eventId}             → smaže blok z kalendáře „Todo"
//
// Google refresh token + client secret žijí jen na serveru
// (public.google_tokens / public.google_oauth — RLS bez policies, čte je
// pouze service role). Zápis jde VÝHRADNĚ do vlastního kalendáře „Todo".
// Logika volných oken zrcadlí src/lib/freeSlot.ts v appce.

import { createClient } from 'npm:@supabase/supabase-js@2'

type Rec = Record<string, unknown>

const TZ = 'Europe/Prague'
const WORK_START = 9 * 60
const WORK_END = 17 * 60

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// CORS: appka běží na github.io a volá supabase.co — prohlížeč posílá
// preflight OPTIONS a bez těchto hlaviček celé volání zařízne
// („Load failed" v Safari). Autorizaci řeší JWT, origin může být *.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: Rec, status = 200) => Response.json(body, { status, headers: CORS })

// --- volná okna (kopie src/lib/freeSlot.ts) ---

interface Busy {
  startMin: number
  endMin: number
}

function mergeBusy(busy: Busy[]): Busy[] {
  const sorted = [...busy].filter((b) => b.endMin > b.startMin).sort((a, b) => a.startMin - b.startMin)
  const merged: Busy[] = []
  for (const b of sorted) {
    const last = merged[merged.length - 1]
    if (last && b.startMin <= last.endMin) last.endMin = Math.max(last.endMin, b.endMin)
    else merged.push({ ...b })
  }
  return merged
}

function findFreeSlot(busy: Busy[], durationMin: number): Busy | null {
  let cursor = WORK_START
  for (const b of mergeBusy(busy)) {
    if (b.endMin <= cursor) continue
    if (b.startMin - cursor >= durationMin) return { startMin: cursor, endMin: cursor + durationMin }
    cursor = Math.max(cursor, b.endMin)
  }
  if (WORK_END - cursor >= durationMin) return { startMin: cursor, endMin: cursor + durationMin }
  return null
}

// --- pomůcky pro čas v Praze ---

const pragueDay = (iso: string): string => new Date(iso).toLocaleDateString('sv', { timeZone: TZ })

const pragueMinutes = (iso: string): number => {
  const [h, m] = new Date(iso)
    .toLocaleTimeString('sv', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit' })
    .split(':')
    .map(Number)
  return h * 60 + m
}

const minutesToHHMM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

// --- Google API ---

async function accessTokenFor(userId: string): Promise<{ token: string; todoCalendarId: string | null }> {
  const { data: creds } = await admin.from('google_oauth').select('client_id, client_secret').eq('id', 1).maybeSingle()
  if (!creds) throw new Error('Chybí Google OAuth přihlašovací údaje na serveru (tabulka google_oauth).')
  const { data: row } = await admin
    .from('google_tokens')
    .select('refresh_token, todo_calendar_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (!row) throw new Error('Kalendář není propojený — přihlas se v appce přes Google.')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const data = (await res.json()) as Rec
  if (!res.ok) throw new Error(`Google token: ${data.error_description ?? data.error}`)
  return { token: data.access_token as string, todoCalendarId: row.todo_calendar_id }
}

async function gcal(token: string, path: string, init?: RequestInit): Promise<Rec> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  if (res.status === 204) return {}
  const data = (await res.json().catch(() => ({}))) as Rec
  if (!res.ok) throw new Error(`Google Calendar ${path}: ${(data.error as Rec)?.message ?? res.status}`)
  return data
}

async function listCalendars(token: string): Promise<Array<{ id: string; summary: string; owned: boolean }>> {
  const data = await gcal(token, '/users/me/calendarList?maxResults=100')
  return ((data.items ?? []) as Rec[]).map((c) => ({
    id: c.id as string,
    summary: (c.summary as string) ?? '',
    owned: c.accessRole === 'owner',
  }))
}

async function ensureTodoCalendar(token: string, userId: string, known: string | null): Promise<string> {
  if (known) return known
  const calendars = await listCalendars(token)
  let todo = calendars.find((c) => c.summary === 'Todo' && c.owned)
  if (!todo) {
    const created = await gcal(token, '/calendars', {
      method: 'POST',
      body: JSON.stringify({ summary: 'Todo', timeZone: TZ }),
    })
    todo = { id: created.id as string, summary: 'Todo', owned: true }
  }
  await admin.from('google_tokens').update({ todo_calendar_id: todo.id }).eq('user_id', userId)
  return todo.id
}

interface NormalizedEvent {
  id: string
  calendarId: string
  eventId: string
  title: string
  start: string
  end: string
  startDay: string
  endDay: string
  allDay: boolean
  isTodoBlock: boolean
}

async function fetchEvents(
  token: string,
  todoCalendarId: string | null,
  fromDay: string,
  toDay: string,
): Promise<NormalizedEvent[]> {
  const calendars = await listCalendars(token)
  const timeMin = `${fromDay}T00:00:00+02:00`
  const timeMax = `${toDay}T23:59:59+02:00`
  const out: NormalizedEvent[] = []
  for (const cal of calendars) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    })
    const data = await gcal(token, `/calendars/${encodeURIComponent(cal.id)}/events?${params}`)
    for (const ev of (data.items ?? []) as Rec[]) {
      if (ev.status === 'cancelled') continue
      const start = ev.start as Rec | undefined
      const end = ev.end as Rec | undefined
      if (!start || !end) continue
      const allDay = Boolean(start.date)
      const startISO = (start.dateTime ?? start.date) as string
      const endISO = (end.dateTime ?? end.date) as string
      out.push({
        id: `${cal.id}:${ev.id}`,
        calendarId: cal.id,
        eventId: ev.id as string,
        title: (ev.summary as string) ?? '(bez názvu)',
        start: startISO,
        end: endISO,
        startDay: allDay ? startISO : pragueDay(startISO),
        // celodenní mají end exkluzivní — poslední den je end - 1
        endDay: allDay
          ? new Date(Date.parse(endISO) - 86400000).toISOString().slice(0, 10)
          : pragueDay(endISO),
        allDay,
        isTodoBlock: cal.id === todoCalendarId,
      })
    }
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'chybí autorizace' }, 401)
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !userData.user) return json({ error: 'neplatné přihlášení' }, 401)
    const userId = userData.user.id

    const body = (await req.json().catch(() => ({}))) as Rec
    const action = body.action as string

    const { token, todoCalendarId } = await accessTokenFor(userId)

    if (action === 'events') {
      const from = (body.from as string) ?? pragueDay(new Date().toISOString())
      const to = (body.to as string) ?? from
      const events = await fetchEvents(token, todoCalendarId, from, to)
      return json({ events })
    }

    if (action === 'scheduleBlock') {
      const title = (body.title as string) ?? 'Práce'
      const date = body.date as string
      const duration = Math.max(15, Math.min(480, Number(body.durationMinutes) || 60))
      const todoId = await ensureTodoCalendar(token, userId, todoCalendarId)
      const dayEvents = await fetchEvents(token, todoId, date, date)
      const busy: Busy[] = dayEvents
        .filter((e) => !e.allDay)
        .map((e) => ({ startMin: pragueMinutes(e.start), endMin: pragueMinutes(e.end) }))
      let slot = findFreeSlot(busy, duration)
      if (!slot) {
        // den je plný — blok se zařadí za poslední obsazený čas
        const lastEnd = Math.max(WORK_START, ...mergeBusy(busy).map((b) => b.endMin))
        slot = { startMin: lastEnd, endMin: lastEnd + duration }
      }
      const created = await gcal(token, `/calendars/${encodeURIComponent(todoId)}/events`, {
        method: 'POST',
        body: JSON.stringify({
          summary: title,
          start: { dateTime: `${date}T${minutesToHHMM(slot.startMin)}:00`, timeZone: TZ },
          end: { dateTime: `${date}T${minutesToHHMM(slot.endMin)}:00`, timeZone: TZ },
        }),
      })
      return json({ eventId: created.id, start: minutesToHHMM(slot.startMin), end: minutesToHHMM(slot.endMin) })
    }

    if (action === 'deleteBlock') {
      const eventId = body.eventId as string
      if (!eventId || !todoCalendarId) return json({ ok: true })
      await gcal(token, `/calendars/${encodeURIComponent(todoCalendarId)}/events/${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
      })
      return json({ ok: true })
    }

    return json({ error: `neznámá akce: ${action}` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
