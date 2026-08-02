// Pravidelná připomínka kontroly klienta: opakující se úkol „Zkontrolovat X"
// označený isClientCheck. V den kontroly se objeví na Dnes, po odškrtnutí
// se sám založí na další termín (respawn v completeTask marker zachová).

import { db } from './db'
import { emitRepoWrite } from './events'
import { addTask, removeTask } from './repo'
import type { Client, Task } from './types'
import { addDays, fromISODate, toISODate, todayISO } from '../lib/dates'
import { presetFromRule, ruleFromPreset } from '../lib/rrule'

export type CheckFrequency = 'weekly' | 'biweekly' | 'monthly'

export const CHECK_FREQUENCY_LABELS: Record<CheckFrequency, string> = {
  weekly: 'Týdně',
  biweekly: 'Každé 2 týdny',
  monthly: 'Měsíčně',
}

// První kontrola po jedné periodě od dneška; pravidlo se kotví k tomu dni.
function scheduleFor(freq: CheckFrequency, today: string): { dueDate: string; rule: string } {
  if (freq === 'monthly') {
    const d = fromISODate(today)
    const day = Math.min(d.getDate(), 28)
    const dueDate = toISODate(new Date(d.getFullYear(), d.getMonth() + 1, day))
    return { dueDate, rule: ruleFromPreset('monthly', dueDate) }
  }
  const dueDate = toISODate(addDays(fromISODate(today), freq === 'weekly' ? 7 : 14))
  return { dueDate, rule: ruleFromPreset(freq, dueDate) }
}

export const getClientCheckTask = (clientId: string): Promise<Task | undefined> =>
  db.tasks
    .where('clientId')
    .equals(clientId)
    .filter(
      (t) => !t.deletedAt && Boolean(t.isClientCheck) && (t.status === 'inbox' || t.status === 'active'),
    )
    .first()

export function checkFrequencyOf(task: Task | undefined): CheckFrequency | null {
  if (!task?.recurrenceRule) return null
  const preset = presetFromRule(task.recurrenceRule)
  return preset === 'weekly' || preset === 'biweekly' || preset === 'monthly' ? preset : null
}

// Zapne, přenastaví, nebo vypne (freq = null) pravidelnou kontrolu klienta.
export async function setClientCheck(client: Client, freq: CheckFrequency | null): Promise<void> {
  const existing = await getClientCheckTask(client.id)

  if (!freq) {
    if (existing) await removeTask(existing.id)
    return
  }

  const { dueDate, rule } = scheduleFor(freq, todayISO())
  if (existing) {
    if (checkFrequencyOf(existing) === freq) return
    // přímý zápis: přenastavení frekvence není odklad, počítadlo se nezvedá
    await db.tasks.update(existing.id, {
      recurrenceRule: rule,
      dueDate,
      postponeCount: undefined,
      updatedAt: new Date().toISOString(),
    })
    emitRepoWrite()
  } else {
    await addTask({
      title: `Zkontrolovat ${client.name}`,
      clientId: client.id,
      dueDate,
      recurrenceRule: rule,
      isClientCheck: true,
    })
  }
}
