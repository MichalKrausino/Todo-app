// Testy reconcileru nad fake IndexedDB — import 'fake-indexeddb/auto'
// musí být první, aby Dexie dostala globální indexedDB.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { addClient, completeTask, removeTask, updateTask } from './repo'
import { addDays, fromISODate, toISODate, todayISO } from '../lib/dates'
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

  // Denní pravidlo: instance na dnešek existuje vždycky, takže se dá
  // ověřit posun z dne, který zítra už nebude „chtěný".
  const denniSablona = async (clientId: string) => {
    const template = await addTemplate('T')
    await updateTemplate(template.id, {
      items: [newTemplateItem({ title: 'Denní kontrola', recurrenceRule: 'FREQ=DAILY', priority: 'normal' })],
    })
    await deployTemplate(clientId, template.id)
    return (await openInstances()).find((t) => t.dueDate === todayISO())!
  }

  it('instance posunutá z minulého dne se nesmaže', async () => {
    // Výskyt z 12. poslaný triáží na dnešek má id po 12., které už
    // nechceme — a úklid ho podle dneška smazal hned při dalším běhu.
    const client = await addClient({ name: 'K', color: '#fff', kind: 'client' })
    const dnesni = await denniSablona(client.id)
    const vcera = toISODate(addDays(fromISODate(todayISO()), -1))
    const zitra = toISODate(addDays(fromISODate(todayISO()), 1))
    // výskyt ze včerejška, který člověk posunul na zítřek
    await db.tasks.put({ ...dnesni, id: crypto.randomUUID(), sourceDate: vcera, dueDate: zitra })
    const presunuta = (await db.tasks.filter((t) => t.sourceDate === vcera).first())!
    await reconcileTemplates()
    expect((await db.tasks.get(presunuta.id))?.deletedAt).toBeUndefined()
  })

  it('instanci kolegy zařízení bez šablony nesmaže', async () => {
    // Šablony jsou soukromé: na kolegově zařízení vypadá každá instance
    // jako osiřelá a jeho tombstone by ji smazal i majiteli.
    const client = await addClient({ name: 'K', color: '#fff', kind: 'client' })
    const dnesni = await denniSablona(client.id)
    await db.syncState.put({ id: 'meta', userId: 'kolega' } as never)
    await db.tasks.update(dnesni.id, { ownerId: 'majitel' })
    await db.templates.clear() // kolega šablonu nemá
    await reconcileTemplates()
    expect((await db.tasks.get(dnesni.id))?.deletedAt).toBeUndefined()
  })

  it('instance přesunutá k jinému klientovi neshodí generování ostatním', async () => {
    const a = await addClient({ name: 'A', color: '#fff', kind: 'client' })
    const b = await addClient({ name: 'B', color: '#fff', kind: 'client' })
    const dnesni = await denniSablona(a.id)
    await updateTask(dnesni.id, { clientId: b.id })
    // Dřív: `add` s existujícím id → ConstraintError při každém běhu.
    await expect(reconcileTemplates()).resolves.not.toThrow()
    const presunuta = await db.tasks.get(dnesni.id)
    expect(presunuta?.clientId).toBe(b.id)
    expect(presunuta?.deletedAt).toBeUndefined()
    // a nový klient dostane šablonu normálně
    const c = await addClient({ name: 'C', color: '#fff', kind: 'client' })
    await denniSablona(c.id)
    expect((await openInstances()).some((t) => t.clientId === c.id)).toBe(true)
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

  it('Top 3 dne: připne nejvýš tři úkoly, čtvrtý odmítne', async () => {
    const { addTask, togglePinned } = await import('./repo')
    const day = '2026-08-03'
    const ids: string[] = []
    for (const title of ['a', 'b', 'c', 'd']) {
      ids.push((await addTask({ title, dueDate: day })).id)
    }

    expect(await togglePinned(ids[0], day)).toBe(true)
    expect(await togglePinned(ids[1], day)).toBe(true)
    expect(await togglePinned(ids[2], day)).toBe(true)
    expect(await togglePinned(ids[3], day)).toBe(false) // plno

    // odepnutí uvolní místo
    expect(await togglePinned(ids[0], day)).toBe(true)
    expect((await db.tasks.get(ids[0]))?.pinnedFor).toBeUndefined()
    expect(await togglePinned(ids[3], day)).toBe(true)
    expect((await db.tasks.get(ids[3]))?.pinnedFor).toBe(day)
  })

  it('Top 3 dne: špendlík platí jen pro svůj den', async () => {
    const { addTask, togglePinned } = await import('./repo')
    const t = await addTask({ title: 'včerejší špendlík', dueDate: '2026-08-02' })
    await togglePinned(t.id, '2026-08-02')

    // jiný den má vlastní kapacitu — starý špendlík ji neblokuje
    const others = []
    for (const title of ['x', 'y', 'z']) {
      others.push((await addTask({ title, dueDate: '2026-08-03' })).id)
    }
    for (const id of others) expect(await togglePinned(id, '2026-08-03')).toBe(true)
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

  it('respawn nedědí špendlík Top 3 dne', async () => {
    const { addTask, togglePinned } = await import('./repo')
    const t = await addTask({ title: 'Denní kontrola', dueDate: '2026-07-31' })
    await db.tasks.update(t.id, { recurrenceRule: 'FREQ=DAILY' })
    await togglePinned(t.id, '2026-07-31')
    await completeTask(t.id)

    const successor = await db.tasks
      .filter((x) => !x.deletedAt && x.status === 'active')
      .first()
    expect(successor?.pinnedFor).toBeUndefined()
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
