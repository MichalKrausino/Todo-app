import Dexie, { type Table } from 'dexie'
import type { CalendarEvent, Client, DayPlan, Project, Task, Template } from './types'

// Lokální stav synchronizace (kurzory pull/push, přihlášený účet).
// Nesynchronizuje se — je to čistě lokální účetnictví.
export interface SyncStateRow {
  id: string // 'pull:<tabulka>' | 'shares' | 'sweep' | 'meta'
  cursor?: string
  userId?: string
}

// Co už je na serveru a v jaké verzi: id je `<tabulka>:<id záznamu>`,
// `updatedAt` je razítko odeslané verze. Odesílá se všechno, co se od své
// evidované verze liší — čas se do rozhodování neplete (viz src/sync/outbox.ts).
// Taky čistě lokální účetnictví, nesynchronizuje se.
export interface PushStateRow {
  id: string
  updatedAt: string
}

export class TodoDB extends Dexie {
  clients!: Table<Client, string>
  projects!: Table<Project, string>
  tasks!: Table<Task, string>
  templates!: Table<Template, string>
  dayPlans!: Table<DayPlan, string>
  syncState!: Table<SyncStateRow, string>
  pushState!: Table<PushStateRow, string>
  calendarEvents!: Table<CalendarEvent, string>

  constructor() {
    super('todo')
    this.version(1).stores({
      clients: 'id, status, kind, updatedAt',
      projects: 'id, clientId, status, updatedAt',
      tasks: 'id, clientId, projectId, status, dueDate, scheduledFor, completedAt, updatedAt',
      templates: 'id, updatedAt',
      dayPlans: 'id, date, updatedAt',
    })
    this.version(2).stores({
      syncState: 'id',
    })
    this.version(3).stores({
      calendarEvents: 'id, startDay',
    })
    // Fáze 8: import z Todoistu hledá úkoly podle jejich todoistId.
    this.version(4).stores({
      tasks: 'id, clientId, projectId, status, dueDate, scheduledFor, completedAt, updatedAt, todoistId',
    })
    // Fáze 9: evidence odeslaného místo časového kurzoru. Prázdná tabulka
    // znamená „nic není odeslané", takže po upgradu proběhne jeden plný
    // push — samé upserty, které server podle updatedAt zahodí jako starší.
    // Zadarmo se tím doženou i změny, které starý kurzor mohl minout.
    this.version(5).stores({
      pushState: 'id',
    })
  }
}

export const db = new TodoDB()
