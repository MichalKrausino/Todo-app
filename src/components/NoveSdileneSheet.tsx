// Co mi někdo nasdílel a já to ještě neviděl — panel za chipem
// „Nové pro tebe" na Dnes.
//
// Na Dnes se nasdílený úkol v seznamu objeví, jen když je PŘIDĚLENÝ mně
// (Dnes odpovídá na „co mám dělat já"). Nasdílený a nepřidělený by šel
// najít jedině ve Vše — tedy vůbec ne, když člověk neví, že tam má hledat.
// Tenhle panel je most mezi tím.
//
// Otevřením se všechno v něm označí jako viděné (stejně jako ranní návrh:
// viděno = otevřený panel, ne chip — chip ukáže počet, ne jména). Fronta
// se snímá při otevření, jinak by úkoly pod prstem mizely, jakmile se
// označí.

import { useEffect, useState } from 'react'
import type { Client, Task } from '../db/types'
import { oznacVidene } from '../db/repo'
import { plural } from '../lib/labels'
import { Sheet } from './Sheet'

export function NoveSdileneSheet({
  ukoly,
  clients,
  jmena,
  onOpenTask,
  onClose,
}: {
  ukoly: Task[]
  clients: Map<string, Client>
  /** id → krátké jméno (`useLide`) */
  jmena: Map<string, string>
  onOpenTask: (t: Task) => void
  onClose: () => void
}) {
  const [seznam] = useState(ukoly)
  useEffect(() => {
    void oznacVidene(seznam.map((t) => t.id))
  }, [seznam])

  return (
    <Sheet onClose={onClose} className="space-y-3">
      {(close) => (
        <>
          <header className="pt-1">
            <h2 className="display text-2xl font-bold">Nové pro tebe</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              {seznam.length} {plural(seznam.length, 'úkol ti někdo nasdílel', 'úkoly ti někdo nasdílel', 'úkolů ti někdo nasdílel')}
            </p>
          </header>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
            {seznam.map((t) => {
              const klient = t.clientId ? clients.get(t.clientId) : undefined
              const od = t.ownerId ? jmena.get(t.ownerId) : undefined
              return (
                <li key={t.id}>
                  <button
                    onClick={() => {
                      close()
                      onOpenTask(t)
                    }}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-well"
                  >
                    {klient && (
                      <span
                        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: klient.color }}
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block text-[15px] leading-snug">{t.title}</span>
                      {/* Jméno ZA oddělovačem, ne ve větě: „od Bena" chce
                          druhý pád a ten se u libovolných jmen neuhodne. */}
                      <span className="mt-0.5 block text-[13px] text-ink-soft">
                        {[klient?.name, od && `sdílí ${od}`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Sheet>
  )
}
