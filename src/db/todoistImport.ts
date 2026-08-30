// Srovnání stavu z Todoistu s lokální databází (Fáze 8).
// Žádná síť — odškrtnutí a znovuotevření se posílají přes `push`, který
// dodá synchronizační vrstva. Díky tomu se dá celé srovnání otestovat.

import { db } from './db'
import type { Project, Task } from './types'
import { deterministicUuid } from '../lib/deterministicId'
import { estimateTaskMinutes } from '../lib/estimate'
import { differs, isMine, ownedFields, patchFrom, subtasksFrom, type TodoistTask } from '../lib/todoistMap'

export interface TodoistSection {
  id: string
  projectId: string
  name: string
}

export interface TodoistPush {
  close(todoistId: string): Promise<void>
  reopen(todoistId: string): Promise<void>
}

export interface TodoistSnapshot {
  myUid?: string
  sections: TodoistSection[]
  tasks: TodoistTask[] // aktivní
  completed: TodoistTask[]
  clientOf: Map<string, string> // todoist projekt → náš klient
}

const now = () => new Date().toISOString()

// Sekce v Todoistu → projekty pod klientem. Deterministické id znamená,
// že obě zařízení vyrobí tentýž projekt a sync z toho nedělá duplikát.
async function importSections(
  sections: TodoistSection[],
  clientOf: Map<string, string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const sec of sections) {
    const clientId = clientOf.get(sec.projectId)
    if (!clientId) continue
    const id = await deterministicUuid('todoist-section', sec.id)
    out.set(sec.id, id)
    const existing = await db.projects.get(id)
    const t = now()
    if (!existing) {
      const project: Project = {
        id,
        createdAt: t,
        updatedAt: t,
        clientId,
        name: sec.name,
        status: 'active',
        order: 0,
        todoistSectionId: sec.id,
      }
      await db.projects.add(project)
    } else if (!existing.deletedAt && (existing.name !== sec.name || existing.clientId !== clientId)) {
      await db.projects.update(id, { name: sec.name, clientId, updatedAt: t })
    }
  }
  return out
}

export async function importTodoist(snap: TodoistSnapshot, push: TodoistPush): Promise<number> {
  const active = snap.tasks.filter((t) => isMine(t, snap.myUid))
  const completed = snap.completed.filter((t) => isMine(t, snap.myUid))
  const projectOfSection = await importSections(snap.sections, snap.clientOf)
  const projectIds = [...snap.clientOf.keys()]

  // Podúkoly (parent_id) nejsou samostatné úkoly — jsou to položky
  // checklistu. Hotové podúkoly chodí v completed, proto se sbírají z obou
  // seznamů, jinak by odškrtnutý krok z checklistu prostě zmizel.
  const rootIds = new Set(active.filter((t) => !t.parentId).map((t) => t.id))
  const children = new Map<string, TodoistTask[]>()
  for (const t of [...active, ...completed]) {
    if (t.parentId && rootIds.has(t.parentId)) {
      const list = children.get(t.parentId) ?? []
      list.push(t)
      children.set(t.parentId, list)
    }
  }

  const seen = new Set<string>()
  const t = now()
  let count = 0

  for (const td of active) {
    if (td.parentId && rootIds.has(td.parentId)) continue // je to položka checklistu
    const clientId = td.projectId ? snap.clientOf.get(td.projectId) : undefined
    if (!clientId) continue
    const localId = await deterministicUuid('todoist', td.id)
    seen.add(localId)
    count++
    const existing = await db.tasks.get(localId)
    if (existing?.deletedAt) continue // smazal jsem ho tady — tombstone vyhrává
    const fields = ownedFields(td, children.get(td.id) ?? [], {
      clientId,
      projectId: td.sectionId ? projectOfSection.get(td.sectionId) : undefined,
    })

    if (!existing) {
      const task: Task = {
        id: localId,
        createdAt: t,
        updatedAt: t,
        status: fields.dueDate || fields.scheduledFor ? 'active' : 'inbox',
        order: 0,
        ...fields,
        // Když Todoist délku úkolu nezná, platí náš tichý odhad —
        // kalendářní blok musí mít z čeho vyjít.
        estimateMinutes: fields.estimateMinutes ?? estimateTaskMinutes(fields.title),
      }
      await db.tasks.add(task)
      continue
    }
    // Odškrtnuto tady, v Todoistu pořád otevřené → dotáhnout to tam.
    if (existing.status === 'done') {
      await push.close(td.id)
      continue
    }
    if (differs(existing, fields)) await db.tasks.update(localId, { ...patchFrom(fields), updatedAt: t })
  }

  for (const td of completed) {
    if (td.parentId && rootIds.has(td.parentId)) continue
    const localId = await deterministicUuid('todoist', td.id)
    const existing = await db.tasks.get(localId)
    if (!existing || existing.deletedAt) continue // historii do appky netaháme
    seen.add(localId)
    const subtasks = subtasksFrom(children.get(td.id) ?? [])
    if (existing.status !== 'done') {
      if (existing.todoistDoneAt && existing.todoistDoneAt === td.completedAt) {
        // Tohle dokončení už jsme jednou převzali a úkol je přesto otevřený
        // → otevřel jsem ho tady schválně, tak ho otevřít i v Todoistu.
        await push.reopen(td.id)
        continue
      }
      await db.tasks.update(localId, {
        status: 'done',
        completedAt: td.completedAt ?? t,
        todoistDoneAt: td.completedAt,
        subtasks,
        updatedAt: t,
      })
    } else if (existing.todoistDoneAt !== td.completedAt) {
      await db.tasks.update(localId, { todoistDoneAt: td.completedAt, updatedAt: t })
    }
  }

  // Co v Todoistu není ani mezi aktivními, ani mezi hotovými, tam přestalo
  // existovat (smazáno, přesunuto jinam). Hotové úkoly necháváme být — ty
  // jen vypadly z okna hotových a jsou to naše záznamy o odvedené práci.
  const gone = await db.tasks
    .filter(
      (x) =>
        !x.deletedAt &&
        Boolean(x.todoistId) &&
        x.status !== 'done' &&
        Boolean(x.todoistProjectId && projectIds.includes(x.todoistProjectId)) &&
        !seen.has(x.id),
    )
    .toArray()
  for (const x of gone) await db.tasks.update(x.id, { deletedAt: t, updatedAt: t })

  return count
}
