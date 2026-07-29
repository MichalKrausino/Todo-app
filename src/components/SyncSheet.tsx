import { useSyncExternalStore } from 'react'
import { signInWithGoogle, signOutUser, syncNow } from '../sync/engine'
import { getSyncStatus, subscribeSyncStatus, type SyncPhase } from '../sync/status'

const PHASE_LABELS: Record<SyncPhase, string> = {
  unconfigured: 'Nenastaveno',
  signedOut: 'Nepřihlášeno',
  idle: 'Synchronizováno',
  syncing: 'Synchronizuji…',
  offline: 'Offline',
  error: 'Chyba synchronizace',
}

const timeFmt = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus)
}

export function SyncSheet({ onClose }: { onClose: () => void }) {
  const status = useSyncStatus()

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg space-y-4 rounded-t-2xl bg-white p-4"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-slate-200" />
        <header>
          <h2 className="text-lg font-bold">Synchronizace</h2>
          <p className="text-sm text-slate-500">{PHASE_LABELS[status.phase]}</p>
        </header>

        {status.phase === 'unconfigured' && (
          <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600">
            Appka běží čistě lokálně. Pro synchronizaci mezi iPhonem a MacBookem
            založ Supabase projekt podle návodu v README (sekce „Synchronizace“)
            a doplň klíče do <code className="rounded bg-slate-200 px-1">.env.local</code>.
          </p>
        )}

        {status.phase === 'signedOut' && (
          <>
            <p className="text-sm text-slate-600">
              Přihlášením přes Google se data začnou zálohovat a synchronizovat
              mezi tvými zařízeními. Appka dál funguje offline — sync běží na pozadí.
            </p>
            <button
              onClick={() => void signInWithGoogle()}
              className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white"
            >
              Přihlásit se přes Google
            </button>
          </>
        )}

        {status.phase !== 'unconfigured' && status.phase !== 'signedOut' && (
          <>
            <dl className="space-y-1 text-sm">
              {status.email && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Účet</dt>
                  <dd className="font-medium">{status.email}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-500">Poslední sync</dt>
                <dd className="font-medium">
                  {status.lastSyncAt ? timeFmt.format(new Date(status.lastSyncAt)) : '—'}
                </dd>
              </div>
            </dl>

            {status.phase === 'error' && status.error && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{status.error}</p>
            )}
            {status.phase === 'offline' && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Bez připojení. Změny se odešlou, jakmile bude síť.
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => void syncNow()}
                disabled={status.phase === 'syncing'}
                className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Synchronizovat teď
              </button>
              <button
                onClick={() => void signOutUser()}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600"
              >
                Odhlásit se
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const PHASE_COLORS: Record<SyncPhase, string> = {
  unconfigured: 'text-slate-300',
  signedOut: 'text-slate-400',
  idle: 'text-emerald-600',
  syncing: 'text-indigo-500',
  offline: 'text-amber-500',
  error: 'text-red-500',
}

export function SyncButton({ onOpen }: { onOpen: () => void }) {
  const status = useSyncStatus()
  return (
    <button
      aria-label="Synchronizace"
      onClick={onOpen}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/80 shadow-sm backdrop-blur ${PHASE_COLORS[status.phase]} ${
        status.phase === 'syncing' ? 'animate-pulse' : ''
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.3 18.5a4.3 4.3 0 01-.4-8.58 6.5 6.5 0 0112.66-1.33A4.25 4.25 0 0117.75 18.5H6.3z" />
      </svg>
    </button>
  )
}
