// Denní práce s úkolem: odklad, dokončení, respawn opakování, špendlíky.
// Tyhle cesty se dotýkají všeho, co uživatel dělá každý den, a doteď na ně
// nebyl jediný test — follow-upy měly vlastní soubor, zbytek nic.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  MAX_PINNED,
  addTask,
  completeTask,
  openTasks,
  reopenTask,
  togglePinned,
  updateTask,
} from './repo'
import { addDays, fromISODate, toISODate, todayISO } from '../lib/dates'

const den = (posun: number) => toISODate(addDays(fromISODate(todayISO()), posun))

beforeEach(async () => {
  await db.tasks.clear()
  await db.clients.clear()
})

describe('updateTask — počítadlo odkladů', () => {
  it('posun na pozdější den se počítá jako odklad', async () => {
    const t = await addTask({ title: 'úkol', dueDate: den(0) })
    await updateTask(t.id, { dueDate: den(1) })
    expect((await db.tasks.get(t.id))!.postponeCount).toBe(1)
  })

  it('opakovaný odklad se sčítá', async () => {
    const t = await addTask({ title: 'úkol', dueDate: den(0) })
    await updateTask(t.id, { dueDate: den(1) })
    await updateTask(t.id, { dueDate: den(3) })
    expect((await db.tasks.get(t.id))!.postponeCount).toBe(2)
  })

  it('posun dopředu ani stejný den odklad není', async () => {
    const t = await addTask({ title: 'úkol', dueDate: den(5) })
    await updateTask(t.id, { dueDate: den(2) }) // dřív
    await updateTask(t.id, { dueDate: den(2) }) // beze změny
    expect((await db.tasks.get(t.id))!.postponeCount).toBeUndefined()
  })

  it('úprava, která se termínu netýká, odklad nepřičte', async () => {
    const t = await addTask({ title: 'úkol', dueDate: den(0) })
    await updateTask(t.id, { notes: 'poznámka' })
    expect((await db.tasks.get(t.id))!.postponeCount).toBeUndefined()
  })

  it('rozhoduje dřívější z termínu a naplánování, ne jen termín', async () => {
    // Úkol s termínem za 5 dní, ale naplánovaný na dnešek: přeplánování
    // na zítra je odklad, i když se `dueDate` vůbec nehnul.
    const t = await addTask({ title: 'úkol', dueDate: den(5), scheduledFor: den(0) })
    await updateTask(t.id, { scheduledFor: den(1) })
    expect((await db.tasks.get(t.id))!.postponeCount).toBe(1)
  })

  it('úkol bez termínu odklad nesbírá', async () => {
    const t = await addTask({ title: 'v inboxu' })
    await updateTask(t.id, { title: 'v inboxu jinak' })
    expect((await db.tasks.get(t.id))!.postponeCount).toBeUndefined()
  })
})

describe('completeTask', () => {
  it('označí hotovo a orazítkuje aktivitu u klienta', async () => {
    await db.clients.add({
      id: 'c1',
      name: 'Acme',
      kind: 'client',
      color: '#000',
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never)
    const t = await addTask({ title: 'úkol', clientId: 'c1', dueDate: den(0) })
    await completeTask(t.id)

    const hotovy = (await db.tasks.get(t.id))!
    expect(hotovy.status).toBe('done')
    expect(hotovy.completedAt).toBeTruthy()
    expect((await db.clients.get('c1'))!.lastActivityAt).toBe(hotovy.completedAt)
  })

  it('hotový úkol zmizí z otevřených', async () => {
    const t = await addTask({ title: 'úkol', dueDate: den(0) })
    await completeTask(t.id)
    expect((await openTasks()).map((x) => x.id)).not.toContain(t.id)
  })
})

describe('respawn opakovaného úkolu', () => {
  const KAZDY_DEN = 'FREQ=DAILY'

  it('po dokončení vznikne další výskyt na příští termín', async () => {
    const t = await addTask({ title: 'denní kontrola', dueDate: den(0), recurrenceRule: KAZDY_DEN })
    await completeTask(t.id)

    const dalsi = (await db.tasks.toArray()).filter((x) => x.id !== t.id)
    expect(dalsi).toHaveLength(1)
    expect(dalsi[0].status).toBe('active')
    expect(dalsi[0].dueDate).toBe(den(1))
    expect(dalsi[0].recurrenceRule).toBe(KAZDY_DEN)
  })

  it('dvojí odškrtnutí nevyrobí dva výskyty (deterministické id)', async () => {
    // Přesně to, co hrozí, když tentýž úkol odškrtnou obě zařízení offline.
    const t = await addTask({ title: 'denní kontrola', dueDate: den(0), recurrenceRule: KAZDY_DEN })
    await completeTask(t.id)
    await completeTask(t.id)
    expect(await db.tasks.count()).toBe(2)
  })

  it('nový výskyt začíná s čistým štítem', async () => {
    const t = await addTask({ title: 'denní kontrola', dueDate: den(0), recurrenceRule: KAZDY_DEN })
    await updateTask(t.id, { dueDate: den(0), postponeCount: 3, pinnedFor: den(0) })
    await db.tasks.update(t.id, { subtasks: [{ id: 's1', title: 'krok', done: true }] })
    await completeTask(t.id)

    const novy = (await db.tasks.toArray()).find((x) => x.id !== t.id)!
    expect(novy.postponeCount).toBeUndefined()
    expect(novy.pinnedFor).toBeUndefined()
    expect(novy.completedAt).toBeUndefined()
    expect(novy.scheduledFor).toBeUndefined()
    expect(novy.subtasks?.[0].done).toBe(false) // checklist znovu od nuly
  })

  it('neopakující se úkol žádný nástupce nemá', async () => {
    const t = await addTask({ title: 'jednorázový', dueDate: den(0) })
    await completeTask(t.id)
    expect(await db.tasks.count()).toBe(1)
  })

  it('rozbité pravidlo nesmí shodit odškrtnutí', async () => {
    const t = await addTask({ title: 'úkol', dueDate: den(0), recurrenceRule: 'TOHLE NENÍ RRULE' })
    await expect(completeTask(t.id)).resolves.toBeUndefined()
    expect((await db.tasks.get(t.id))!.status).toBe('done')
  })
})

describe('togglePinned', () => {
  it('připne a odepne tentýž den', async () => {
    const t = await addTask({ title: 'úkol', dueDate: den(0) })
    expect(await togglePinned(t.id, den(0))).toBe(true)
    expect((await db.tasks.get(t.id))!.pinnedFor).toBe(den(0))

    expect(await togglePinned(t.id, den(0))).toBe(true)
    expect((await db.tasks.get(t.id))!.pinnedFor).toBeUndefined()
  })

  it('přes strop Top 3 nepustí a řekne to', async () => {
    for (let i = 0; i < MAX_PINNED; i++) {
      const t = await addTask({ title: `úkol ${i}`, dueDate: den(0) })
      expect(await togglePinned(t.id, den(0))).toBe(true)
    }
    const navic = await addTask({ title: 'čtvrtý', dueDate: den(0) })
    expect(await togglePinned(navic.id, den(0))).toBe(false)
    expect((await db.tasks.get(navic.id))!.pinnedFor).toBeUndefined()
  })

  it('strop platí na den, jiný den má vlastní tři', async () => {
    for (let i = 0; i < MAX_PINNED; i++) {
      const t = await addTask({ title: `dnes ${i}`, dueDate: den(0) })
      await togglePinned(t.id, den(0))
    }
    const zitra = await addTask({ title: 'zítra', dueDate: den(1) })
    expect(await togglePinned(zitra.id, den(1))).toBe(true)
  })

  it('hotový úkol strop neblokuje', async () => {
    for (let i = 0; i < MAX_PINNED; i++) {
      const t = await addTask({ title: `úkol ${i}`, dueDate: den(0) })
      await togglePinned(t.id, den(0))
      if (i === 0) await completeTask(t.id)
    }
    const dalsi = await addTask({ title: 'místo hotového', dueDate: den(0) })
    expect(await togglePinned(dalsi.id, den(0))).toBe(true)
  })
})

describe('reopenTask', () => {
  it('úkol s termínem se vrací mezi aktivní', async () => {
    const t = await addTask({ title: 'úkol', dueDate: den(0) })
    await completeTask(t.id)
    await reopenTask(t.id)

    const vraceny = (await db.tasks.get(t.id))!
    expect(vraceny.status).toBe('active')
    expect(vraceny.completedAt).toBeUndefined()
  })

  it('úkol bez termínu se vrací do inboxu, ne mezi aktivní', async () => {
    const t = await addTask({ title: 'bez termínu' })
    await completeTask(t.id)
    await reopenTask(t.id)
    expect((await db.tasks.get(t.id))!.status).toBe('inbox')
  })
})
