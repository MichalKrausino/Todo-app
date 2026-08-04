// Jediná vrstva, přes kterou UI čte a zapisuje data.
// Razítkuje updatedAt, maže výhradně tombstonem (deletedAt) a filtruje smazané záznamy.

import { db } from './db'
import { emitRepoWrite } from './events'
import type { Client, ClientKind, Priority, Project, Task, TaskStatus } from './types'
import { deterministicUuid } from '../lib/deterministicId'
import { todayISO } from '../lib/dates'
import { estimateTaskMinutes } from '../lib/estimate'
import { nextOccurrence } from '../lib/rrule'

const now = () => new Date().toISOString()

const newRecord = () => ({
  id: crypto.randomUUID(),
  createdAt: now(),
  updatedAt: now(),
})

// ---------- Klienti ----------

export async function addClient(input: {
  name: string
  color: string
  kind: ClientKind
  notes?: string
}): Promise<Client> {
  const client: Client = {
    ...newRecord(),
    status: 'active',
    templateIds: [],
    lastActivityAt: now(),
    ...input,
  }
  await db.clients.add(client)
  emitRepoWrite()
  return client
}

export async function updateClient(id: string, patch: Partial<Client>): Promise<void> {
  await db.clients.update(id, { ...patch, updatedAt: now() })
  emitRepoWrite()
}

export async function removeClient(id: string): Promise<void> {
  const t = now()
  await db.transaction('rw', db.clients, db.projects, db.tasks, async () => {
    await db.clients.update(id, { deletedAt: t, updatedAt: t })
    await db.projects.where('clientId').equals(id).modify({ deletedAt: t, updatedAt: t })
    await db.tasks.where('clientId').equals(id).modify({ deletedAt: t, updatedAt: t })
  })
  emitRepoWrite()
}

export const getClient = (id: string) => db.clients.get(id)

export const activeClients = () =>
  db.clients
    .filter((c) => !c.deletedAt && c.status !== 'archived')
    .toArray()
    .then((cs) => cs.sort((a, b) => a.name.localeCompare(b.name, 'cs')))

export const archivedClients = () =>
  db.clients
    .filter((c) => !c.deletedAt && c.status === 'archived')
    .toArray()
    .then((cs) => cs.sort((a, b) => a.name.localeCompare(b.name, 'cs')))

export const allClients = () => db.clients.filter((c) => !c.deletedAt).toArray()

// Projekt „bez klienta" bydlí v oblasti Interní/Osobní. Když oblast ještě
// neexistuje, tiše se založí — uživatel jen vybere, kam projekt patří.
const AREA_DEFAULTS: Record<'internal' | 'personal', { name: string; color: string }> = {
  internal: { name: 'Interní', color: '#5856D6' }, // indigo z CLIENT_COLORS
  personal: { name: 'Osobní', color: '#34C759' }, // zelená z CLIENT_COLORS
}

export async function ensureAreaClient(kind: 'internal' | 'personal'): Promise<Client> {
  const existing = await db.clients
    .filter((c) => !c.deletedAt && c.status === 'active' && c.kind === kind)
    .first()
  if (existing) return existing
  return addClient({ kind, ...AREA_DEFAULTS[kind] })
}

// ---------- Projekty ----------

export async function addProject(input: {
  clientId: string
  name: string
  goal?: string
}): Promise<Project> {
  const order = await db.projects.where('clientId').equals(input.clientId).count()
  const project: Project = { ...newRecord(), status: 'active', order, ...input }
  await db.projects.add(project)
  emitRepoWrite()
  return project
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  await db.projects.update(id, { ...patch, updatedAt: now() })
  emitRepoWrite()
}

export async function removeProject(id: string): Promise<void> {
  const t = now()
  await db.transaction('rw', db.projects, db.tasks, async () => {
    await db.projects.update(id, { deletedAt: t, updatedAt: t })
    // Úkoly zůstávají pod klientem, jen přijdou o projekt.
    await db.tasks.where('projectId').equals(id).modify({ projectId: undefined, updatedAt: t })
  })
  emitRepoWrite()
}

export const clientProjects = (clientId: string) =>
  db.projects
    .where('clientId')
    .equals(clientId)
    .filter((p) => !p.deletedAt && p.status !== 'archived')
    .toArray()
    .then((ps) => ps.sort((a, b) => a.order - b.order))

export const allProjects = () => db.projects.filter((p) => !p.deletedAt).toArray()

// ---------- Úkoly ----------

export async function addTask(input: {
  title: string
  clientId?: string
  projectId?: string
  priority?: Priority
  dueDate?: string
  dueTime?: string
  scheduledFor?: string
  notes?: string
  recurrenceRule?: string
  isClientCheck?: boolean
}): Promise<Task> {
  const status: TaskStatus = input.dueDate || input.scheduledFor ? 'active' : 'inbox'
  const task: Task = {
    ...newRecord(),
    priority: input.priority ?? 'normal',
    order: 0,
    status,
    // tichý odhad času (Fáze 5) — jen pro délku bloku v kalendáři
    estimateMinutes: estimateTaskMinutes(input.title),
    ...input,
  }
  await db.tasks.add(task)
  if (task.clientId) {
    await db.clients.update(task.clientId, { lastActivityAt: task.createdAt, updatedAt: task.createdAt })
  }
  emitRepoWrite()
  return task
}

// Nejbližší relevantní den úkolu — dřívější z „naplánováno“ a „termín“.
const effectiveDate = (due?: string, scheduled?: string): string | undefined => {
  const dates = [scheduled, due].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  const existing = await db.tasks.get(id)
  const stamped: Partial<Task> = { ...patch, updatedAt: now() }
  // Posun na pozdější den = odklad. Počítadlo je podklad pro tiché signály
  // („odloženo už 4×") a týdenní zpětnou vazbu (Fáze 7).
  if (existing) {
    const oldEff = effectiveDate(existing.dueDate, existing.scheduledFor)
    const newEff = effectiveDate(
      'dueDate' in patch ? patch.dueDate : existing.dueDate,
      'scheduledFor' in patch ? patch.scheduledFor : existing.scheduledFor,
    )
    if (oldEff && newEff && newEff > oldEff) {
      stamped.postponeCount = (existing.postponeCount ?? 0) + 1
    }
  }
  await db.tasks.update(id, stamped)
  emitRepoWrite()
}

// „Top 3 dne" — kolik úkolů smí být připíchnutých najednou. Tři je
// záměrné: víc priorit než tři už není priorita.
export const MAX_PINNED = 3

// Připnutí/odepnutí na daný den. Vrací false, když je plno — UI to řekne
// nahlas místo tichého ignorování.
export async function togglePinned(id: string, day: string): Promise<boolean> {
  const task = await db.tasks.get(id)
  if (!task) return false
  if (task.pinnedFor === day) {
    await updateTask(id, { pinnedFor: undefined })
    return true
  }
  const pinned = await db.tasks
    .filter((t) => !t.deletedAt && t.pinnedFor === day && t.status !== 'done')
    .count()
  if (pinned >= MAX_PINNED) return false
  await updateTask(id, { pinnedFor: day })
  return true
}

export async function completeTask(id: string): Promise<void> {
  const t = now()
  await db.tasks.update(id, { status: 'done', completedAt: t, updatedAt: t })
  const task = await db.tasks.get(id)
  if (task?.clientId) {
    await db.clients.update(task.clientId, { lastActivityAt: t, updatedAt: t })
  }
  await respawnRecurring(task, t)
  emitRepoWrite()
}

// Opakující se úkol se po dokončení sám založí na další termín.
// Deterministické id (řetěz z původního úkolu) brání duplikátům, když
// tentýž úkol odškrtnou obě zařízení offline.
async function respawnRecurring(task: Task | undefined, t: string): Promise<void> {
  if (!task?.recurrenceRule || !task.dueDate) return
  const after = task.dueDate > todayISO() ? task.dueDate : todayISO()
  let next: string | null
  try {
    next = nextOccurrence(task.recurrenceRule, task.dueDate, after)
  } catch {
    return // nevalidní pravidlo nesmí rozbít odškrtnutí
  }
  if (!next) return
  const nid = await deterministicUuid('respawn', task.id, next)
  if (await db.tasks.get(nid)) return
  const successor: Task = {
    ...task,
    id: nid,
    createdAt: t,
    updatedAt: t,
    status: 'active',
    dueDate: next,
    scheduledFor: undefined,
    completedAt: undefined,
    calendarEventId: undefined,
    postponeCount: undefined, // nový výskyt začíná s čistým štítem
    subtasks: task.subtasks?.map((s) => ({ ...s, done: false })), // checklist znovu od nuly
    pinnedFor: undefined, // špendlík patřil dnešku, ne dalšímu výskytu
  }
  await db.tasks.add(successor)
}

export async function reopenTask(id: string): Promise<void> {
  const task = await db.tasks.get(id)
  if (!task) return
  const status: TaskStatus = task.dueDate || task.scheduledFor ? 'active' : 'inbox'
  await db.tasks.update(id, { status, completedAt: undefined, updatedAt: now() })
  emitRepoWrite()
}

export async function removeTask(id: string): Promise<void> {
  const t = now()
  await db.tasks.update(id, { deletedAt: t, updatedAt: t })
  emitRepoWrite()
}

// Follow-up ze schůzky (dokončení Fáze 3): úkol „Follow-up: <schůzka>"
// na dnešek. Deterministické id (událost + den) — opakované ťuknutí ani
// druhé zařízení nevyrobí duplikát; tombstone smazaného follow-upu vyhrává.
export async function addMeetingFollowUp(event: {
  id: string
  title: string
}): Promise<Task | null> {
  const day = todayISO()
  const id = await deterministicUuid('followup', event.id, day)
  const existing = await db.tasks.get(id)
  if (existing) return null // už existuje (nebo byl vědomě smazán)
  const t = new Date().toISOString()
  const task: Task = {
    id,
    createdAt: t,
    updatedAt: t,
    title: `Follow-up: ${event.title}`,
    priority: 'normal',
    order: 0,
    status: 'active',
    scheduledFor: day,
    estimateMinutes: 30,
  }
  await db.tasks.add(task)
  emitRepoWrite()
  return task
}

export const openTasks = () =>
  db.tasks
    .where('status')
    .anyOf('inbox', 'active')
    .filter((t) => !t.deletedAt)
    .toArray()

// Všechny živé úkoly včetně dokončených — podklad týdenní zpětné vazby.
export const allLiveTasks = () => db.tasks.filter((t) => !t.deletedAt).toArray()

// Pro globální vyhledávání — všechny nesmazané úkoly včetně hotových.
export const allTasks = () => db.tasks.filter((t) => !t.deletedAt).toArray()

export const doneOn = (dateISO: string) =>
  db.tasks
    .where('status')
    .equals('done')
    .filter((t) => !t.deletedAt && (t.completedAt ?? '').startsWith(dateISO))
    .toArray()

export const clientOpenTasks = (clientId: string) =>
  db.tasks
    .where('clientId')
    .equals(clientId)
    .filter((t) => !t.deletedAt && (t.status === 'inbox' || t.status === 'active'))
    .toArray()

// ---------- Kalendář — čtení lokální cache (Fáze 3) ----------

// Má cache kalendáře vůbec nějaká data? (0 = kalendář ještě nepropojen)
export const calendarCacheCount = () => db.calendarEvents.count()

export const calendarEventsOn = (day: string) =>
  db.calendarEvents
    .filter((e) => e.startDay <= day && day <= e.endDay)
    .toArray()
    .then((es) => es.sort((a, b) => Number(a.allDay) - Number(b.allDay) || a.start.localeCompare(b.start)))

export const calendarEventsBetween = (from: string, to: string) =>
  db.calendarEvents.filter((e) => e.endDay >= from && e.startDay <= to).toArray()

// ---------- Ranní návrh dne (Fáze 6) ----------

export const getDayPlan = (date: string) =>
  db.dayPlans.filter((p) => !p.deletedAt && p.date === date).first()

// Reakce na návrh (přijmout/zamítnout) — synchronizuje se zpět na server,
// aby se z rozhodnutí dalo později učit (Fáze 5).
export async function decideDayPlanSuggestion(
  planId: string,
  taskId: string,
  decision: 'accepted' | 'rejected',
): Promise<void> {
  const plan = await db.dayPlans.get(planId)
  if (!plan) return
  const suggestions = plan.suggestions.map((s) => (s.taskId === taskId ? { ...s, decision } : s))
  await db.dayPlans.update(planId, { suggestions, updatedAt: now() })
  if (decision === 'accepted') {
    const task = await db.tasks.get(taskId)
    if (task && (task.status === 'inbox' || task.status === 'active')) {
      await db.tasks.update(taskId, {
        scheduledFor: plan.date,
        status: 'active',
        updatedAt: now(),
      })
    }
  }
  emitRepoWrite()
}

const PRIO_WEIGHT: Record<Priority, number> = { critical: 3, high: 2, normal: 1, low: 0 }

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      PRIO_WEIGHT[b.priority] - PRIO_WEIGHT[a.priority] ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
      a.createdAt.localeCompare(b.createdAt),
  )
}
