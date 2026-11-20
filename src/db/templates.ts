// Šablony pravidelných úkolů (Fáze 4).
//
// Reconciler generuje instance úkolů dopředu (HORIZON dní) pro každého
// klienta s nasazenou šablonou. Instance mají deterministické id odvozené
// z (klient, položka šablony, den) — obě zařízení vygenerují totéž a sync
// nevyrábí duplikáty. Smazaná instance (tombstone) se díky tomu už nikdy
// nevygeneruje znovu. Úprava šablony se propíše do budoucích nehotových
// instancí; zrušené položky/šablony budoucí instance tiše stáhnou.
//
// Instance záměrně nevznikají přes repo.addTask — automatika nemá počítat
// jako „aktivita" klienta (rozbila by hlídání zanedbaných klientů).

import { db } from './db'
import { emitRepoWrite } from './events'
import type { Project, Task, Template, TemplateItem } from './types'
import { deterministicUuid } from '../lib/deterministicId'
import { addDays, fromISODate, toISODate, todayISO } from '../lib/dates'
import { RULE_EPOCH, occurrencesBetween } from '../lib/rrule'
import { mojeId, updateClient } from './repo'

export const GENERATION_HORIZON_DAYS = 90

const now = () => new Date().toISOString()

// ---------- CRUD šablon ----------

export async function addTemplate(name: string, items: TemplateItem[] = []): Promise<Template> {
  const template: Template = {
    id: crypto.randomUUID(),
    createdAt: now(),
    updatedAt: now(),
    name,
    items,
  }
  await db.templates.add(template)
  emitRepoWrite()
  return template
}

// Kopie šablony s čerstvými id položek — pro odladění varianty
// (např. „Správa PPC — malý klient") bez rozbití té nasazené.
export async function duplicateTemplate(id: string): Promise<Template | null> {
  const original = await db.templates.get(id)
  if (!original || original.deletedAt) return null
  return addTemplate(
    `${original.name} (kopie)`,
    original.items.map(({ id: _dropped, ...rest }) => newTemplateItem(rest)),
  )
}

export async function updateTemplate(id: string, patch: Partial<Template>): Promise<void> {
  await db.templates.update(id, { ...patch, updatedAt: now() })
  emitRepoWrite()
  await reconcileTemplates()
}

// Vrací, komu se šablona stáhla — bez toho by ji „Vrátit" nasadilo zpátky
// všem, nebo nikomu.
export interface PlanVraceniSablony {
  templateId: string
  clientIds: string[]
}

export async function removeTemplate(id: string): Promise<PlanVraceniSablony> {
  const t = now()
  await db.templates.update(id, { deletedAt: t, updatedAt: t })
  // stáhnout z klientů, kteří ji měli nasazenou
  const clients = await db.clients.filter((c) => !c.deletedAt && c.templateIds.includes(id)).toArray()
  for (const c of clients) {
    await updateClient(c.id, { templateIds: c.templateIds.filter((x) => x !== id) })
  }
  emitRepoWrite()
  await reconcileTemplates()
  return { templateId: id, clientIds: clients.map((c) => c.id) }
}

// Vrácení smazané šablony i s nasazením. Úkoly z ní se nevrací ručně —
// dogeneruje je reconciler, protože přesně to je jeho práce.
export async function restoreTemplate(plan: PlanVraceniSablony): Promise<void> {
  const t = now()
  await db.templates.update(plan.templateId, { deletedAt: undefined, updatedAt: t })
  for (const clientId of plan.clientIds) {
    const c = await db.clients.get(clientId)
    if (!c || c.deletedAt || c.templateIds.includes(plan.templateId)) continue
    await updateClient(clientId, { templateIds: [...c.templateIds, plan.templateId] })
  }
  emitRepoWrite()
  await reconcileTemplates()
}

export const activeTemplates = () =>
  db.templates
    .filter((t) => !t.deletedAt)
    .toArray()
    .then((ts) => ts.sort((a, b) => a.name.localeCompare(b.name, 'cs')))

export function newTemplateItem(input: Omit<TemplateItem, 'id'>): TemplateItem {
  return { id: crypto.randomUUID(), ...input }
}

// ---------- Nasazení na klienta ----------

export async function deployTemplate(clientId: string, templateId: string): Promise<void> {
  const client = await db.clients.get(clientId)
  if (!client || client.templateIds.includes(templateId)) return
  await updateClient(clientId, { templateIds: [...client.templateIds, templateId] })
  await reconcileTemplates()
}

export async function undeployTemplate(clientId: string, templateId: string): Promise<void> {
  const client = await db.clients.get(clientId)
  if (!client) return
  await updateClient(clientId, { templateIds: client.templateIds.filter((x) => x !== templateId) })
  await reconcileTemplates()
}

// ---------- Reconciler ----------

let running = false

export async function reconcileTemplates(): Promise<void> {
  if (running) return
  running = true
  try {
    await reconcileOnce()
  } finally {
    running = false
  }
}

async function reconcileOnce(): Promise<void> {
  const today = todayISO()
  const horizon = toISODate(addDays(fromISODate(today), GENERATION_HORIZON_DAYS))
  const templates = new Map(
    (await db.templates.filter((t) => !t.deletedAt).toArray()).map((t) => [t.id, t]),
  )
  // Všichni nesmazaní klienti: aktivním se generuje, u ostatních (pauza,
  // archiv, po undeployi) se budoucí instance stahují.
  const clients = await db.clients.filter((c) => !c.deletedAt).toArray()

  let changed = false
  const ja = await mojeId()

  for (const client of clients) {
    type Wanted = { item: TemplateItem; date: string; projectId?: string }
    const wanted = new Map<string, Wanted>()

    if (client.status === 'active') {
      const projectCache = new Map<string, string>()
      for (const templateId of client.templateIds) {
        const template = templates.get(templateId)
        if (!template) continue
        for (const item of template.items) {
          let projectId: string | undefined
          if (item.defaultProjectName) {
            projectId = await ensureProject(client.id, item.defaultProjectName, projectCache)
          }
          let dates: string[]
          try {
            dates = occurrencesBetween(item.recurrenceRule, RULE_EPOCH, today, horizon)
          } catch {
            continue // nevalidní pravidlo nesmí shodit celý reconcile
          }
          for (const date of dates) {
            const id = await deterministicUuid('tpl', client.id, item.id, date)
            wanted.set(id, { item, date, projectId })
          }
        }
      }
    }

    // existující vygenerované úkoly klienta (včetně tombstonů — ty nechat být)
    const existing = await db.tasks
      .where('clientId')
      .equals(client.id)
      .filter((t) => Boolean(t.sourceTemplateItemId))
      .toArray()
    const existingById = new Map(existing.map((t) => [t.id, t]))

    // založit chybějící / propsat úpravy šablony do budoucích nehotových
    for (const [id, w] of wanted) {
      const ex = existingById.get(id)
      if (!ex) {
        // Instance s tímhle id může existovat u JINÉHO klienta — člověk ji
        // přesunul ve slotu Klient. Dotaz výš je podle klienta, takže ji
        // nevidí, a `add` by spadl na duplicitním klíči a shodil celý
        // reconcile pro všechny klienty (a to při každém běhu, dokud den
        // výskytu nepřejde). Přesunutá instance už je; nezakládá se znovu.
        if (await db.tasks.get(id)) continue
        const t = now()
        const task: Task = {
          id,
          createdAt: t,
          updatedAt: t,
          clientId: client.id,
          projectId: w.projectId,
          title: w.item.title,
          priority: w.item.priority,
          dueDate: w.date,
          status: 'active',
          sourceTemplateItemId: w.item.id,
          sourceDate: w.date,
          order: 0,
        }
        await db.tasks.add(task)
        changed = true
      } else if (
        !ex.deletedAt &&
        (ex.status === 'active' || ex.status === 'inbox') &&
        (ex.title !== w.item.title || ex.priority !== w.item.priority || ex.projectId !== w.projectId)
      ) {
        await db.tasks.update(id, {
          title: w.item.title,
          priority: w.item.priority,
          projectId: w.projectId,
          updatedAt: now(),
        })
        changed = true
      }
    }

    // stáhnout osiřelé budoucí nehotové instance (undeploy / smazaná položka /
    // změněné pravidlo → jiná id)
    for (const ex of existing) {
      if (ex.deletedAt || (ex.status !== 'active' && ex.status !== 'inbox')) continue
      if (wanted.has(ex.id)) continue
      // Šablony jsou soukromé svému autorovi. Na zařízení kolegy, se kterým
      // klienta sdílím, šablona není, takže tam vypadá každá instance jako
      // osiřelá — a jeho tombstone by ji podle last-write-wins smazal
      // i mně. Uklízí se jen vlastní instance (bez razítka = ještě
      // neodeslaná, tedy taky moje).
      if (ex.ownerId && ja && ex.ownerId !== ja) continue
      // Rozhoduje den VÝSKYTU, ne termín: instance přesunutá z dneška na
      // zítřek (nebo propadlá poslaná triáží na dnešek) má id po dni,
      // který už nechceme, a dřív se proto při příštím běhu smazala.
      const den = ex.sourceDate ?? ex.dueDate
      if (!den || den < today) continue
      // Instance přesunutá k tomuhle klientovi od jiného nese id po tom
      // druhém — uklízet ji tady by byl zásah do cizího výskytu.
      if (
        ex.sourceDate &&
        ex.sourceTemplateItemId &&
        (await deterministicUuid('tpl', client.id, ex.sourceTemplateItemId, ex.sourceDate)) !== ex.id
      ) {
        continue
      }
      const t = now()
      await db.tasks.update(ex.id, { deletedAt: t, updatedAt: t })
      changed = true
    }
  }

  if (changed) emitRepoWrite()
}

// Najde (bez ohledu na velikost písmen), nebo založí projekt daného jména.
async function ensureProject(
  clientId: string,
  name: string,
  cache: Map<string, string>,
): Promise<string> {
  const key = name.toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached
  const existing = await db.projects
    .where('clientId')
    .equals(clientId)
    .filter((p) => !p.deletedAt && p.name.toLowerCase() === key)
    .first()
  if (existing) {
    cache.set(key, existing.id)
    return existing.id
  }
  const order = await db.projects.where('clientId').equals(clientId).count()
  const project: Project = {
    id: crypto.randomUUID(),
    createdAt: now(),
    updatedAt: now(),
    clientId,
    name,
    status: 'active',
    order,
  }
  await db.projects.add(project)
  cache.set(key, project.id)
  return project.id
}
