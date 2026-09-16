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
  // Razítko „čí je řádek" — doplňuje ho `applyPull` ze sloupce `user_id`,
  // neposílá se zpátky. Viz BaseRecord.ownerId.
  ownerId?: string
}

export interface PulledRow {
  id: string
  data: Syncable
  updated_at: string
  // Majitel řádku ze serveru. Volitelný schválně: odpověď bez sloupce
  // (starší klient, test) nesmí razítko přepsat na prázdno.
  user_id?: string
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

// Které stažené záznamy zapsat lokálně: nové, novější než lokální verze,
// nebo takové, kterým lokálně chybí razítko „čí to je".
//
// To třetí je tu kvůli sdílení. Razítko se nebere z `data` (tam ho nikdo
// nepíše), ale ze sloupce `user_id`, který hlídá trigger `lww_guard` —
// tedy z jediného místa, kde je vlastnictví pravda. Řádky stažené dřív,
// než razítko existovalo, ho proto samy nedostanou a musí se doplnit.
//
// Doplnit se ale nesmí tak, že se přepíše NOVĚJŠÍ lokální úprava: server
// v takovém případě nenese nic nového, jen razítko. Proto se v té větvi
// zapisuje lokální záznam s razítkem, ne serverový.
export function applyPull(
  locals: Array<Syncable | undefined>,
  rows: PulledRow[],
): Syncable[] {
  const puts: Syncable[] = []
  rows.forEach((row, i) => {
    const local = locals[i]
    const majitel = row.user_id
    if (!local || local.updatedAt < row.data.updatedAt) {
      puts.push(majitel ? { ...row.data, ownerId: majitel } : row.data)
      return
    }
    if (majitel && local.ownerId !== majitel) puts.push({ ...local, ownerId: majitel })
  })
  return puts
}
