import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  disablePush,
  enablePush,
  getPushEnabled,
  isPushSupported,
  signInWithGoogle,
  signInWithPassword,
  signOutUser,
  signUpWithPassword,
  syncNow,
} from '../sync/engine'
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
    <div className="fixed inset-0 z-50 flex items-end justify-center sheet-backdrop bg-ink/35 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="w-full max-w-lg space-y-4 sheet-panel rounded-t-[28px] bg-card shadow-sheet p-4"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-line" />
        <header>
          <h2 className="text-lg font-bold">Synchronizace</h2>
          <p className="text-sm text-ink-soft">{PHASE_LABELS[status.phase]}</p>
        </header>

        {status.phase === 'unconfigured' && (
          <p className="rounded-2xl bg-paper px-3 py-3 text-sm text-ink-soft">
            Appka běží čistě lokálně. Pro synchronizaci mezi iPhonem a MacBookem
            založ Supabase projekt podle návodu v README (sekce „Synchronizace“)
            a doplň klíče do <code className="rounded bg-line px-1">.env.local</code>.
          </p>
        )}

        {status.phase === 'signedOut' && <SignInForm />}

        {status.phase !== 'unconfigured' && status.phase !== 'signedOut' && (
          <>
            <dl className="space-y-1 text-sm">
              {status.email && (
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Účet</dt>
                  <dd className="font-medium">{status.email}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-soft">Poslední sync</dt>
                <dd className="font-medium">
                  {status.lastSyncAt ? timeFmt.format(new Date(status.lastSyncAt)) : '—'}
                </dd>
              </div>
            </dl>

            <PushToggle />

            {status.phase === 'error' && status.error && (
              <p className="rounded-2xl bg-danger-wash px-3 py-2 text-xs text-danger">{status.error}</p>
            )}
            {status.phase === 'offline' && (
              <p className="rounded-2xl bg-note px-3 py-2 text-xs text-note-ink">
                Bez připojení. Změny se odešlou, jakmile bude síť.
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => void syncNow()}
                disabled={status.phase === 'syncing'}
                className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-medium text-card disabled:opacity-50"
              >
                Synchronizovat teď
              </button>
              <button
                onClick={() => void signOutUser()}
                className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink-soft"
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

// Ranní návrh dne chodí pushem v 7:00 — přepínač odběru pro tohle zařízení.
function PushToggle() {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getPushEnabled().then(setEnabled)
  }, [])

  if (!isPushSupported()) {
    return (
      <p className="rounded-2xl bg-well px-3 py-2 text-xs text-ink-soft">
        Ranní notifikace: na iPhonu přidej appku na plochu (Sdílet → Přidat na
        plochu) a otevři ji z ikony — pak tu půjdou zapnout.
      </p>
    )
  }

  const toggle = async () => {
    setBusy(true)
    setError(null)
    if (enabled) {
      await disablePush()
      setEnabled(false)
    } else {
      const err = await enablePush()
      if (err) setError(err)
      else setEnabled(true)
    }
    setBusy(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-well px-3 py-2.5">
        <div className="text-sm">
          <div className="font-medium">Ranní návrh dne</div>
          <div className="text-xs text-ink-soft">Notifikace každý den v 7:00</div>
        </div>
        <button
          onClick={() => void toggle()}
          disabled={busy}
          role="switch"
          aria-checked={enabled}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${
            enabled ? 'bg-moss' : 'bg-ink-faint/40'
          } disabled:opacity-50`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-card shadow-card transition-[left] duration-200 ${
              enabled ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>
      {error && <p className="rounded-2xl bg-danger-wash px-3 py-2 text-xs text-danger">{error}</p>}
    </div>
  )
}

function SignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true)
    setError(null)
    setInfo(null)
    const err = await signInWithPassword(email.trim(), password)
    if (err) setError(err)
    setBusy(false)
  }

  const signUp = async () => {
    if (!email.trim() || !password) {
      setError('Vyplň e-mail a zvol si heslo (aspoň 6 znaků).')
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    const result = await signUpWithPassword(email.trim(), password)
    if (result.error) {
      setError(result.error)
    } else if (result.needsConfirm) {
      setInfo(
        'Účet vytvořen! Mrkni do e-mailu a klikni na potvrzovací odkaz. ' +
          'Stránka po kliknutí může hlásit chybu — to nevadí, účet je potvrzený. ' +
          'Pak se sem vrať a přihlas se.',
      )
    }
    setBusy(false)
  }

  return (
    <form onSubmit={signIn} className="space-y-3">
      <p className="text-sm text-ink-soft">
        Přihlášením se data začnou zálohovat a synchronizovat mezi tvými
        zařízeními. Appka dál funguje offline — sync běží na pozadí.
      </p>
      <input
        type="email"
        autoComplete="email"
        placeholder="E-mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-lg border border-line px-3 py-2 text-[15px] outline-none focus:border-accent/60"
      />
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Heslo"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg border border-line px-3 py-2 text-[15px] outline-none focus:border-accent/60"
      />
      {error && <p className="rounded-2xl bg-danger-wash px-3 py-2 text-xs text-danger">{error}</p>}
      {info && <p className="rounded-2xl bg-note px-3 py-2 text-xs text-note-ink">{info}</p>}
      <button
        type="submit"
        disabled={busy || !email.trim() || !password}
        className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-card disabled:opacity-40"
      >
        {busy ? 'Pracuji…' : 'Přihlásit se'}
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void signUp()}
          className="flex-1 rounded-lg border border-line py-2.5 text-sm font-medium text-ink-soft"
        >
          Vytvořit nový účet
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void signInWithGoogle()}
          className="flex-1 rounded-lg border border-line py-2.5 text-sm font-medium text-ink-soft"
        >
          Přes Google
        </button>
      </div>
      <p className="text-center text-[11px] text-ink-faint">
        Google přihlášení vyžaduje jednorázové nastavení (přijde s Fází 3 — kalendář).
      </p>
    </form>
  )
}

const PHASE_COLORS: Record<SyncPhase, string> = {
  unconfigured: 'text-ink-faint/70',
  signedOut: 'text-ink-faint',
  idle: 'text-moss',
  syncing: 'text-accent',
  offline: 'text-note-ink',
  error: 'text-danger',
}

export function SyncButton({ onOpen }: { onOpen: () => void }) {
  const status = useSyncStatus()
  return (
    <button
      aria-label="Synchronizace"
      onClick={onOpen}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-card/80 shadow-card backdrop-blur ${PHASE_COLORS[status.phase]} ${
        status.phase === 'syncing' ? 'animate-pulse' : ''
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.3 18.5a4.3 4.3 0 01-.4-8.58 6.5 6.5 0 0112.66-1.33A4.25 4.25 0 0117.75 18.5H6.3z" />
      </svg>
    </button>
  )
}
