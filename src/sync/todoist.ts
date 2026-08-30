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
import { emitRepoWrite, onRepoWrite } from '../db/events'
import { importTodoist, type TodoistSection } from '../db/todoistImport'
import type { Client, Task } from '../db/types'
import { deterministicUuid } from '../lib/deterministicId'
import { priorityToTodoist, type TodoistTask } from '../lib/todoistMap'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { getSupabase } from './engine'
import { getSyncStatus, subscribeSyncStatus } from './status'

const REFRESH_MIN_INTERVAL_MS = 5 * 60_000
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
  // Projekty, na které jsem přišel o přístup — stažení kvůli nim nespadne,
  // jen se o nich řekne, ať je můžu odpojit.
  unreachable?: string[]
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

let pushTimer: ReturnType<typeof setTimeout> | undefined

export function initTodoist(): void {
  // Nový úkol u klienta se zapnutým psaním nemá čekat na další stažení.
  onRepoWrite(() => {
    clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      if (!navigator.onLine || !getSupabase()) return
      void pushNewTasks()
      void pushTodoistEdits()
    }, 2500)
  })

  subscribeSyncStatus(() => {
    const s = getSyncStatus()
    if (s.phase === 'idle' && s.lastSyncAt) void maybeRefreshTodoist()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void maybeRefreshTodoist()
  })
}

// Obnova s pojistkou proti zbytečnému opakování — volá ji plánovač
// (src/sync/live.ts) i návrat do popředí.
export async function maybeRefreshTodoist(): Promise<void> {
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
    // Nejdřív ven, pak dovnitř — jinak by stažení přebilo úpravu,
    // kterou jsem udělal offline.
    await pushTodoistEdits()
    await pushNewTasks()

    const completedSince = new Date(Date.now() - COMPLETED_WINDOW_DAYS * 86400_000).toISOString()
    const res = await callFn('pull', { projectIds, completedSince })
    const failed = (res.failed ?? []) as Array<{ projectId: string }>
    const count = await importTodoist(
      {
        myUid: (res.myUid as string) || undefined,
        sections: (res.sections ?? []) as TodoistSection[],
        tasks: (res.tasks ?? []) as TodoistTask[],
        completed: (res.completed ?? []) as TodoistTask[],
        clientOf,
        pulled: (res.pulled as string[]) ?? projectIds,
      },
      { close: pushClose, reopen: pushReopen },
    )

    emitRepoWrite()
    setStatus({
      linked: true,
      lastSuccessAt: now(),
      taskCount: count,
      lastError: undefined,
      unreachable: failed.length ? failed.map((f) => f.projectId) : undefined,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('todoist:', message)
    setStatus({ lastError: message })
  } finally {
    refreshing = false
  }
}

// --- zápis do Todoistu ---

// Úprava, kterou jsem udělal v appce. Dokud se neodešle, je úkol
// „todoistDirty" a žádné stažení ho nepřepíše.
export async function pushTodoistEdits(): Promise<void> {
  if (!navigator.onLine || !getSupabase()) return
  const dirty = await db.tasks
    .filter((x) => !x.deletedAt && Boolean(x.todoistId) && x.todoistDirty === true)
    .toArray()
  for (const task of dirty) {
    try {
      const res = await callFn('update', {
        taskId: task.todoistId,
        title: task.title,
        notes: task.notes ?? '',
        priority: priorityToTodoist(task.priority),
        // Termín se musí vrátit do stejného pole, ze kterého přišel.
        ...(task.todoistHasDeadline
          ? { deadline: task.dueDate ?? '' }
          : { dueDate: task.dueDate ?? '', dueTime: task.dueTime }),
      })
      const updated = res.task as TodoistTask | undefined
      await db.tasks.update(task.id, {
        todoistDirty: undefined,
        todoistUpdatedAt: updated?.updatedAt,
        updatedAt: now(),
      })
    } catch (e) {
      // Zůstane rozepsaný a zkusí se při dalším stažení — offline úprava
      // se tak neztratí.
      console.warn('todoist update:', e instanceof Error ? e.message : e)
    }
  }
}

// Založení úkolu z appky přímo v Todoistu. Vrací chybu, nebo null.
export async function sendTaskToTodoist(taskId: string): Promise<string | null> {
  const task = await db.tasks.get(taskId)
  if (!task || task.todoistId) return null
  const client = task.clientId ? await db.clients.get(task.clientId) : undefined
  const projectId = client?.todoistProjectIds?.[0]
  if (!projectId) return 'Klient nemá napojený projekt v Todoistu.'
  const project = task.projectId ? await db.projects.get(task.projectId) : undefined
  try {
    const res = await callFn('create', {
      projectId,
      sectionId: project?.todoistSectionId,
      title: task.title,
      notes: task.notes,
      priority: priorityToTodoist(task.priority),
      dueDate: task.dueDate,
      dueTime: task.dueTime,
    })
    const created = res.task as TodoistTask | undefined
    if (!created?.id) return 'Todoist úkol nevrátil.'
    await adoptCreated(task, created)
    emitRepoWrite()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// Úkol z appky má vlastní id, ale stažení hledá to odvozené z todoistího.
// Přesadíme ho tedy pod odvozené id, ať obě zařízení mluví o témž záznamu
// a nevzniknou dva.
async function adoptCreated(task: Task, created: TodoistTask): Promise<void> {
  const t = now()
  const marks = {
    todoistId: created.id,
    todoistProjectId: created.projectId,
    todoistUpdatedAt: created.updatedAt,
    todoistHasDeadline: Boolean(created.deadline?.date) || undefined,
    todoistRecurring: Boolean(created.due?.isRecurring) || undefined,
  }
  const targetId = await deterministicUuid('todoist', created.id)
  if (targetId === task.id || (await db.tasks.get(targetId))) {
    await db.tasks.update(task.id, { ...marks, updatedAt: t })
    return
  }
  await db.tasks.add({ ...task, ...marks, id: targetId, updatedAt: t })
  await db.tasks.update(task.id, { deletedAt: t, updatedAt: t })
}

// Klient se zapnutým psaním do Todoistu: nové úkoly tam letí samy.
// Rozhoduje razítko todoistPushSince — po zapnutí se nesmí vyvalit ven
// všechno, co jsem si u klienta kdy poznamenal. Interní rutina
// (kontroly klienta, instance šablon) zůstává doma vždycky.
async function pushNewTasks(): Promise<void> {
  const clients = await db.clients
    .filter((c) => !c.deletedAt && Boolean(c.todoistPushSince) && (c.todoistProjectIds?.length ?? 0) > 0)
    .toArray()
  if (clients.length === 0) return
  const since = new Map(clients.map((c) => [c.id, c.todoistPushSince!]))
  const fresh = await db.tasks
    .filter(
      (x) =>
        !x.deletedAt &&
        !x.todoistId &&
        x.status !== 'done' &&
        !x.isClientCheck &&
        !x.sourceTemplateItemId &&
        Boolean(x.clientId && since.has(x.clientId) && x.createdAt >= since.get(x.clientId)!),
    )
    .toArray()
  for (const task of fresh.slice(0, 20)) await sendTaskToTodoist(task.id)
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
