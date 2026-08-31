// Záloha do JSON je poslední pojistka proti ztrátě dat — když selže sync
// i zařízení, tohle je jediné, co zbyde. Testuje se proto kolečko tam
// a zpět i to, že se appka nedá nakrmit cizím souborem.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { exportBackup, importBackup } from './backup'
import { addTask, removeTask } from './repo'
import { todayISO } from '../lib/dates'

beforeEach(async () => {
  for (const t of ['clients', 'projects', 'tasks', 'templates', 'dayPlans', 'syncState']) {
    await db.table(t).clear()
  }
})

describe('exportBackup', () => {
  it('nese hlavičku, podle které jde soubor poznat', async () => {
    const zaloha = await exportBackup()
    expect(zaloha.app).toBe('todo-app')
    expect(zaloha.format).toBe(1)
    expect(Date.parse(zaloha.exportedAt)).not.toBeNaN()
  })

  it('bere i smazané záznamy, ne jen živé', async () => {
    // Tombstony musí v záloze zůstat: bez nich by se po obnově vrátily
    // úkoly, které uživatel vědomě smazal.
    const t = await addTask({ title: 'smazaný', dueDate: todayISO() })
    await removeTask(t.id)

    const zaloha = await exportBackup()
    const radek = (zaloha.data.tasks as Array<{ id: string; deletedAt?: string }>).find(
      (x) => x.id === t.id,
    )
    expect(radek?.deletedAt).toBeTruthy()
  })

  it('vyexportuje všechny zálohované tabulky, i když jsou prázdné', async () => {
    const zaloha = await exportBackup()
    for (const t of ['clients', 'projects', 'tasks', 'templates', 'dayPlans'] as const) {
      expect(Array.isArray(zaloha.data[t])).toBe(true)
    }
  })
})

describe('importBackup', () => {
  it('kolečko tam a zpět vrátí data beze změny', async () => {
    const a = await addTask({ title: 'první', dueDate: todayISO(), priority: 'high' })
    const b = await addTask({ title: 'druhý' })
    const zaloha = await exportBackup()

    await db.tasks.clear()
    expect(await db.tasks.count()).toBe(0)

    const pocet = await importBackup(JSON.parse(JSON.stringify(zaloha)))
    expect(pocet).toBe(2)
    expect((await db.tasks.get(a.id))!.title).toBe('první')
    expect((await db.tasks.get(a.id))!.priority).toBe('high')
    expect((await db.tasks.get(b.id))!.status).toBe('inbox')
  })

  it('obnova přepíše záznam téhož id, ostatní nechá být', async () => {
    const a = await addTask({ title: 'původní', dueDate: todayISO() })
    const zaloha = JSON.parse(JSON.stringify(await exportBackup()))

    await db.tasks.update(a.id, { title: 'změněný' })
    const b = await addTask({ title: 'přibyl potom' })

    await importBackup(zaloha)
    expect((await db.tasks.get(a.id))!.title).toBe('původní') // vrácen ze zálohy
    expect(await db.tasks.get(b.id)).toBeTruthy() // nic se nemaže
  })

  it('vynuluje push kurzory, aby se obnovená data odeslala na server', async () => {
    await db.syncState.bulkPut([
      { id: 'push:tasks', value: '2026-08-01T00:00:00.000Z' },
      { id: 'pull:tasks', value: '2026-08-01T00:00:00.000Z' },
    ] as never)

    await importBackup(await exportBackup())

    expect(await db.syncState.get('push:tasks')).toBeUndefined()
    expect(await db.syncState.get('pull:tasks')).toBeTruthy() // pull kurzor zůstává
  })

  it('cizí nebo poškozený soubor odmítne se srozumitelnou hláškou', async () => {
    for (const spatny of [
      null,
      undefined,
      42,
      {},
      { app: 'neco-jineho', format: 1, data: {} },
      { app: 'todo-app', format: 2, data: {} },
      { app: 'todo-app', format: 1 },
      // typeof null === 'object' — bez zvláštní kontroly tohle projde
      // a tiše neobnoví nic
      { app: 'todo-app', format: 1, data: null },
    ]) {
      await expect(importBackup(spatny)).rejects.toThrow(/záloha/i)
    }
  })

  it('chybějící tabulku v souboru přeskočí, zbytek obnoví', async () => {
    await addTask({ title: 'úkol', dueDate: todayISO() })
    const zaloha = JSON.parse(JSON.stringify(await exportBackup()))
    delete zaloha.data.templates
    await db.tasks.clear()

    await expect(importBackup(zaloha)).resolves.toBe(1)
    expect(await db.tasks.count()).toBe(1)
  })
})
