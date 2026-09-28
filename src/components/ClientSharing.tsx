// Sdílení klienta s dalším uživatelem (Fáze 9).
//
// Sdílí se klient, ale PROJEKTY SE VYBÍRAJÍ. U jednoho klienta se dělá
// i práce, do které kolegovi nic není, a vyjmout ji šlo dosud jen po
// jednotlivých úkolech (`hiddenFrom`) — u celého projektu to znamená
// odškrtat ho úkol po úkolu a na každý další nezapomenout, tedy práce
// navíc, která se jednou zapomene a tím přestane platit.
//
// Výchozí stav je „nesdíleno": nově založený projekt kolega nevidí, dokud
// se nezaškrtne. Vybírat smí jen majitel klienta (hlídá to server, ne
// tohle rozhraní). Úkoly, které nepatří pod žádný projekt, jdou s klientem
// samotným — není na nich co vybírat.
//
// Kdo je uvnitř, vidí zaškrtnuté jako svoje: může přidávat úkoly
// i odškrtávat, a změna se vrátí zpátky běžnou synchronizací.
//
// Sekce se ukáže i odhlášenému — jen místo formuláře řekne, že to chce
// přihlášení. Schovaná byla horší: kdo účet nemá, nedozvěděl se, že appka
// sdílení vůbec umí, a hledal ho marně.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { clientProjects } from '../db/repo'
import {
  listClientShares,
  setSharedProjects,
  shareClient,
  unshareClient,
  type ClientShare,
} from '../sync/shares'
import { getSyncStatus, subscribeSyncStatus } from '../sync/status'
import { plural } from '../lib/labels'
import { Switch } from './ui/Switch'

export function ClientSharing({ clientId }: { clientId: string }) {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus)
  const signedIn = status.phase !== 'signedOut' &&
    status.phase !== 'unconfigured' &&
    status.phase !== 'starting'
  const [shares, setShares] = useState<ClientShare[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [info, setInfo] = useState<string>()
  const [busy, setBusy] = useState(false)
  // U koho jsou zrovna rozbalené projekty. Sbalené schválně: řádka člověka
  // má zůstat jednou řádkou, seznam projektů je až odpověď na „a co vidí".
  const [rozbaleno, setRozbaleno] = useState<string>()
  const projekty = useLiveQuery(() => clientProjects(clientId), [clientId]) ?? []

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

  const refresh = async () => setShares(await listClientShares(clientId))

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = email.trim()
    if (!value || busy) return
    setBusy(true)
    setError(undefined)
    setInfo(undefined)
    const vysledek = await shareClient(clientId, value)
    if (!vysledek.ok) setError(vysledek.chyba)
    else {
      // Pozvánka se musí říct nahlas: navenek se nic nestalo a bez téhle
      // věty by to vypadalo, že sdílení nefunguje.
      if (vysledek.pozvanka) {
        setInfo(`${value} tu zatím účet nemá — sdílení se uplatní, jakmile se poprvé přihlásí.`)
      }
      setEmail('')
      await refresh()
    }
    setBusy(false)
  }

  const prepniProjekt = async (m: ClientShare, projectId: string, zapnout: boolean) => {
    if (busy) return
    const puvodni = m.projectIds ?? []
    const dalsi = zapnout ? [...puvodni, projectId] : puvodni.filter((p) => p !== projectId)
    setBusy(true)
    setError(undefined)
    const err = await setSharedProjects(clientId, m.email, dalsi)
    if (err) setError(err)
    // Přečíst znovu ze serveru, ať v rozhraní nestojí výběr, který se
    // neuložil — přepínač, který si pamatuje víc než server, lže.
    await refresh()
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
        {!signedIn && (
          <p className="px-4 py-2.5 text-sm text-ink-soft">
            Klienta jde sdílet s kolegou — uvidíte na tytéž úkoly a odškrtnutí
            se ukáže oběma. Chce to přihlášení (obláček vpravo nahoře).
          </p>
        )}

        {signedIn && shares.length === 0 && (
          <p className="px-4 py-2.5 text-sm text-ink-faint">
            Klient je jen tvůj. Přidej e-mail a pak u něj vybereš, které
            projekty uvidí — úkoly bez projektu vidí vždycky. Účet mít
            nemusí: pozvánka počká na jeho první přihlášení.
          </p>
        )}

        {signedIn && owner && !meIsOwner && (
          <div className="px-4 py-2.5 text-sm">
            <span className="text-ink-faint">Sdílí ti </span>
            <span className="font-medium">{owner.email}</span>
          </div>
        )}

        {signedIn && members.map((m) => {
          // Vybírat smí majitel a jen u člověka, který už účet má: pozvánka
          // ještě nemá řádek ve sdílení, takže není kam výběr uložit.
          // `projectIds === undefined` znamená starý server (viz `shares.ts`)
          // — pak se přepínače radši nenabídnou, než aby nešly uložit.
          const lzeVybirat =
            meIsOwner && !m.pending && m.projectIds !== undefined && projekty.length > 0
          const vybrane = m.projectIds ?? []
          const otevreno = rozbaleno === m.email
          return (
            <div key={m.email} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <div className="truncate font-medium">{m.email}</div>
                  <div className="text-xs text-ink-faint">
                    {m.pending
                      ? 'Pozvánka čeká na první přihlášení'
                      : m.email === status.email
                        ? 'To jsi ty'
                        : projekty.length === 0
                          ? 'Vidí a upravuje úkoly klienta'
                          : `Vidí ${vybrane.length} z ${projekty.length} ${plural(projekty.length, 'projektu', 'projektů', 'projektů')}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {lzeVybirat && (
                    <button
                      onClick={() => setRozbaleno(otevreno ? undefined : m.email)}
                      className="text-sm font-medium text-accent-deep"
                    >
                      {otevreno ? 'Hotovo' : 'Projekty'}
                    </button>
                  )}
                  <button
                    onClick={() => void remove(m.email)}
                    disabled={busy}
                    className="text-sm font-medium text-danger disabled:opacity-40"
                  >
                    {m.pending ? 'Zrušit' : m.email === status.email ? 'Odejít' : 'Odebrat'}
                  </button>
                </div>
              </div>

              {lzeVybirat && otevreno && (
                <div className="mt-2 space-y-1 border-t border-line pt-2">
                  <p className="text-xs text-ink-faint">
                    Úkoly bez projektu vidí vždycky. Nový projekt je nesdílený,
                    dokud ho tu nezapneš.
                  </p>
                  {projekty.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-1">
                      <span className="min-w-0 truncate text-sm">{p.name}</span>
                      <Switch
                        checked={vybrane.includes(p.id)}
                        aria-label={`Sdílet projekt ${p.name}`}
                        onCheckedChange={(v) => void prepniProjekt(m, p.id, v)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {signedIn && (meIsOwner || shares.length === 0) && (
          <form onSubmit={(e) => void add(e)} className="flex items-center gap-2 px-4 py-2.5">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e-mail kolegy"
              autoCapitalize="off"
              autoCorrect="off"
              className="min-w-0 flex-1 rounded-full bg-well px-3 py-2 text-[16px] text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent/60"
            />
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="shrink-0 text-sm font-medium text-accent-deep disabled:opacity-40"
            >
              Sdílet
            </button>
          </form>
        )}
      </section>

      {error && <p className="mt-1.5 px-1 text-xs text-danger">{error}</p>}
      {info && <p className="mt-1.5 px-1 text-xs text-ink-soft">{info}</p>}
    </section>
  )
}
