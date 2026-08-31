// Překlad úkolu z Todoistu do našeho datového modelu (Fáze 8).
// Čisté funkce bez sítě a bez Dexie — proto se dají otestovat a proto
// je stahovací vrstva (src/sync/todoist.ts) jen tenká slupka kolem nich.

import type { Priority, Subtask, Task } from '../db/types'
import { toISODate } from './dates'

export interface TodoistDue {
  date?: string // YYYY-MM-DD
  datetime?: string // ISO datetime (může být bez zóny = plovoucí čas)
  isRecurring?: boolean
}

export interface TodoistTask {
  id: string
  projectId?: string
  sectionId?: string
  parentId?: string
  content: string
  description?: string
  priority?: number // 4 = p1 … 1 = p4
  labels?: string[]
  responsibleUid?: string
  checked?: boolean
  completedAt?: string
  updatedAt?: string
  due?: TodoistDue | null
  deadline?: { date?: string } | null
  duration?: { amount: number; unit?: string } | null
}

// Todoist má 4 = nejvyšší, appka slova. p4 (výchozí, tedy 1) je „normal",
// ne „low" — jinak by drtivá většina importovaných úkolů spadla na dno.
// p3 (tedy 2) je jen mírné zvýraznění, na „vysokou" to nedosahuje;
// kdyby ano, byla by vysoká priorita skoro na všem a přestala by značit.
export function priorityFrom(p: number | undefined): Priority {
  if (p === 4) return 'critical'
  if (p === 3) return 'high'
  return 'normal'
}

// Zpátky do Todoistu. „Nízká" u nás je jeho výchozí p4 — Todoist nižší
// stupeň nemá a označovat úkol za podřadný jen kvůli převodu by lhalo.
export function priorityToTodoist(p: Priority): number {
  if (p === 'critical') return 4
  if (p === 'high') return 3
  return 1
}

// Datetime z Todoistu → lokální den a čas. Nikdy toISOString() —
// pražský večer by utekl na další den v UTC.
export function localDayTime(datetime: string): { day: string; time: string } {
  const d = new Date(datetime)
  if (Number.isNaN(d.getTime())) return { day: datetime.slice(0, 10), time: '' }
  const hh = `${d.getHours()}`.padStart(2, '0')
  const mm = `${d.getMinutes()}`.padStart(2, '0')
  return { day: toISODate(d), time: `${hh}:${mm}` }
}

// Todoist rozlišuje `deadline` (dokdy to musí být) a `due` (kdy se tím
// budu zabývat) — přesně náš rozdíl dueDate × scheduledFor. Když deadline
// chybí, bereme `due` jako termín, protože tak ho klienti myslí.
export function datesFrom(t: TodoistTask): {
  dueDate?: string
  dueTime?: string
  scheduledFor?: string
} {
  const deadline = t.deadline?.date
  const due = t.due ?? undefined
  const dueDay = due?.datetime ? localDayTime(due.datetime).day : due?.date
  const dueTime = due?.datetime ? localDayTime(due.datetime).time : undefined

  if (deadline) return { dueDate: deadline, scheduledFor: dueDay, dueTime }
  if (dueDay) return { dueDate: dueDay, dueTime }
  return {}
}

// Délka úkolu z Todoistu je tichý odhad času (kalendářní blok).
export function estimateFrom(duration: TodoistTask['duration']): number | undefined {
  if (!duration || !(duration.amount > 0)) return undefined
  const minutes = duration.unit === 'day' ? duration.amount * 480 : duration.amount
  return Math.min(minutes, 8 * 60)
}

// Ve sdíleném projektu klienta jsou i úkoly cizích lidí. Beru svoje
// a nepřiřazené (klienti často jen píšou úkoly a nepřiřazují je).
export function isMine(t: TodoistTask, myUid: string | undefined): boolean {
  if (!t.responsibleUid) return true
  return Boolean(myUid) && t.responsibleUid === myUid
}

// Podúkoly v Todoistu (parent_id) → náš checklist. Prefix `td-` v id
// říká, že za položkou stojí skutečný úkol v Todoistu — odškrtnutí se
// tam propíše a smazat ho odsud nejde.
export const SUB_PREFIX = 'td-'

export function subtasksFrom(children: TodoistTask[]): Subtask[] | undefined {
  if (children.length === 0) return undefined
  return children.map((c) => ({ id: `${SUB_PREFIX}${c.id}`, title: c.content, done: Boolean(c.checked) }))
}

// Id úkolu v Todoistu, který za položkou checklistu stojí (nebo nic).
export const todoistSubId = (subtaskId: string): string | undefined =>
  subtaskId.startsWith(SUB_PREFIX) ? subtaskId.slice(SUB_PREFIX.length) : undefined

// Vlastní kroky, které jsem si k todoistímu úkolu dopsal, musí stažení
// přežít — jinak by mi je smazalo první obnovení.
export function mergeSubtasks(
  existing: Subtask[] | undefined,
  fromTodoist: Subtask[] | undefined,
): Subtask[] | undefined {
  const mine = (existing ?? []).filter((s) => !s.id.startsWith(SUB_PREFIX))
  const theirs = fromTodoist ?? []
  if (mine.length === 0 && theirs.length === 0) return undefined
  return [...theirs, ...mine]
}

// Pole, která u importovaného úkolu vlastní Todoist. Všechno ostatní
// (naplánování na den, špendlík, kalendářní blok) zůstává naše.
export interface TodoistOwnedFields {
  title: string
  notes?: string
  priority: Priority
  dueDate?: string
  dueTime?: string
  scheduledFor?: string
  estimateMinutes?: number
  subtasks?: Subtask[]
  clientId?: string
  projectId?: string
  todoistId: string
  todoistProjectId?: string
  todoistUpdatedAt?: string
  todoistRecurring?: boolean
  todoistHasDeadline?: boolean
}

export function ownedFields(
  t: TodoistTask,
  children: TodoistTask[],
  link: { clientId: string; projectId?: string },
): TodoistOwnedFields {
  const dates = datesFrom(t)
  return {
    title: t.content.trim() || '(bez názvu)',
    notes: t.description?.trim() || undefined,
    priority: priorityFrom(t.priority),
    dueDate: dates.dueDate,
    dueTime: dates.dueTime,
    scheduledFor: dates.scheduledFor,
    estimateMinutes: estimateFrom(t.duration),
    subtasks: subtasksFrom(children),
    clientId: link.clientId,
    projectId: link.projectId,
    todoistId: t.id,
    todoistProjectId: t.projectId,
    todoistUpdatedAt: t.updatedAt,
    todoistRecurring: Boolean(t.due?.isRecurring) || undefined,
    todoistHasDeadline: Boolean(t.deadline?.date) || undefined,
  }
}

// Co u importovaného úkolu vlastní Todoist. Rozdíl je zásadní:
// název, priorita a termín patří Todoistu vždycky (i když je smaže),
// kdežto naplánování na den, odhad, poznámku a checklist si Todoist bere
// jen tehdy, když je sám má. Jinak by mi každé stažení smazalo den,
// na který jsem si klientův úkol naplánoval.
const ALWAYS_OWNED = [
  'title',
  'priority',
  'dueDate',
  'dueTime',
  'clientId',
  'projectId',
  'todoistId',
  'todoistProjectId',
  'todoistUpdatedAt',
  'todoistRecurring',
  'todoistHasDeadline',
] as const

const OWNED_WHEN_SET = ['scheduledFor', 'estimateMinutes', 'notes', 'subtasks'] as const

// Změny k zápisu — bez klíčů, které Todoist tentokrát nemá co říct.
export function patchFrom(fields: TodoistOwnedFields): Partial<Task> {
  const patch: Partial<Task> = {}
  for (const k of ALWAYS_OWNED) Object.assign(patch, { [k]: fields[k] })
  for (const k of OWNED_WHEN_SET) {
    if (fields[k] !== undefined) Object.assign(patch, { [k]: fields[k] })
  }
  return patch
}

// Zapisovat se má jen když se opravdu něco změnilo — jinak by každé
// stažení orazítkovalo updatedAt a rozjelo zbytečný push do Supabase.
export function differs(existing: Task, next: TodoistOwnedFields): boolean {
  const patch = patchFrom(next)
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'subtasks') {
      if (JSON.stringify(existing.subtasks ?? null) !== JSON.stringify(v ?? null)) return true
      continue
    }
    if ((existing[k as keyof Task] ?? undefined) !== (v ?? undefined)) return true
  }
  return false
}
