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
// nic dalšího se nemaže. Obnovené záznamy odejdou samy (evidence
// odeslaných verzí v `pushState` pozná, že se liší od odeslané), a server
// o nich rozhodne podle last-write-wins. Jeho rozhodnutí se ale musí
// i STÁHNOUT: kurzory stahování se proto vynulují. Dokud se nechávaly,
// zůstal novější stav ze serveru (třeba tombstone klienta, kvůli kterému
// člověk zálohu obnovoval) za kurzorem a tohle zařízení ukazovalo
// obnovená data navždy, zatímco server i ostatní zařízení je měly smazaná.
export async function importBackup(parsed: unknown): Promise<number> {
  const file = parsed as Partial<BackupFile> | null
  // `typeof null === 'object'`, takže bez explicitní kontroly by soubor
  // s `data: null` validací prošel, nic neobnovil a tvářil se úspěšně —
  // uživatel by z „0 záznamů" usoudil, že záloha byla prázdná.
  if (
    !file ||
    file.app !== 'todo-app' ||
    file.format !== 1 ||
    typeof file.data !== 'object' ||
    file.data === null
  ) {
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
    const kurzory = (await db.syncState.toArray())
      .map((r) => r.id)
      .filter((id) => id.startsWith('pull:') || id.startsWith('push:'))
    await db.syncState.bulkDelete(kurzory)
  })
  emitRepoWrite()
  return count
}
