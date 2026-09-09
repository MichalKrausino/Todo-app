// Ranní návrh jeden po druhém — stejný vzor jako triáž propadlých.
//
// Dřív stál návrh na Dnes jako čtyřřádková karta s osmi kolečky a pod ní
// tytéž úkoly znovu v „po termínu" s jinými tlačítky. Obrazovka tím
// odpovídala na „co teď?" dvakrát a pokaždé jinak. Teď je návrh jedna
// řádka s počtem a rozhoduje se tady: velký název, důvod, dvě odpovědi.
// Fronta se snímá při otevření — rozhodnutí mění živý dotaz pod tím.

import { useState } from 'react'
import type { Client, Task } from '../db/types'
import { decideDayPlanSuggestion, updateTask } from '../db/repo'
import { deleteBlockForTask, scheduleBlockForTask } from '../sync/calendar'
import { todayISO } from '../lib/dates'
import { plural } from '../lib/labels'
import { Sheet } from './Sheet'
import { Button } from './ui/Button'

export interface Navrh {
  task: Task
  reason: string
}

interface Krok {
  navrh: Navrh
  odpoved: 'prijato' | 'odlozeno'
  pred: Pick<Task, 'scheduledFor' | 'status'>
}

export function NavrhSheet({
  planId,
  navrhy,
  clients,
  onClose,
}: {
  planId: string
  navrhy: Navrh[]
  clients: Map<string, Client>
  onClose: () => void
}) {
  const [fronta] = useState(() => [...navrhy])
  const [hotovo, setHotovo] = useState<Krok[]>([])
  const na = hotovo.length
  const aktualni = fronta[na]
  const dnes = todayISO()

  const prijmi = (navrh: Navrh) => {
    const pred = { scheduledFor: navrh.task.scheduledFor, status: navrh.task.status }
    void decideDayPlanSuggestion(planId, navrh.task.id, 'accepted')
    // přijatý návrh si zabere blok v kalendáři „Todo"
    void scheduleBlockForTask({ ...navrh.task, scheduledFor: dnes })
    return pred
  }

  const odpovez = (odpoved: Krok['odpoved']) => {
    if (!aktualni) return
    let pred: Krok['pred'] = { scheduledFor: aktualni.task.scheduledFor, status: aktualni.task.status }
    if (odpoved === 'prijato') pred = prijmi(aktualni)
    // Zamítnutý úkol se nikam neposouvá — zůstává, jak byl, takže ho
    // ranní návrh zítra nabídne znovu. To je ono „odložit na zítra".
    else void decideDayPlanSuggestion(planId, aktualni.task.id, 'rejected')
    setHotovo((h) => [...h, { navrh: aktualni, odpoved, pred }])
  }

  const prijmiVse = () => {
    const zbyle = fronta.slice(na)
    const kroky = zbyle.map((navrh): Krok => ({ navrh, odpoved: 'prijato', pred: prijmi(navrh) }))
    setHotovo((h) => [...h, ...kroky])
  }

  const zpet = () => {
    const posledni = hotovo[hotovo.length - 1]
    if (!posledni) return
    void decideDayPlanSuggestion(planId, posledni.navrh.task.id, 'ignored')
    if (posledni.odpoved === 'prijato') {
      void updateTask(posledni.navrh.task.id, posledni.pred)
      void deleteBlockForTask(posledni.navrh.task)
    }
    setHotovo((h) => h.slice(0, -1))
  }

  const pocet = (o: Krok['odpoved']) => hotovo.filter((k) => k.odpoved === o).length
  const klient = aktualni?.task.clientId ? clients.get(aktualni.task.clientId) : undefined

  return (
    <Sheet onClose={onClose} tone="paper" className="space-y-4">
      {(close) => (
        <>
          <header className="flex items-baseline justify-between gap-3 pt-1">
            <h2 className="display text-2xl font-bold">Ranní návrh</h2>
            <span className="shrink-0 text-sm text-ink-soft">
              {Math.min(na + 1, fronta.length)} / {fronta.length}
            </span>
          </header>

          {aktualni ? (
            <>
              <div className="h-1 overflow-hidden rounded-full bg-well">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${(na / fronta.length) * 100}%` }}
                />
              </div>

              <div className="rounded-2xl bg-card p-4 shadow-card">
                {klient && (
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: klient.color }} />
                    <span className="truncate text-[13px] text-ink-soft">{klient.name}</span>
                  </div>
                )}
                <p className="display mt-1 text-xl font-semibold leading-snug">{aktualni.task.title}</p>
                <p className="mt-1.5 text-[13px] text-ink-faint">{aktualni.reason}</p>
              </div>

              <div className="space-y-2">
                <Button size="lg" className="w-full rounded-xl" onClick={() => odpovez('prijato')}>
                  Přijmout na dnešek
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full rounded-xl bg-card text-ink shadow-card"
                  onClick={() => odpovez('odlozeno')}
                >
                  Dnes ne
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <Button variant="link" size="sm" className="px-2" onClick={prijmiVse}>
                  {`Přijmout ${plural(fronta.length - na, 'zbývající', 'zbývající', 'všech zbývajících')} ${fronta.length - na}`}
                </Button>
                <Button variant="ghost" size="sm" className="px-2 text-accent-deep" onClick={zpet} disabled={hotovo.length === 0}>
                  Zpět
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-2xl bg-card px-5 py-8 text-center shadow-card">
                <p className="display text-lg font-medium">Rozhodnuto</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {`přijato ${pocet('prijato')} · dnes ne ${pocet('odlozeno')}`}
                </p>
                {pocet('odlozeno') > 0 && (
                  <p className="mt-3 text-[13px] text-ink-faint">Odložené se zítra nabídnou znovu.</p>
                )}
              </div>
              <Button size="lg" className="w-full rounded-xl" onClick={close}>
                Hotovo
              </Button>
            </>
          )}
        </>
      )}
    </Sheet>
  )
}
