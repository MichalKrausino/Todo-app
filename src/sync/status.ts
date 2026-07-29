// Malý store stavu synchronizace pro UI (useSyncExternalStore).
// Komponenty přes něj jen čtou — síť řeší výhradně engine.

export type SyncPhase = 'unconfigured' | 'signedOut' | 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncStatus {
  phase: SyncPhase
  email?: string
  lastSyncAt?: string
  error?: string
}

let status: SyncStatus = { phase: 'unconfigured' }
const subscribers = new Set<() => void>()

export const getSyncStatus = (): SyncStatus => status

export function setSyncStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  for (const cb of subscribers) cb()
}

export function subscribeSyncStatus(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}
