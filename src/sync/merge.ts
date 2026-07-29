// Čistá logika synchronizace (bez Dexie a Supabase) — pokrytá testy.
// Konflikty řeší last-write-wins podle updatedAt; mazání jsou tombstony,
// takže se přenášejí jako obyčejné záznamy s deletedAt.

export interface Syncable {
  id: string
  updatedAt: string
  deletedAt?: string
}

export interface PulledRow {
  id: string
  data: Syncable
  updated_at: string
}

// Mapování lokálních Dexie tabulek na tabulky v Postgresu.
export const REMOTE_TABLES = {
  clients: 'clients',
  projects: 'projects',
  tasks: 'tasks',
  templates: 'templates',
  dayPlans: 'day_plans',
} as const

export type LocalTableName = keyof typeof REMOTE_TABLES

export const LOCAL_TABLE_NAMES = Object.keys(REMOTE_TABLES) as LocalTableName[]

// Které stažené záznamy zapsat lokálně: nové, nebo novější než lokální verze.
export function applyPull(
  locals: Array<Syncable | undefined>,
  rows: PulledRow[],
): Syncable[] {
  const puts: Syncable[] = []
  rows.forEach((row, i) => {
    const local = locals[i]
    if (!local || local.updatedAt < row.data.updatedAt) puts.push(row.data)
  })
  return puts
}

// Které lokální záznamy odeslat: vše s updatedAt za push kurzorem, seřazené
// vzestupně, aby kurzor šel posouvat průběžně.
export function pendingPush<T extends Syncable>(records: T[], cursor: string): T[] {
  return records
    .filter((r) => r.updatedAt > cursor)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}

export function maxUpdatedAt(records: Syncable[], fallback: string): string {
  return records.reduce((max, r) => (r.updatedAt > max ? r.updatedAt : max), fallback)
}
