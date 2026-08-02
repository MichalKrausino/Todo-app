import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { addClient, completeTask } from './repo'
import { checkFrequencyOf, getClientCheckTask, setClientCheck } from './clientCheck'

async function resetDb() {
  await Promise.all(db.tables.map((t) => t.clear()))
}

describe('pravidelná kontrola klienta', () => {
  beforeEach(resetDb)

  it('zapnutí založí opakující se úkol s termínem za jednu periodu', async () => {
    const client = await addClient({ name: 'Klient X', color: '#fff', kind: 'client' })
    await setClientCheck(client, 'weekly')

    const task = await getClientCheckTask(client.id)
    expect(task).toBeDefined()
    expect(task!.title).toBe('Zkontrolovat Klient X')
    expect(task!.isClientCheck).toBe(true)
    expect(checkFrequencyOf(task)).toBe('weekly')
    const days = (Date.parse(task!.dueDate!) - Date.parse(new Date().toLocaleDateString('sv'))) / 86400000
    expect(days).toBe(7)
  })

  it('je idempotentní a změna frekvence přepíše pravidlo bez odkladu', async () => {
    const client = await addClient({ name: 'K', color: '#fff', kind: 'client' })
    await setClientCheck(client, 'weekly')
    await setClientCheck(client, 'weekly') // beze změny
    let all = await db.tasks.filter((t) => !t.deletedAt && Boolean(t.isClientCheck)).toArray()
    expect(all).toHaveLength(1)

    await setClientCheck(client, 'monthly')
    all = await db.tasks.filter((t) => !t.deletedAt && Boolean(t.isClientCheck)).toArray()
    expect(all).toHaveLength(1)
    expect(checkFrequencyOf(all[0])).toBe('monthly')
    expect(all[0].postponeCount).toBeUndefined()
  })

  it('vypnutí připomínku odstraní', async () => {
    const client = await addClient({ name: 'K', color: '#fff', kind: 'client' })
    await setClientCheck(client, 'biweekly')
    await setClientCheck(client, null)
    expect(await getClientCheckTask(client.id)).toBeUndefined()
  })

  it('po odškrtnutí se kontrola sama vrátí s markerem', async () => {
    const client = await addClient({ name: 'K', color: '#fff', kind: 'client' })
    await setClientCheck(client, 'weekly')
    const task = (await getClientCheckTask(client.id))!

    await completeTask(task.id)
    const next = await getClientCheckTask(client.id)
    expect(next).toBeDefined()
    expect(next!.id).not.toBe(task.id)
    expect(next!.isClientCheck).toBe(true)
    expect(next!.dueDate! > task.dueDate!).toBe(true)
  })
})
