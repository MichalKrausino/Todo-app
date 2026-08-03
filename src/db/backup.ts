// Záloha a obnova dat do/ze souboru JSON — pojistka nezávislá na syncu.
// Exportují se všechny synchronizované tabulky včetně tombstonů (přesná
// kopie stavu); cache kalendáře a lokální kurzory syncu se neexportují.

import { db } from './db'
import { emitRepoWrite } from './events'

const BACKUP_TABLES = ['clients', 'projects', 'tasks', 'templates', 'dayPlans'] as const

export interface BackupFile {
  app: 'todo-app'
  format: 1
  exportedAt: string
  data: Record<(typeof BACKUP_TABLES)[number], unknown[]>
}

export async function exportBackup(): Promise<BackupFile> {
  const data = {} as BackupFile['data']
  for (const name of BACKUP_TABLES) {
    data[name] = await db.table(name).toArray()
  }
  return { app: 'todo-app', format: 1, exportedAt: new Date().toISOString(), data }
}

// Obnova: záznamy se vloží po id (bulkPut) — existující se přepíšou,
// nic dalšího se nemaže. Push kurzory se vynulují, aby další sync
// poslal všechno na server (tam rozhodne last-write-wins).
export async function importBackup(parsed: unknown): Promise<number> {
  const file = parsed as Partial<BackupFile> | null
  if (!file || file.app !== 'todo-app' || file.format !== 1 || typeof file.data !== 'object') {
    throw new Error('Tohle není záloha z téhle appky.')
  }
  let count = 0
  const tables = [...BACKUP_TABLES.map((n) => db.table(n)), db.table('syncState')]
  await db.transaction('rw', tables, async () => {
    for (const name of BACKUP_TABLES) {
      const rows = file.data?.[name]
      if (!Array.isArray(rows)) continue
      await db.table(name).bulkPut(rows)
      count += rows.length
    }
    const pushKeys = (await db.syncState.toArray())
      .map((r) => r.id)
      .filter((id) => id.startsWith('push:'))
    await db.syncState.bulkDelete(pushKeys)
  })
  emitRepoWrite()
  return count
}
