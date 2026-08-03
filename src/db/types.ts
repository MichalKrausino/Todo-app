// Datový model podle docs/PLAN.md.
// Každý záznam nese createdAt/updatedAt/deletedAt kvůli budoucí synchronizaci
// (tombstony + last-write-wins podle updatedAt). Nikdy nemazat natvrdo.

export type ClientKind = 'client' | 'internal' | 'personal'
export type ClientStatus = 'active' | 'paused' | 'archived'
export type ProjectStatus = 'active' | 'done' | 'archived'
export type TaskStatus = 'inbox' | 'active' | 'done' | 'dropped'
export type Priority = 'low' | 'normal' | 'high' | 'critical'

export interface BaseRecord {
  id: string
  createdAt: string // ISO datetime
  updatedAt: string // ISO datetime
  deletedAt?: string // tombstone
}

// Klient zároveň slouží jako oblast („Interní“, „Osobní“).
export interface Client extends BaseRecord {
  name: string
  color: string
  kind: ClientKind
  status: ClientStatus
  notes?: string
  checkIntervalDays?: number // po kolika dnech bez aktivity varovat (Fáze 4)
  lastActivityAt?: string // dopočítáváno z úkolů
  templateIds: string[] // nasazené šablony (Fáze 4)
}

export interface Project extends BaseRecord {
  clientId: string
  name: string
  goal?: string
  status: ProjectStatus
  dueDate?: string // YYYY-MM-DD (lokální den)
  order: number
}

export interface Task extends BaseRecord {
  clientId?: string
  projectId?: string
  title: string
  notes?: string
  priority: Priority
  dueDate?: string // dokdy to musí být (YYYY-MM-DD)
  dueTime?: string // HH:MM — čas deadlineu v rámci dne (volitelné upřesnění dueDate)
  scheduledFor?: string // na kdy jsem si to naplánoval (YYYY-MM-DD)
  calendarEventId?: string // blok v Google kalendáři (Fáze 3)
  status: TaskStatus
  estimateMinutes?: number // tichý odhad od AI — nikdy nezobrazovat jako pole (Fáze 5)
  actualMinutes?: number
  recurrenceRule?: string // iCal RRULE (Fáze 4)
  sourceTemplateItemId?: string
  completedAt?: string
  postponeCount?: number // kolikrát byl termín posunut na později (signál odkládání)
  isClientCheck?: boolean // pravidelná připomínka „zkontrolovat klienta" (marker přežívá respawn)
  order: number
}

export interface TemplateItem {
  id: string // stabilní napříč úpravami — instance se na něj odkazují přes sourceTemplateItemId
  title: string
  recurrenceRule: string
  priority: Priority
  defaultProjectName?: string
}

// Balíček pravidelných úkolů, např. „Správa PPC“ (Fáze 4).
export interface Template extends BaseRecord {
  name: string
  items: TemplateItem[]
}

// Lokální cache událostí z Google kalendáře (Fáze 3). Není to synchronizovaný
// záznam — jen otisk serverových dat, aby schůzky byly vidět i offline.
export interface CalendarEvent {
  id: string // `${calendarId}:${eventId}`
  calendarId: string
  eventId: string
  title: string
  start: string // ISO datetime, u celodenních YYYY-MM-DD
  end: string
  startDay: string // YYYY-MM-DD (Europe/Prague)
  endDay: string
  allDay: boolean
  isTodoBlock: boolean // událost z našeho kalendáře „Todo"
  fetchedAt: string
}

export interface DayPlanSuggestion {
  taskId: string
  reason: string
  decision: 'accepted' | 'rejected' | 'ignored'
}

// Co appka ráno navrhla a jak jsem reagoval (Fáze 6).
export interface DayPlan extends BaseRecord {
  date: string // YYYY-MM-DD
  suggestions: DayPlanSuggestion[]
}
