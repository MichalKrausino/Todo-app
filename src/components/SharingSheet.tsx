// Sdílení s kolegy — jedno místo, kde je vidět, co je společné a s kým.
//
// Samotné nastavení bydlí u klienta (`ClientSharing`), protože jednotkou
// sdílení je klient. Jenže tam ho nikdo nenajde: je to poslední sekce
// v detailu jednoho konkrétního klienta. Hledá se to u účtu — tam, kde je
// přihlášení — tak sem vede řádka ze Synchronizace a klient se vybírá.

import { useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { activeClients } from '../db/repo'
import { getSyncStatus, subscribeSyncStatus } from '../sync/status'
import { sharedClientIds } from '../sync/shares'
import { ClientSharing } from './ClientSharing'
import { Sheet } from './Sheet'

export function SharingSheet({ onClose }: { onClose: () => void }) {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus)
  const signedIn = status.phase !== 'signedOut' && status.phase !== 'unconfigured'
  const clients = useLiveQuery(activeClients, []) ?? []
  const sdilene = useLiveQuery(sharedClientIds, [], new Set<string>())
  // Napřed sdílený klient: kdo sem přijde podruhé, řeší nejspíš ten,
  // který už sdílený je.
  const [id, setId] = useState<string>()
  const vybrany = id ?? clients.find((c) => sdilene.has(c.id))?.id ?? clients[0]?.id

  return (
    <Sheet onClose={onClose} tone="paper" className="space-y-4">
      {() => (
        <>
          <header className="pt-1">
            <h2 className="display text-2xl font-bold">Sdílení s kolegy</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Sdílí se klient jako celek — jeho projekty i úkoly. Kdo je uvnitř,
              vidí je jako svoje: přidá úkol a máš ho, odškrtne ho a vidíš hotovo.
              Jednotlivý úkol jde z toho vyjmout přímo v jeho detailu.
            </p>
          </header>

          {!signedIn && (
            <p className="rounded-2xl bg-note px-3 py-2.5 text-sm text-note-ink">
              Sdílení potřebuje účet — sdílená data chodí přes server. Přihlas se
              v Synchronizaci a kolega ať se zaregistruje taky; pak ho tu přidáš
              e-mailem.
            </p>
          )}

          {signedIn && clients.length === 0 && (
            <p className="rounded-2xl bg-card px-4 py-3 text-sm text-ink-soft shadow-card">
              Zatím tu není žádný klient. Založ ho na obrazovce Klienti a pak ho
              půjde sdílet.
            </p>
          )}

          {signedIn && clients.length > 0 && vybrany && (
            <>
              <section className="space-y-2">
                <h3 className="section-label">který klient</h3>
                <select
                  aria-label="Klient ke sdílení"
                  value={vybrany}
                  onChange={(e) => setId(e.target.value)}
                  className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-[15px] outline-none focus:border-accent/60"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {sdilene.has(c.id) ? ' · sdíleno' : ''}
                    </option>
                  ))}
                </select>
              </section>

              <ClientSharing clientId={vybrany} />

              <p className="px-1 text-[12px] text-ink-faint">
                Úkoly bez klienta zůstávají soukromé, stejně jako šablony a ranní
                návrh dne. Nechceš ukázat konkrétní úkol? V jeho detailu je
                „Kdo úkol vidí". Komu sdílení vezmeš, tomu data klienta z jeho
                zařízení zmizí — u tebe zůstanou.
              </p>
            </>
          )}
        </>
      )}
    </Sheet>
  )
}
