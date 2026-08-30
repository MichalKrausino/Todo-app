// Todoist (Fáze 8). Jediné místo klienta, které o Todoistu ví — a i to
// mluví výhradně s naší edge funkcí `todoist` (API token žije na serveru).
//
// Směr: Todoist → appka u názvu, termínu, priority a checklistu.
// Zpátky letí jediná věc — odškrtnutí (a případné znovuotevření), aby
// klient ve sdíleném projektu viděl, co už je hotové.
//
// Naplánování na den, špendlík Top 3, odhad a kalendářní blok zůstávají
// naše; import je nepřepisuje.

import { db } from '../db/db'
import { emitRepoWrite } from '../db/events'
import { importTodoist, type TodoistSection } from '../db/todoistImport'
import type { Client } from '../db/types'
import type { TodoistTask } from '../lib/todoistMap'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { getSupabase } from './engine'
import { getSyncStatus, subscribeSyncStatus } from './status'

const REFRESH_MIN_INTERVAL_MS = 10 * 60_000
// Jak hluboko do minulosti se ptáme na hotové úkoly. Slouží jen k tomu,
// aby se poznalo „odškrtnuto" od „smazáno" — delší okno nemá smysl.
const COMPLETED_WINDOW_DAYS = 30

let lastFetchAt = 0
let refreshing = false

export interface TodoistProject {
  id: string
  name: string
  color: string
  isShared: boolean
  isArchived: boolean
  collaborators: Array<{ id: string; name: string; email: string }>
}

export interface TodoistStatus {
  linked?: boolean
  lastSuccessAt?: string
  taskCount?: number
  lastError?: string
}

let status: TodoistStatus = {}
const subs = new Set<() => void>()

function setStatus(patch: TodoistStatus): void {
  status = { ...status, ...patch }
  subs.forEach((fn) => fn())
}

export const getTodoistStatus = (): TodoistStatus => status
export function subscribeTodoistStatus(fn: () => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}

const now = () => new Date().toISOString()

async function callFn(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const sb = getSupabase()
  if (!sb) throw new Error('sync není nakonfigurovaný')
  const { data } = await sb.auth.getSession()
  if (!data.session) throw new Error('nepřihlášeno')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/todoist`, {
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

// --- propojení ---

// Token jde rovnou do Supabase (RLS bez policies) a klient ho už nikdy
// nedostane zpátky — v prohlížeči po něm nezůstane stopa.
export async function linkTodoist(token: string): Promise<void> {
  const sb = getSupabase()
  if (!sb) throw new Error('nejdřív se přihlas')
  const { error } = await sb.rpc('store_todoist_token', { token: token.trim() })
  if (error) throw new Error(error.message)
  await callFn('projects') // ověření, že token opravdu platí
  setStatus({ linked: true, lastError: undefined })
}

export async function unlinkTodoist(): Promise<void> {
  const sb = getSupabase()
  if (!sb) return
  const { error } = await sb.rpc('forget_todoist_token')
  if (error) throw new Error(error.message)
  setStatus({ linked: false, lastSuccessAt: undefined, taskCount: undefined, lastError: undefined })
}

export async function checkTodoistLinked(): Promise<boolean> {
  const sb = getSupabase()
  if (!sb) return false
  const { data, error } = await sb.rpc('has_todoist_token')
  const linked = !error && Boolean(data)
  setStatus({ linked })
  return linked
}

export async function fetchTodoistProjects(): Promise<{
  projects: TodoistProject[]
  user: { id: string; email: string; name: string }
}> {
  const res = await callFn('projects')
  return {
    projects: (res.projects ?? []) as TodoistProject[],
    user: (res.user ?? { id: '', email: '', name: '' }) as { id: string; email: string; name: string },
  }
}

// --- stahování ---

export function initTodoist(): void {
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
  await refreshTodoist()
}

async function linkedClients(): Promise<Client[]> {
  return db.clients
    .filter((c) => !c.deletedAt && (c.todoistProjectIds?.length ?? 0) > 0)
    .toArray()
}

export async function refreshTodoist(force = false): Promise<void> {
  if (refreshing || !navigator.onLine || !getSupabase()) return
  if (force) lastFetchAt = 0
  const clients = await linkedClients()
  if (clients.length === 0) return

  const clientOf = new Map<string, string>() // todoist projekt → náš klient
  for (const c of clients) for (const pid of c.todoistProjectIds ?? []) clientOf.set(pid, c.id)
  const projectIds = [...clientOf.keys()]

  refreshing = true
  lastFetchAt = Date.now()
  try {
    const completedSince = new Date(Date.now() - COMPLETED_WINDOW_DAYS * 86400_000).toISOString()
    const res = await callFn('pull', { projectIds, completedSince })
    const count = await importTodoist(
      {
        myUid: (res.myUid as string) || undefined,
        sections: (res.sections ?? []) as TodoistSection[],
        tasks: (res.tasks ?? []) as TodoistTask[],
        completed: (res.completed ?? []) as TodoistTask[],
        clientOf,
      },
      { close: pushClose, reopen: pushReopen },
    )

    emitRepoWrite()
    setStatus({ linked: true, lastSuccessAt: now(), taskCount: count, lastError: undefined })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('todoist:', message)
    setStatus({ lastError: message })
  } finally {
    refreshing = false
  }
}

async function pushClose(todoistId: string): Promise<void> {
  try {
    await callFn('close', { taskId: todoistId })
  } catch (e) {
    console.warn('todoist close:', e instanceof Error ? e.message : e)
  }
}

async function pushReopen(todoistId: string): Promise<void> {
  try {
    await callFn('reopen', { taskId: todoistId })
  } catch (e) {
    console.warn('todoist reopen:', e instanceof Error ? e.message : e)
  }
}
