// Testy reconcileru nad fake IndexedDB — import 'fake-indexeddb/auto'
// musí být první, aby Dexie dostala globální indexedDB.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { addClient, completeTask, removeTask } from './repo'
import {
  addTemplate,
  deployTemplate,
  newTemplateItem,
  reconcileTemplates,
  undeployTemplate,
  updateTemplate,
} from './templates'

async function resetDb() {
  await Promise.all(db.tables.map((t) => t.clear()))
}

const openInstances = () =>
  db.tasks
    .filter((t) => !t.deletedAt && Boolean(t.sourceTemplateItemId) && t.status === 'active')
    .toArray()

describe('reconcileTemplates', () => {
  beforeEach(resetDb)

  it('vygeneruje instance v horizontu s deterministickými id a bez duplikátů', async () => {
    const client = await addClient({ name: 'Klient X', color: '#fff', kind: 'client' })
    const template = await addTemplate('Správa PPC')
    await updateTemplate(template.id, {
      items: [
        newTemplateItem({ title: 'Kontrola kampaní', recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR', priority: 'normal' }),
      ],
    })
    await deployTemplate(client.id, template.id)

    const first = await openInstances()
    expect(first.length).toBeGreaterThanOrEqual(4) // ~30 dní ⇒ 4–5 pátků
    expect(new Set(first.map((t) => t.id)).size).toBe(first.length)
    expect(first.every((t) => t.clientId === client.id && t.dueDate)).toBe(true)

    await reconcileTemplates()
    const second = await openInstances()
    expect(second.length).toBe(first.length) // idempotentní
    expect(second.map((t) => t.id).sort()).toEqual(first.map((t) => t.id).sort())
  })

  it('úprava položky se propíše do budoucích nehotových instancí', async () => {
    const client = await addClient({ name: 'K', color: '#fff', kind: 'client' })
    const template = await addTemplate('T')
    const item = newTemplateItem({ title: 'Report', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO', priority: 'normal' })
    await updateTemplate(template.id, { items: [item] })
    await deployTemplate(client.id, template.id)

    await updateTemplate(template.id, { items: [{ ...item, title: 'Měsíční report', priority: 'high' }] })
    const instances = await openInstances()
    expect(instances.every((t) => t.title === 'Měsíční report' && t.priority === 'high')).toBe(true)
  })

  it('undeploy stáhne budoucí instance, hotové zůstanou', async () => {
    const client = await addClient({ name: 'K', color: '#fff', kind: 'client' })
    const template = await addTemplate('T')
    await updateTemplate(template.id, {
      items: [newTemplateItem({ title: 'Check', recurrenceRule: 'FREQ=WEEKLY;BYDAY=WE', priority: 'normal' })],
    })
    await deployTemplate(client.id, template.id)

    const before = await openInstances()
    const done = before[0]
    await completeTask(done.id)

    await undeployTemplate(client.id, template.id)
    const after = await openInstances()
    expect(after.length).toBe(0)
    const kept = await db.tasks.get(done.id)
    expect(kept?.status).toBe('done')
    expect(kept?.deletedAt).toBeUndefined()
  })

  it('ručně smazaná instance se znovu nevygeneruje', async () => {
    const client = await addClient({ name: 'K', color: '#fff', kind: 'client' })
    const template = await addTemplate('T')
    await updateTemplate(template.id, {
      items: [newTemplateItem({ title: 'Check', recurrenceRule: 'FREQ=WEEKLY;BYDAY=TH', priority: 'normal' })],
    })
    await deployTemplate(client.id, template.id)

    const instances = await openInstances()
    await removeTask(instances[0].id)
    await reconcileTemplates()

    const after = await openInstances()
    expect(after.length).toBe(instances.length - 1)
    expect(after.find((t) => t.id === instances[0].id)).toBeUndefined()
  })

  it('defaultProjectName založí projekt jednou a instance do něj zařadí', async () => {
    const client = await addClient({ name: 'K', color: '#fff', kind: 'client' })
    const template = await addTemplate('T')
    await updateTemplate(template.id, {
      items: [
        newTemplateItem({
          title: 'PPC check',
          recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
          priority: 'normal',
          defaultProjectName: 'PPC',
        }),
      ],
    })
    await deployTemplate(client.id, template.id)
    await reconcileTemplates()

    const projects = await db.projects.filter((p) => !p.deletedAt).toArray()
    expect(projects.length).toBe(1)
    expect(projects[0].name).toBe('PPC')
    const instances = await openInstances()
    expect(instances.every((t) => t.projectId === projects[0].id)).toBe(true)
  })
})

describe('počítání odkladů (updateTask)', () => {
  beforeEach(resetDb)

  it('posun na později zvedne počítadlo, posun dopředu ne', async () => {
    const { addTask, updateTask } = await import('./repo')
    const t = await addTask({ title: 'Report', dueDate: '2026-08-03' })

    await updateTask(t.id, { dueDate: '2026-08-05' }) // odklad
    await updateTask(t.id, { dueDate: '2026-08-04' }) // předsunutí — nepočítá se
    await updateTask(t.id, { title: 'Report v2' }) // beze změny data
    await updateTask(t.id, { dueDate: '2026-08-10' }) // druhý odklad

    const after = await db.tasks.get(t.id)
    expect(after?.postponeCount).toBe(2)
  })

  it('respawn opakujícího se úkolu začíná s čistým počítadlem', async () => {
    const { addTask, updateTask } = await import('./repo')
    const t = await addTask({ title: 'Záloha', dueDate: '2026-07-31' })
    await db.tasks.update(t.id, { recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR' })
    await updateTask(t.id, { dueDate: '2026-08-01' })
    await completeTask(t.id)

    const successor = await db.tasks
      .filter((x) => !x.deletedAt && x.status === 'active')
      .first()
    expect(successor?.postponeCount).toBeUndefined()
  })

  it('respawn nuluje checklist podúkolů na nehotové', async () => {
    const { addTask } = await import('./repo')
    const t = await addTask({ title: 'Publikace', dueDate: '2026-07-31' })
    await db.tasks.update(t.id, {
      recurrenceRule: 'FREQ=DAILY',
      subtasks: [
        { id: 's1', title: 'návrh', done: true },
        { id: 's2', title: 'export', done: false },
      ],
    })
    await completeTask(t.id)

    const successor = await db.tasks
      .filter((x) => !x.deletedAt && x.status === 'active')
      .first()
    expect(successor?.subtasks?.length).toBe(2)
    expect(successor?.subtasks?.every((s) => !s.done)).toBe(true)
  })
})

describe('opakování samostatného úkolu (respawn)', () => {
  beforeEach(resetDb)

  it('dokončení založí následníka na další termín, opakovaně bez duplikátu', async () => {
    const { addTask } = await import('./repo')
    const task = await addTask({ title: 'Zálohovat web', dueDate: '2026-07-31' })
    await db.tasks.update(task.id, { recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR' })

    await completeTask(task.id)
    await completeTask(task.id) // druhé odškrtnutí (např. z druhého zařízení)

    const open = await db.tasks.filter((t) => !t.deletedAt && t.status === 'active').toArray()
    expect(open.length).toBe(1)
    expect(open[0].title).toBe('Zálohovat web')
    expect(open[0].recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=FR')
    expect(open[0].dueDate! > '2026-07-31').toBe(true)
  })
})
