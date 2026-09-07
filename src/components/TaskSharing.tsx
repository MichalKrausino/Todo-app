// Kdo vidí tenhle konkrétní úkol (Fáze 9).
//
// Sdílený klient je dohoda o rozsahu, ne o každém řádku — i u společného
// klienta se dělá práce, do které kolegovi nic není (interní poznámka,
// fakturace, jednání o ceně). Tady se u jednotlivého úkolu vypne, že ho
// někdo vidí.
//
// Zaškrtnuté = vidí. Schválně kladně: „nesdílet" jako zaškrtávátko se čte
// naopak, než se chová, a u něčeho, co pouští data z ruky, je obrácená
// logika ta poslední věc, kterou chceš.
//
// Rozhoduje o tom RLS na serveru (`data->'hiddenFrom'` v supabase/shares.sql),
// ne tahle komponenta. Filtr jen v UI by úkol pořád posílal do cizího
// zařízení a stačilo by se podívat do jeho IndexedDB.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { updateTask } from '../db/repo'
import { listClientShares, sharedClientIds, type ClientShare } from '../sync/shares'
import { getSyncStatus, subscribeSyncStatus } from '../sync/status'

export function TaskSharing({
  taskId,
  clientId,
  hiddenFrom,
  onChange,
}: {
  taskId: string
  clientId: string | undefined
  hiddenFrom: string[]
  onChange: (next: string[]) => void
}) {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus)
  // Z otisku, ne ze sítě: v letadle se tím pozná, že klient sdílený je,
  // i když seznam kolegů zrovna nedojde.
  const sdilene = useLiveQuery(sharedClientIds, [], new Set<string>())
  const [lide, setLide] = useState<ClientShare[]>([])
  const [nacetlo, setNacetlo] = useState(false)

  const jeSdileny = !!clientId && sdilene.has(clientId)

  useEffect(() => {
    if (!jeSdileny || !clientId) return
    let live = true
    void listClientShares(clientId).then((rows) => {
      if (!live) return
      setLide(rows)
      setNacetlo(true)
    })
    return () => {
      live = false
    }
  }, [clientId, jeSdileny])

  if (!jeSdileny) return null

  // Sebe ve výpisu nepotřebuju — vlastní úkol vidím vždycky. A zakladatel
  // klienta se vyjmout nedá schválně: svoje vlastní úkoly vidí i tak (RLS
  // pouští majitele řádku vždycky), takže by odškrtnutí u jeho úkolu jen
  // lhalo. Je to jeho klient.
  const ostatni = lide.filter((l) => !l.isOwner && l.email !== status.email && !!l.userId)
  // Půlka upgradu: nová appka, staré SQL. Server pak vrací kolegy bez id
  // a vyjmutí by se sice zaškrtlo, ale nic by nedělalo — tichá lež o tom,
  // kdo co vidí. Radši se řekne nahlas, co zbývá spustit.
  const stareSql = lide.some((l) => !l.isOwner && !l.userId)

  const prepni = (userId: string, vidi: boolean) => {
    const next = vidi ? hiddenFrom.filter((id) => id !== userId) : [...hiddenFrom, userId]
    onChange(next)
    void updateTask(taskId, { hiddenFrom: next.length ? next : undefined })
  }

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-ink-soft">Kdo úkol vidí</span>
      {ostatni.length === 0 ? (
        <p className="rounded-lg bg-well px-3 py-2 text-[13px] text-ink-soft">
          {nacetlo
            ? 'Klienta zatím nesdílíš s nikým dalším.'
            : 'Kolegy se nepodařilo načíst — chce to připojení.'}
        </p>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {ostatni.map((l) => {
            const vidi = !hiddenFrom.includes(l.userId)
            return (
              <label
                key={l.userId}
                className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px]">{l.email}</span>
                  <span className="text-xs text-ink-soft">
                    {vidi ? 'Vidí tenhle úkol' : 'Tenhle úkol nevidí'}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={vidi}
                  aria-label={`Úkol vidí ${l.email}`}
                  onChange={(e) => prepni(l.userId, e.target.checked)}
                  className="h-5 w-5 shrink-0"
                />
              </label>
            )
          })}
        </div>
      )}
      {stareSql ? (
        <p className="mt-1.5 rounded-lg bg-note px-3 py-2 text-[12px] text-note-ink">
          Server tuhle výjimku zatím neumí — spusť v Supabase znovu
          <code className="px-1">supabase/shares.sql</code>.
        </p>
      ) : (
        <p className="mt-1 px-1 text-[12px] text-ink-faint">
          Odškrtnutý kolega úkol nedostane ani do svého zařízení — hlídá to server.
        </p>
      )}
    </div>
  )
}
