// Zpřesnění zadání (Fáze 5) — panel za chipem „Zpřesnit" na Dnes.
//
// U každého úkolu je vidět, co člověk napsal, a pod tím jen to, co by se
// změnilo. Každá změna má vlastní zaškrtávátko (výchozí zaškrtnuté):
// model se může u jedné věci trefit a u druhé ne, a „všechno, nebo nic"
// by z dobrého návrhu dělalo špatný. „Nechat být" návrh zahodí a úkol
// zůstane, jak je.
//
// Nic tu nejde samo — proto se ani nic nevrací toastem: co se použije,
// je vidět hned a jde to přepsat v detailu jako jakoukoli jinou úpravu.

import { useEffect, useMemo, useState } from 'react'
import { db } from '../db/db'
import type { Client, Project, Task } from '../db/types'
import { updateTask } from '../db/repo'
import { formatDayLabel } from '../lib/dates'
import { PRIORITY_LABELS, plural } from '../lib/labels'
import type { NabidkaUkolu } from '../lib/useZpresneni'
import { useKolegove } from '../lib/useTym'
import { pouzij, type Pole, type Zmena } from '../lib/zpresneni'
import { Sheet } from './Sheet'
import { Button } from './ui/Button'

const NAZVY: Record<Pole, string> = {
  nazev: 'Název',
  klient: 'Klient',
  projekt: 'Projekt',
  termin: 'Termín',
  cas: 'Čas',
  priorita: 'Priorita',
  komu: 'Předat',
  kroky: 'Kroky',
}

function Karta({
  task,
  zmeny,
  clients,
  projects,
  jmena,
}: NabidkaUkolu & {
  clients: Map<string, Client>
  projects: Map<string, Project>
  jmena: Map<string, string>
}) {
  // Předat jde jen člověku, který u TOHO klienta opravdu je — seznam lidí
  // jde ze serveru, a dokud nedojde (nebo když selže), předání se nenabízí.
  const klient = (zmeny.find((z) => z.pole === 'klient')?.hodnota as string | undefined) ?? task.clientId
  const { lide } = useKolegove(klient)
  const platne = useMemo(
    () =>
      zmeny.filter(
        (z) => z.pole !== 'komu' || lide.some((l) => l.userId === z.hodnota && !l.pending),
      ),
    [zmeny, lide],
  )
  const [vypnute, setVypnute] = useState<Set<Pole>>(new Set())
  const vybrane = platne.filter((z) => !vypnute.has(z.pole))

  const hodnota = (z: Zmena): React.ReactNode => {
    const v = z.hodnota
    if (z.pole === 'klient') return clients.get(v as string)?.name ?? '—'
    if (z.pole === 'projekt') return projects.get(v as string)?.name ?? '—'
    if (z.pole === 'termin') return formatDayLabel(v as string)
    if (z.pole === 'priorita') return PRIORITY_LABELS[v as Task['priority']]
    if (z.pole === 'komu') return jmena.get(v as string) ?? 'kolega'
    if (z.pole === 'kroky') return (v as string[]).join(' · ')
    return v as string
  }

  const hotovo = async (zmenyKPouziti: Zmena[]) => {
    await updateTask(task.id, pouzij(task, zmenyKPouziti))
    await db.navrhy.delete(task.id)
  }

  if (!platne.length) return null
  return (
    <li className="space-y-2 px-4 py-3" data-zpresneni={task.id}>
      <p className="text-[13px] leading-snug text-ink-soft">„{task.zadani?.text}“</p>
      <ul className="space-y-1">
        {platne.map((z) => {
          const zap = !vypnute.has(z.pole)
          return (
            <li key={z.pole}>
              <label className="flex cursor-pointer items-start gap-3 py-1">
                <input
                  type="checkbox"
                  checked={zap}
                  aria-label={`Použít: ${NAZVY[z.pole]}`}
                  onChange={() =>
                    setVypnute((s) => {
                      const n = new Set(s)
                      if (zap) n.add(z.pole)
                      else n.delete(z.pole)
                      return n
                    })
                  }
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span className="min-w-0 text-[15px] leading-snug">
                  <span className="text-ink-soft">{NAZVY[z.pole]}: </span>
                  <span className={zap ? 'text-ink' : 'text-ink-soft line-through'}>{hodnota(z)}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" disabled={!vybrane.length} onClick={() => void hotovo(vybrane)}>
          Použít
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void hotovo([])}>
          Nechat být
        </Button>
      </div>
    </li>
  )
}

export function ZpresneniSheet({
  nabidky,
  clients,
  projects,
  jmena,
  onClose,
}: {
  nabidky: NabidkaUkolu[]
  clients: Map<string, Client>
  projects: Map<string, Project>
  jmena: Map<string, string>
  onClose: () => void
}) {
  // Když se poslední návrh vyřídí, panel nemá co ukazovat.
  useEffect(() => {
    if (!nabidky.length) onClose()
  }, [nabidky.length, onClose])

  return (
    <Sheet onClose={onClose} className="space-y-3">
      {() => (
        <>
          <header className="pt-1">
            <h2 className="display text-2xl font-bold">Zpřesnit zadání</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              U {nabidky.length} {plural(nabidky.length, 'úkolu', 'úkolů', 'úkolů')} model dočetl,
              co parser nepobral. Bez tebe se nezmění nic.
            </p>
          </header>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
            {nabidky.map((n) => (
              <Karta key={n.task.id} {...n} clients={clients} projects={projects} jmena={jmena} />
            ))}
          </ul>
        </>
      )}
    </Sheet>
  )
}
