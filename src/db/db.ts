import Dexie, { type Table } from 'dexie'
import type { Client, DayPlan, Project, Task, Template } from './types'

export class TodoDB extends Dexie {
  clients!: Table<Client, string>
  projects!: Table<Project, string>
  tasks!: Table<Task, string>
  templates!: Table<Template, string>
  dayPlans!: Table<DayPlan, string>

  constructor() {
    super('todo')
    this.version(1).stores({
      clients: 'id, status, kind, updatedAt',
      projects: 'id, clientId, status, updatedAt',
      tasks: 'id, clientId, projectId, status, dueDate, scheduledFor, completedAt, updatedAt',
      templates: 'id, updatedAt',
      dayPlans: 'id, date, updatedAt',
    })
  }
}

export const db = new TodoDB()
