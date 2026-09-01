import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { exportBackup, importBackup } from '../db/backup'
import {
  FETCH_WINDOW_DAYS,
  getCalendarStatus,
  subscribeCalendarStatus,
  testCalendar,
} from '../sync/calendar'
import {
  disablePush,
  enablePush,
  getGoogleTokenError,
  getPushEnabled,
  isPushSupported,
  signInWithGoogle,
  signInWithPassword,
  signOutUser,
  signUpWithPassword,
  syncNow,
} from '../sync/engine'
import { getSyncStatus, subscribeSyncStatus, type SyncPhase } from '../sync/status'
import {
  getThemeChoice,
  setThemeChoice,
  subscribeTheme,
  type ThemeChoice,
} from '../lib/theme'
import { getTodoistStatus, subscribeTodoistStatus } from '../sync/todoist'
import { HelpSheet } from './HelpSheet'
import { Sheet } from './Sheet'
import { TodoistSheet } from './TodoistSheet'

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
  const [helpOpen, setHelpOpen] = useState(false)
  const [todoistOpen, setTodoistOpen] = useState(false)
  const status = useSyncStatus()
  const todoist = useSyncExternalStore(subscribeTodoistStatus, getTodoistStatus)

  return (
    <Sheet onClose={onClose} className="space-y-4">
      {() => (
        <>
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

        {status.phase === 'signedOut' && (
          <>
            <p className="rounded-2xl bg-note px-3 py-2 text-xs text-note-ink">
              Bez přihlášení žijí data jen v tomhle zařízení. Přihlas se, ať se
              zálohují na server — nebo si aspoň stáhni zálohu níže.
            </p>
            <SignInForm />
          </>
        )}

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
            <CalendarSection />

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
                className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-medium text-card transition-transform duration-150 active:scale-[0.98] disabled:opacity-50"
              >
                Synchronizovat teď
              </button>
              <button
                onClick={() => void signOutUser()}
                className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-transform duration-150 active:scale-[0.98]"
              >
                Odhlásit se
              </button>
            </div>
          </>
        )}

        <ThemeSection />

        <BackupSection />

        {/* Todoist (Fáze 8) — sdílené projekty klientů do appky. */}
        <button
          onClick={() => setTodoistOpen(true)}
          className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-left transition-transform duration-150 active:scale-[0.99]"
        >
          <span>
            <span className="block text-[15px] font-medium">Todoist</span>
            <span className="text-[13px] text-ink-soft">
              {todoist.linked
                ? typeof todoist.taskCount === 'number'
                  ? `Propojeno · ${todoist.taskCount} úkolů`
                  : 'Propojeno'
                : 'Sdílené projekty klientů do appky'}
            </span>
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        {todoistOpen && <TodoistSheet onClose={() => setTodoistOpen(false)} />}

        {/* Nápověda patří sem — je to jediné „nastavení" v appce. */}
        <button
          onClick={() => setHelpOpen(true)}
          className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-left transition-transform duration-150 active:scale-[0.99]"
        >
          <span>
            <span className="block text-[15px] font-medium">Jak to funguje</span>
            <span className="text-[13px] text-ink-soft">Psaní úkolů, gesta a co appka dělá sama</span>
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        {helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}

        {/* Verze buildu: když něco „pořád blbne", tohle jako první řekne,
            jestli telefon vůbec kouká na novou appku. */}
        <p className="pb-1 text-center text-[11px] text-ink-faint">verze {__BUILD__}</p>
        </>
      )}
    </Sheet>
  )
}

const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: 'system', label: 'Podle systému' },
  { id: 'light', label: 'Světlý' },
  { id: 'dark', label: 'Tmavý' },
]

// Vzhled. Volba je lokální — na MacBooku můžu chtít světlý režim
// a na telefonu tmavý, tak se nesynchronizuje.
function ThemeSection() {
  const choice = useSyncExternalStore(subscribeTheme, getThemeChoice)
  return (
    <section className="space-y-2">
      <h3 className="section-label">vzhled</h3>
      <div className="flex gap-1 rounded-2xl bg-well p-1">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setThemeChoice(t.id)}
            aria-pressed={choice === t.id}
            className={`flex-1 rounded-xl px-2 py-2 text-[13px] font-medium transition-colors duration-200 ${
              choice === t.id ? 'bg-card text-ink shadow-card' : 'text-ink-soft'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </section>
  )
}

// Záloha nezávislá na syncu: export všech dat do JSON souboru a obnova
// z něj. Ukazuje i stav trvalého úložiště (persist brání systému data
// vyčistit). Aktualizace appky se dat nedotýkají — tohle je pojistka
// hlavně pro smazání appky z plochy nebo výměnu telefonu bez syncu.
function BackupSection() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (navigator.storage?.persisted) {
      void navigator.storage.persisted().then(setPersisted)
    }
  }, [])

  const download = async () => {
    const backup = await exportBackup()
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `todo-zaloha-${backup.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const restore = async (file: File) => {
    setMessage(null)
    try {
      const count = await importBackup(JSON.parse(await file.text()))
      setMessage(`Obnoveno ${count} záznamů. Při příštím syncu se srovnají se serverem.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Zálohu se nepodařilo přečíst.')
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="section-label">data</h3>
      <div className="divide-y divide-line overflow-hidden rounded-2xl bg-well">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
          <span className="font-medium">Trvalé úložiště</span>
          <span className="text-xs text-ink-soft">
            {persisted === null ? '—' : persisted ? 'zapnuto' : 'nevynuceno (data drží systém)'}
          </span>
        </div>
        <button
          onClick={() => void download()}
          className="block w-full px-3 py-2.5 text-left text-sm font-medium text-accent transition-colors duration-150 active:bg-line/40"
        >
          Stáhnout zálohu (JSON)
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="block w-full px-3 py-2.5 text-left text-sm font-medium text-accent transition-colors duration-150 active:bg-line/40"
        >
          Obnovit ze zálohy…
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void restore(f)
          e.target.value = ''
        }}
      />
      {message && <p className="rounded-2xl bg-note px-3 py-2 text-xs text-note-ink">{message}</p>}
      <p className="px-1 text-[11px] leading-relaxed text-ink-faint">
        Aktualizace appky se dat nedotýkají — data žijí v úložišti zařízení
        a se zapnutým syncem i na serveru. Záloha se hodí před smazáním
        appky z plochy nebo při výměně telefonu bez přihlášení.
      </p>
    </section>
  )
}

// Rada k chybě kalendáře — doslovná hláška serveru přeložená na krok,
// který ji řeší.
function calendarHint(err: string): string | null {
  if (/není propojený|přihlas se/i.test(err)) {
    return 'Odhlas se níže a přihlas znovu tlačítkem „Přes Google" — Google se musí zeptat na přístup ke kalendáři.'
  }
  if (/invalid_grant|expired|revoked/i.test(err)) {
    return 'Google přístup vypršel nebo byl odvolán. Přihlas se znovu přes Google. Pokud je tvá OAuth aplikace v Google Cloud Console v režimu „Testing", dej „Publish app" — testovací tokeny vyprší po 7 dnech.'
  }
  if (/google_oauth/i.test(err)) {
    return 'Na serveru chybí Google OAuth údaje — v serverovém nastavení (nový chat s přiloženým textem) doběhl krok 2 špatně.'
  }
  if (/404|not.?found/i.test(err)) {
    return 'Serverová funkce calendar není nasazená — v serverovém nastavení doběhl krok 3 špatně.'
  }
  return null
}

// Stav propojení Google kalendáře + ruční test. Chyby se dřív polykaly
// do konzole — tady je vidět doslovná hláška i co s ní.
function CalendarSection() {
  const cal = useSyncExternalStore(subscribeCalendarStatus, getCalendarStatus)
  const [busy, setBusy] = useState(false)
  const tokenErr = getGoogleTokenError()

  const test = async () => {
    setBusy(true)
    await testCalendar()
    setBusy(false)
  }

  const timeLbl = cal.lastSuccessAt
    ? new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' }).format(
        new Date(cal.lastSuccessAt),
      )
    : null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-well px-3 py-2.5">
        <div className="min-w-0 text-sm">
          <div className="font-medium">Google kalendář</div>
          <div className="text-xs text-ink-soft">
            {busy
              ? 'Zkouším propojení…'
              : cal.lastError
                ? 'Propojení selhalo'
                : cal.lastSuccessAt
                  ? `Propojeno · ${cal.eventCount ?? 0} událostí (${Math.round(FETCH_WINDOW_DAYS / 30)} měs.) · ${timeLbl}`
                  : 'Zatím nenačteno'}
          </div>
        </div>
        <button
          onClick={() => void test()}
          disabled={busy}
          className="shrink-0 rounded-full bg-accent-wash px-3 py-1.5 text-sm font-medium text-accent-deep transition-transform duration-150 active:scale-95 disabled:opacity-50"
        >
          Otestovat
        </button>
      </div>
      {cal.lastError && !busy && (
        <div className="space-y-1 rounded-2xl bg-danger-wash px-3 py-2 text-xs text-danger">
          <div className="font-medium">{cal.lastError}</div>
          {calendarHint(cal.lastError) && (
            <div className="text-danger/80">{calendarHint(cal.lastError)}</div>
          )}
        </div>
      )}
      {/* Odpojený Google potřebuje jedinou věc: znovu se přihlásit.
          Rada „odhlas se a přihlas" je návod; tohle je to tlačítko. */}
      {cal.needsReauth && !busy && (
        <button
          onClick={() => void signInWithGoogle()}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-card transition-transform duration-150 active:scale-[0.98]"
        >
          Propojit Google znovu
        </button>
      )}
      {tokenErr && (
        <p className="rounded-2xl bg-danger-wash px-3 py-2 text-xs text-danger">
          Uložení Google klíče selhalo: {tokenErr} — serverová migrace (krok 1) nejspíš neproběhla.
        </p>
      )}
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
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-card shadow-card transition-[left] duration-300 ease-spring ${
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
        className="w-full rounded-xl bg-accent py-2.5 text-sm font-medium text-card disabled:opacity-40"
      >
        {busy ? 'Pracuji…' : 'Přihlásit se'}
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void signUp()}
          className="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-soft"
        >
          Vytvořit nový účet
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void signInWithGoogle()}
          className="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-soft"
        >
          Přes Google
        </button>
      </div>
      <p className="text-center text-[11px] text-ink-faint">
        Přihlášení přes Google zároveň propojí tvůj Google kalendář.
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
