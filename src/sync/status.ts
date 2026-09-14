// Malý store stavu synchronizace pro UI (useSyncExternalStore).
// Komponenty přes něj jen čtou — síť řeší výhradně engine.

// 'starting' je krátké okno mezi startem appky a doječením klienta
// Supabase (dováží se dynamicky, viz engine.ts). Bez vlastní fáze by
// v něm UI hlásilo 'unconfigured', tedy „sync nemáš nastavený" — a to
// je u nastaveného syncu lež, i když jen na okamžik.
export type SyncPhase =
  | 'unconfigured'
  | 'starting'
  | 'signedOut'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'error'

export interface SyncStatus {
  phase: SyncPhase
  email?: string
  lastSyncAt?: string
  error?: string
  // Kolik záznamů server odmítl přijmout (typicky úkol přesunutý pod
  // klienta, ke kterému už nemám právo). Zbytek se odeslal — tohle je
  // proto varování, ne chyba synchronizace. Bez něj by odmítnutá změna
  // vypadala jako uložená.
  refused?: number
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
