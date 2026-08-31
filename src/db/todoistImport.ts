// Srovnání stavu z Todoistu s lokální databází (Fáze 8).
// Žádná síť — odškrtnutí a znovuotevření se posílají přes `push`, který
// dodá synchronizační vrstva. Díky tomu se dá celé srovnání otestovat.

import { db } from './db'
import type { Project, Task } from './types'
import { deterministicUuid } from '../lib/deterministicId'
import { estimateTaskMinutes } from '../lib/estimate'
import {
  differs,
  isMine,
  mergeSubtasks,
  ownedFields,
  patchFrom,
  subtasksFrom,
  type TodoistTask,
} from '../lib/todoistMap'

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
  // Projekty, které se opravdu podařilo stáhnout. Úklid „co v Todoistu
  // zmizelo" se smí týkat jenom jich — u projektu, na který jsem přišel
  // o přístup, by jinak zmizely úkoly, které tam pořád jsou.
  pulled?: string[]
  // Nenapojené projekty, ze kterých přišel jen výběr „přiřazeno mně".
  // Server je pošle jen tehdy, když prošel i dotaz na hotové úkoly —
  // teprve pak se pozná odškrtnutí od smazání a smí se uklízet.
  assignedProjects?: string[]
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

// Úkol založený z appky si nese vlastní id, ne to odvozené z todoistího.
// Proto se hledá nejdřív podle značky a teprve pak podle odvozeného id —
// jinak by z jednoho úkolu vznikly dva.
async function byTodoistId(todoistId: string, localId: string): Promise<Task | undefined> {
  const marked = await db.tasks.where('todoistId').equals(todoistId).first()
  return marked ?? (await db.tasks.get(localId))
}

// Hotový výskyt opakovaného úkolu si necháváme jako čistě lokální záznam
// (bez todoistId), aby týdenní ohlédnutí vidělo, že práce proběhla.
// Deterministické id = tentýž výskyt vznikne na obou zařízeních jen jednou.
async function archiveOccurrence(task: Task, t: string): Promise<void> {
  const day = task.dueDate ?? task.completedAt?.slice(0, 10) ?? t.slice(0, 10)
  const id = await deterministicUuid('todoist-vyskyt', task.todoistId ?? task.id, day)
  if (await db.tasks.get(id)) return
  await db.tasks.add({
    ...task,
    id,
    createdAt: task.createdAt,
    updatedAt: t,
    status: 'done',
    completedAt: task.completedAt ?? t,
    todoistId: undefined,
    todoistProjectId: undefined,
    todoistUpdatedAt: undefined,
    todoistDoneAt: undefined,
    todoistRecurring: undefined,
    todoistDirty: undefined,
    pinnedFor: undefined,
  })
}

export async function importTodoist(snap: TodoistSnapshot, push: TodoistPush): Promise<number> {
  const active = snap.tasks.filter((t) => isMine(t, snap.myUid))
  const completed = snap.completed.filter((t) => isMine(t, snap.myUid))
  const projectOfSection = await importSections(snap.sections, snap.clientOf)
  const projectIds = [...(snap.pulled ?? [...snap.clientOf.keys()]), ...(snap.assignedProjects ?? [])]

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
    // Úkol z nenapojeného projektu klienta nemá — je to úkol přiřazený
    // mně osobně a spadne do inboxu. Dřív se takový úkol přeskočil, takže
    // co mi někdo zadal mimo spárované projekty, se do appky nedostalo.
    // Bereme z nich ale jen to, co na mě vysloveně visí: nepřiřazený úkol
    // v cizím projektu je práce někoho jiného, ne moje.
    const clientId = td.projectId ? snap.clientOf.get(td.projectId) : undefined
    const prirazenoMne = Boolean(snap.myUid) && td.responsibleUid === snap.myUid
    if (!clientId && !prirazenoMne) continue
    const localId = await deterministicUuid('todoist', td.id)
    const existing = await byTodoistId(td.id, localId)
    seen.add(existing?.id ?? localId)
    count++
    if (existing?.deletedAt) continue // smazal jsem ho tady — tombstone vyhrává
    const fields = ownedFields(td, children.get(td.id) ?? [], {
      clientId,
      projectId: td.sectionId ? projectOfSection.get(td.sectionId) : undefined,
    })
    // Vlastní kroky dopsané v appce se ke krokům z Todoistu přidají,
    // nepřepíšou se jimi.
    if (existing) fields.subtasks = mergeSubtasks(existing.subtasks, fields.subtasks)

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
    // Lokální úprava ještě neodešla → nesmí ji přepsat stažení.
    if (existing.todoistDirty) continue

    if (existing.status === 'done') {
      // Opakovaný úkol se odškrtnutím v Todoistu nezavře — posune se na
      // další termín a zůstane pod týmž id. Kdybychom tady poslali další
      // close, posunuli bychom ho podruhé. Nový termín tedy znamená nový
      // výskyt: hotový zůstane v historii, živý řádek se vrátí do hry.
      if (existing.todoistRecurring && fields.dueDate && fields.dueDate !== existing.dueDate) {
        await archiveOccurrence(existing, t)
        await db.tasks.update(existing.id, {
          ...patchFrom(fields),
          status: 'active',
          completedAt: undefined,
          todoistDoneAt: undefined,
          scheduledFor: undefined,
          pinnedFor: undefined,
          postponeCount: undefined,
          subtasks: fields.subtasks?.map((sub) => ({ ...sub, done: false })),
          updatedAt: t,
        })
        continue
      }
      // Odškrtnuto tady, v Todoistu pořád otevřené → dotáhnout to tam.
      await push.close(td.id)
      continue
    }
    if (differs(existing, fields)) await db.tasks.update(existing.id, { ...patchFrom(fields), updatedAt: t })
  }

  for (const td of completed) {
    if (td.parentId && rootIds.has(td.parentId)) continue
    const localId = await deterministicUuid('todoist', td.id)
    const existing = await byTodoistId(td.id, localId)
    if (!existing || existing.deletedAt) continue // historii do appky netaháme
    seen.add(existing.id)
    if (existing.todoistDirty) continue // čeká na odeslání, nechat být
    const subtasks = mergeSubtasks(existing.subtasks, subtasksFrom(children.get(td.id) ?? []))
    if (existing.status !== 'done') {
      if (existing.todoistDoneAt && existing.todoistDoneAt === td.completedAt) {
        // Tohle dokončení už jsme jednou převzali a úkol je přesto otevřený
        // → otevřel jsem ho tady schválně, tak ho otevřít i v Todoistu.
        await push.reopen(td.id)
        continue
      }
      await db.tasks.update(existing.id, {
        status: 'done',
        completedAt: td.completedAt ?? t,
        todoistDoneAt: td.completedAt,
        subtasks,
        updatedAt: t,
      })
    } else if (existing.todoistDoneAt !== td.completedAt) {
      await db.tasks.update(existing.id, { todoistDoneAt: td.completedAt, updatedAt: t })
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

// Odpojení projektu od klienta. Úkoly zůstávají — jen přestanou být
// todoistí, takže se dají zase normálně upravovat a nic je nepřepíše.
export async function unlinkTodoistProject(todoistProjectId: string): Promise<number> {
  const rows = await db.tasks.filter((x) => x.todoistProjectId === todoistProjectId).toArray()
  const t = now()
  for (const x of rows) {
    await db.tasks.update(x.id, {
      todoistId: undefined,
      todoistProjectId: undefined,
      todoistUpdatedAt: undefined,
      todoistDoneAt: undefined,
      todoistRecurring: undefined,
      todoistHasDeadline: undefined,
      todoistDirty: undefined,
      updatedAt: t,
    })
  }
  return rows.length
}
