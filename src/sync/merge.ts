// Čistá logika stahování (bez Dexie a Supabase) — pokrytá testy.
// Konflikty řeší last-write-wins podle updatedAt; mazání jsou tombstony,
// takže se přenášejí jako obyčejné záznamy s deletedAt.
//
// Odesílání sem nepatří: rozhoduje se podle evidence odeslaných verzí,
// ne podle času, a bydlí v src/sync/outbox.ts.

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
