// Sdílení klienta s dalším uživatelem (Fáze 9).
//
// Sdílí se klient jako celek — jeho projekty i úkoly. Kdo je uvnitř, vidí
// je ve svojí appce jako svoje: může přidávat úkoly i odškrtávat, a změna
// se vrátí zpátky běžnou synchronizací.
//
// Sekce se ukáže jen přihlášenému: bez účtu není s kým sdílet a nabízet to
// by znamenalo slibovat něco, co nefunguje.

import { useEffect, useState } from 'react'
import { listClientShares, shareClient, unshareClient, type ClientShare } from '../sync/shares'
import { useSyncStatus } from './SyncSheet'

export function ClientSharing({ clientId }: { clientId: string }) {
  const status = useSyncStatus()
  const signedIn = status.phase !== 'signedOut' && status.phase !== 'unconfigured'
  const [shares, setShares] = useState<ClientShare[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!signedIn) return
    let live = true
    void listClientShares(clientId).then((rows) => {
      if (live) setShares(rows)
    })
    return () => {
      live = false
    }
  }, [clientId, signedIn])

  if (!signedIn) return null

  const refresh = async () => setShares(await listClientShares(clientId))

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = email.trim()
    if (!value || busy) return
    setBusy(true)
    setError(undefined)
    const err = await shareClient(clientId, value)
    if (err) setError(err)
    else {
      setEmail('')
      await refresh()
    }
    setBusy(false)
  }

  const remove = async (target: string) => {
    setBusy(true)
    setError(undefined)
    const err = await unshareClient(clientId, target)
    if (err) setError(err)
    else await refresh()
    setBusy(false)
  }

  // Majitel je ve výpisu taky (aby člen viděl, čí klient to je), ale odebrat
  // se nedá — sdílení stojí na něm.
  const members = shares.filter((s) => !s.isOwner)
  const owner = shares.find((s) => s.isOwner)
  const meIsOwner = owner?.email === status.email

  return (
    <section>
      <h2 className="mb-2 section-label">sdílení</h2>
      <section className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
        {shares.length === 0 && (
          <p className="px-4 py-2.5 text-sm text-ink-faint">
            Klient je jen tvůj. Přidej e-mail a uvidíte na jeho úkoly oba.
          </p>
        )}

        {owner && !meIsOwner && (
          <div className="px-4 py-2.5 text-sm">
            <span className="text-ink-faint">Sdílí ti </span>
            <span className="font-medium">{owner.email}</span>
          </div>
        )}

        {members.map((m) => (
          <div key={m.email} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0 text-sm">
              <div className="truncate font-medium">{m.email}</div>
              <div className="text-xs text-ink-faint">
                {m.email === status.email ? 'To jsi ty' : 'Vidí a upravuje úkoly klienta'}
              </div>
            </div>
            <button
              onClick={() => void remove(m.email)}
              disabled={busy}
              className="shrink-0 text-sm font-medium text-danger disabled:opacity-40"
            >
              {m.email === status.email ? 'Odejít' : 'Odebrat'}
            </button>
          </div>
        ))}

        {(meIsOwner || shares.length === 0) && (
          <form onSubmit={(e) => void add(e)} className="flex items-center gap-2 px-4 py-2.5">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e-mail kolegy"
              autoCapitalize="off"
              autoCorrect="off"
              className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-[15px] outline-none focus:border-accent/60"
            />
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="shrink-0 text-sm font-medium text-accent disabled:opacity-40"
            >
              Sdílet
            </button>
          </form>
        )}
      </section>

      {error && <p className="mt-1.5 px-1 text-xs text-danger">{error}</p>}
    </section>
  )
}
