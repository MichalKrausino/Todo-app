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
  // Sdílené projekty v Todoistu, které tomuhle klientovi patří (Fáze 8).
  // Párování žije na klientovi, takže se syncuje na obě zařízení.
  todoistProjectIds?: string[]
  // Od kdy se nové úkoly tohohle klienta zakládají i v Todoistu. Je to
  // časové razítko, ne vypínač: po zapnutí se nesmí vyvalit do klientova
  // projektu všechno, co jsem si u něj kdy poznamenal.
  todoistPushSince?: string
  lastActivityAt?: string // dopočítáváno z úkolů
  templateIds: string[] // nasazené šablony (Fáze 4)
}

export interface Project extends BaseRecord {
  clientId: string
  name: string
  goal?: string
  status: ProjectStatus
  dueDate?: string // YYYY-MM-DD (lokální den)
  todoistSectionId?: string // projekt vznikl ze sekce v Todoistu (Fáze 8)
  order: number
}

// Podúkol — drobný krok uvnitř úkolu (checklist). Žije vnořený v Tasku,
// synchronizuje se s ním jako celek (LWW přes updatedAt úkolu).
export interface Subtask {
  id: string
  title: string
  done: boolean
}

// Komentář u todoistího úkolu — otisk, ne synchronizovaný záznam.
// Žije uvnitř úkolu, takže ho druhé zařízení dostane spolu s ním
// a při výpadku sítě je pořád vidět, co klient napsal.
export interface TodoistComment {
  id: string
  text: string
  at?: string // ISO datetime
  author?: string
  attachment?: string // název přílohy (soubor sám zůstává v Todoistu)
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
  // „Top 3 dne" — YYYY-MM-DD, na který den je úkol připíchnutý. Váže se
  // ke dni (ne bool), takže špendlík zítra sám vyprchá a neuklízí se ručně.
  pinnedFor?: string
  subtasks?: Subtask[] // checklist — po respawnu opakování se nuluje na nehotové
  isClientCheck?: boolean // pravidelná připomínka „zkontrolovat klienta" (marker přežívá respawn)
  // Úkol přišel z Todoistu (Fáze 8). Název, termín a priorita patří Todoistu —
  // lokální úpravy těchhle polí by další stažení přepsalo, proto jsou v UI zamčená.
  todoistId?: string
  todoistProjectId?: string
  todoistUpdatedAt?: string // updated_at z Todoistu — podle něj se pozná, že se nic nezměnilo
  todoistDoneAt?: string // completed_at, které už jsme z Todoistu převzali (rozliší „hotovo tam" od „otevřel jsem to znovu tady")
  todoistRecurring?: boolean // opakuje se v Todoistu — odškrtnutím se posune na další termín, nezmizí
  todoistHasDeadline?: boolean // termín přišel z todoistího `deadline` (ne z `due`) — úprava se musí vrátit do stejného pole
  todoistDirty?: boolean // lokální úprava čeká na odeslání; do té doby ji stažení nesmí přepsat
  // Úkol vznikl tady a do Todoistu byl teprve odeslaný. Todoist na něm
  // nikoho neeviduje (API ho zakládá bez přiřazení), takže bez téhle
  // značky by ho filtr „beru jen to, co je přiřazené mně" považoval za
  // cizí a první stažení by ho smazalo.
  todoistFromApp?: boolean
  todoistLabels?: string[] // štítky z Todoistu — jen na ukázání, appka s nimi nepracuje
  todoistComments?: TodoistComment[] // stažené komentáře (dotahují se při otevření úkolu)
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
