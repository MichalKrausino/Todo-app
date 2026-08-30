// Srovnání s Todoistem nad fake IndexedDB — import 'fake-indexeddb/auto'
// musí být první, aby Dexie dostala globální indexedDB.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { importTodoist, unlinkTodoistProject, type TodoistPush, type TodoistSnapshot } from './todoistImport'
import type { TodoistTask } from '../lib/todoistMap'
import { deterministicUuid } from '../lib/deterministicId'

const CLIENT = 'klient-1'
const PROJ = '220'

const clientOf = () => new Map([[PROJ, CLIENT]])

const td = (patch: Partial<TodoistTask> = {}): TodoistTask => ({
  id: '7001',
  projectId: PROJ,
  content: 'Připravit report',
  priority: 1,
  ...patch,
})

const snap = (patch: Partial<TodoistSnapshot> = {}): TodoistSnapshot => ({
  myUid: 'me',
  sections: [],
  tasks: [],
  completed: [],
  clientOf: clientOf(),
  ...patch,
})

let closed: string[] = []
let reopened: string[] = []
const push: TodoistPush = {
  close: async (id) => {
    closed.push(id)
  },
  reopen: async (id) => {
    reopened.push(id)
  },
}

const localId = (todoistId: string) => deterministicUuid('todoist', todoistId)

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  closed = []
  reopened = []
})

describe('importTodoist', () => {
  it('založí úkol pod klientem a podruhé už nic nepřepisuje', async () => {
    const s = snap({ tasks: [td({ due: { date: '2026-05-04' }, updatedAt: 'u1' })] })
    expect(await importTodoist(s, push)).toBe(1)

    const task = await db.tasks.get(await localId('7001'))
    expect(task?.title).toBe('Připravit report')
    expect(task?.clientId).toBe(CLIENT)
    expect(task?.dueDate).toBe('2026-05-04')
    expect(task?.status).toBe('active')

    const before = task!.updatedAt
    await importTodoist(s, push)
    expect((await db.tasks.get(task!.id))?.updatedAt).toBe(before)
  })

  it('úkol bez termínu spadne do inboxu', async () => {
    await importTodoist(snap({ tasks: [td()] }), push)
    expect((await db.tasks.get(await localId('7001')))?.status).toBe('inbox')
  })

  it('cizí přiřazený úkol se netahá', async () => {
    await importTodoist(snap({ tasks: [td({ responsibleUid: 'nekdo-jiny' })] }), push)
    expect(await db.tasks.count()).toBe(0)
  })

  it('sekce se stane projektem a úkol do něj spadne', async () => {
    await importTodoist(
      snap({
        sections: [{ id: '55', projectId: PROJ, name: 'Kampaně' }],
        tasks: [td({ sectionId: '55' })],
      }),
      push,
    )
    const project = await db.projects.get(await deterministicUuid('todoist-section', '55'))
    expect(project?.name).toBe('Kampaně')
    expect(project?.clientId).toBe(CLIENT)
    expect((await db.tasks.get(await localId('7001')))?.projectId).toBe(project!.id)
  })

  it('podúkoly se složí do checklistu', async () => {
    await importTodoist(
      snap({
        tasks: [td(), td({ id: '7002', parentId: '7001', content: 'Sesbírat data' })],
        completed: [td({ id: '7003', parentId: '7001', content: 'Zadat přístupy', checked: true })],
      }),
      push,
    )
    expect(await db.tasks.count()).toBe(1)
    const task = await db.tasks.get(await localId('7001'))
    expect(task?.subtasks?.map((s) => [s.title, s.done])).toEqual([
      ['Sesbírat data', false],
      ['Zadat přístupy', true],
    ])
  })

  it('změna názvu v Todoistu se propíše', async () => {
    await importTodoist(snap({ tasks: [td({ updatedAt: 'u1' })] }), push)
    await importTodoist(snap({ tasks: [td({ content: 'Report za duben', updatedAt: 'u2' })] }), push)
    expect((await db.tasks.get(await localId('7001')))?.title).toBe('Report za duben')
  })

  it('odškrtnutí v appce zavře úkol i v Todoistu', async () => {
    await importTodoist(snap({ tasks: [td()] }), push)
    await db.tasks.update(await localId('7001'), { status: 'done', completedAt: 'kdysi' })
    await importTodoist(snap({ tasks: [td()] }), push)
    expect(closed).toEqual(['7001'])
  })

  it('dokončení v Todoistu dokončí úkol v appce', async () => {
    await importTodoist(snap({ tasks: [td()] }), push)
    await importTodoist(
      snap({ completed: [td({ checked: true, completedAt: '2026-05-05T09:00:00Z' })] }),
      push,
    )
    const task = await db.tasks.get(await localId('7001'))
    expect(task?.status).toBe('done')
    expect(task?.completedAt).toBe('2026-05-05T09:00:00Z')
    expect(reopened).toEqual([])
  })

  it('znovuotevření v appce otevře úkol i v Todoistu', async () => {
    const done = snap({ completed: [td({ checked: true, completedAt: 'C1' })] })
    await importTodoist(snap({ tasks: [td()] }), push)
    await importTodoist(done, push) // hotovo tam → hotovo tady
    await db.tasks.update(await localId('7001'), { status: 'active', completedAt: undefined })
    await importTodoist(done, push) // otevřel jsem to tady
    expect(reopened).toEqual(['7001'])
    expect((await db.tasks.get(await localId('7001')))?.status).toBe('active')
  })

  it('smazaný úkol v Todoistu zmizí i tady, hotové zůstanou', async () => {
    await importTodoist(snap({ tasks: [td(), td({ id: '7009', content: 'Druhý' })] }), push)
    await db.tasks.update(await localId('7009'), { status: 'done', completedAt: 'kdysi' })
    await importTodoist(snap({ tasks: [] }), push)
    expect((await db.tasks.get(await localId('7001')))?.deletedAt).toBeTruthy()
    expect((await db.tasks.get(await localId('7009')))?.deletedAt).toBeUndefined()
  })

  it('úkol smazaný v appce se nevrátí', async () => {
    await importTodoist(snap({ tasks: [td()] }), push)
    await db.tasks.update(await localId('7001'), { deletedAt: 'smazano' })
    await importTodoist(snap({ tasks: [td()] }), push)
    expect((await db.tasks.get(await localId('7001')))?.deletedAt).toBe('smazano')
  })

  it('poznámku, checklist ani odhad z appky import nesmaže', async () => {
    await importTodoist(snap({ tasks: [td({ updatedAt: 'u1' })] }), push)
    const id = await localId('7001')
    await db.tasks.update(id, {
      notes: 'moje poznámka',
      subtasks: [{ id: 'a', title: 'můj krok', done: false }],
      estimateMinutes: 45,
    })
    await importTodoist(snap({ tasks: [td({ content: 'Nový název', updatedAt: 'u2' })] }), push)
    const task = await db.tasks.get(id)
    expect(task?.title).toBe('Nový název')
    expect(task?.notes).toBe('moje poznámka')
    expect(task?.subtasks).toHaveLength(1)
    expect(task?.estimateMinutes).toBe(45)
  })

  it('nový úkol dostane tichý odhad času, i když ho Todoist nemá', async () => {
    await importTodoist(snap({ tasks: [td()] }), push)
    expect((await db.tasks.get(await localId('7001')))?.estimateMinutes).toBeGreaterThan(0)
  })

  it('opakovaný úkol se po odškrtnutí nezavírá podruhé, jen se posune', async () => {
    // Todoist opakovaný úkol nezavře — posune ho na další termín pod týmž
    // id. Druhý close by ho posunul znovu, o týden dál.
    const rec = (due: string) => td({ due: { date: due, isRecurring: true }, updatedAt: due })
    await importTodoist(snap({ tasks: [rec('2026-05-04')] }), push)
    const id = await localId('7001')
    await db.tasks.update(id, { status: 'done', completedAt: '2026-05-04T09:00:00Z' })

    await importTodoist(snap({ tasks: [rec('2026-05-11')] }), push)

    expect(closed).toEqual([]) // žádné druhé zavření
    const live = await db.tasks.get(id)
    expect(live?.status).toBe('active')
    expect(live?.dueDate).toBe('2026-05-11')
    expect(live?.completedAt).toBeUndefined()

    const history = (await db.tasks.toArray()).filter((x) => x.status === 'done' && !x.todoistId)
    expect(history).toHaveLength(1)
    expect(history[0].dueDate).toBe('2026-05-04') // hotový výskyt zůstal v historii
  })

  it('opakovaný úkol se stejným termínem se zavře jako každý jiný', async () => {
    const rec = td({ due: { date: '2026-05-04', isRecurring: true } })
    await importTodoist(snap({ tasks: [rec] }), push)
    await db.tasks.update(await localId('7001'), { status: 'done', completedAt: 'kdysi' })
    await importTodoist(snap({ tasks: [rec] }), push)
    expect(closed).toEqual(['7001'])
  })

  it('neodeslanou lokální úpravu stažení nepřepíše', async () => {
    await importTodoist(snap({ tasks: [td({ updatedAt: 'u1' })] }), push)
    const id = await localId('7001')
    await db.tasks.update(id, { title: 'Můj vlastní název', todoistDirty: true })
    await importTodoist(snap({ tasks: [td({ content: 'Změna z Todoistu', updatedAt: 'u2' })] }), push)
    expect((await db.tasks.get(id))?.title).toBe('Můj vlastní název')
  })

  it('projekt, který se nepodařilo stáhnout, o úkoly nepřijde', async () => {
    await importTodoist(snap({ tasks: [td()] }), push)
    // stažení proběhlo, ale tenhle projekt v něm nebyl (ztracený přístup)
    await importTodoist(snap({ tasks: [], pulled: [] }), push)
    expect((await db.tasks.get(await localId('7001')))?.deletedAt).toBeUndefined()
  })

  it('úkol založený z appky se nezdvojí (hledá se podle značky)', async () => {
    const t = new Date().toISOString()
    await db.tasks.add({
      id: 'moje-vlastni-id', createdAt: t, updatedAt: t, title: 'Připravit report',
      priority: 'normal', status: 'active', order: 0, clientId: CLIENT,
      todoistId: '7001', todoistProjectId: PROJ,
    })
    await importTodoist(snap({ tasks: [td({ content: 'Připravit report — v2' })] }), push)
    const all = (await db.tasks.toArray()).filter((x) => !x.deletedAt)
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('moje-vlastni-id')
    expect(all[0].title).toBe('Připravit report — v2')
  })

  it('odpojení projektu úkoly nechá, jen z nich sundá značky', async () => {
    await importTodoist(snap({ tasks: [td()] }), push)
    const count = await unlinkTodoistProject(PROJ)
    expect(count).toBe(1)
    const task = await db.tasks.get(await localId('7001'))
    expect(task?.deletedAt).toBeUndefined()
    expect(task?.todoistId).toBeUndefined()
    expect(task?.title).toBe('Připravit report')
  })

  it('projekt bez spárovaného klienta se ignoruje', async () => {
    await importTodoist(snap({ tasks: [td({ projectId: '999' })] }), push)
    expect(await db.tasks.count()).toBe(0)
  })

  it('naplánování na den import nepřepíše', async () => {
    await importTodoist(snap({ tasks: [td({ due: { date: '2026-05-04' }, updatedAt: 'u1' })] }), push)
    const id = await localId('7001')
    await db.tasks.update(id, { scheduledFor: '2026-05-02', pinnedFor: '2026-05-02' })
    await importTodoist(snap({ tasks: [td({ due: { date: '2026-05-04' }, updatedAt: 'u1' })] }), push)
    const task = await db.tasks.get(id)
    expect(task?.scheduledFor).toBe('2026-05-02')
    expect(task?.pinnedFor).toBe('2026-05-02')
  })
})
