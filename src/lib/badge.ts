// Odznak na ikoně appky (iOS 16.4+ pro PWA na ploše): počet úkolů na dnes
// a po termínu. Kde API není, tiše se nic nestane. Server posílá tentýž
// počet v pushi (sw.ts), tohle drží odznak čerstvý i bez notifikace.

import { liveQuery } from 'dexie'
import { openTasks } from '../db/repo'
import { todayISO } from './dates'
import type { Task } from '../db/types'

export function updateAppBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  if (count > 0) void nav.setAppBadge?.(count).catch(() => {})
  else void nav.clearAppBadge?.().catch(() => {})
}

// Čistá logika (testovatelná): úkoly s nejbližším dnem dnes nebo dřív.
export function badgeCount(
  tasks: Array<Pick<Task, 'dueDate' | 'scheduledFor'>>,
  today: string,
): number {
  return tasks.filter((t) => {
    const d = [t.scheduledFor, t.dueDate].filter((x): x is string => Boolean(x)).sort()[0]
    return d !== undefined && d <= today
  }).length
}

// Živé napojení: odznak se přepočítá po každém zápisu do DB (liveQuery)
// a při návratu do popředí (přes noc se mohl posunout den).
export function initAppBadge(): void {
  if (!('setAppBadge' in navigator)) return
  let latest: Task[] = []
  const apply = () => updateAppBadge(badgeCount(latest, todayISO()))
  liveQuery(openTasks).subscribe({
    next: (tasks) => {
      latest = tasks
      apply()
    },
    error: () => {},
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') apply()
  })
}
