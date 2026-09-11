// Projít propadlé úkoly jeden po druhém (návrh z redesignu UX).
//
// Sekce „po termínu" umí narůst do stovek — při měření jich na roční
// hromádce bylo 134. Jako seznam je to slepá ulička: jediná cesta ven je
// otevřít každý zvlášť, takže se celá sekce začne přeskakovat. A zeď
// propadlých je ta nejhorší věc, kterou appka umí ukázat ráno.
//
// Tady je z toho rozhodování po jednom: velký název, kolik toho propadlo,
// a tři odpovědi. Sto úkolů se projde za dvě minuty.
//
// Fronta se snímá při otevření schválně: odpovědi mění živý dotaz pod tím,
// a bez snímku by se pořadí pod rukama přerovnávalo.

import { useState } from 'react'
import type { Client, Task } from '../db/types'
import { updateTask } from '../db/repo'
import { addDays, formatDayLabel, formatDaysAgo, fromISODate, toISODate, todayISO } from '../lib/dates'
import { useNaloz, volnejsiDen } from '../lib/volnyDen'
import { plural } from '../lib/labels'
import { Sheet } from './Sheet'

type Odpoved = 'dnes' | 'tyden' | 'neplati' | 'preskoceno'

interface Krok {
  task: Task
  odpoved: Odpoved
  // Co bylo před zásahem — na tom stojí „Zpět".
  pred: Pick<Task, 'scheduledFor' | 'dueDate' | 'status'>
}

// Termín se posouvá stejně jako jinde v appce (gesto na řádku, večerní
// uzávěrka): hýbe se `scheduledFor`, a když ho úkol nemá, `dueDate`.
// Pevný termín se nepřepisuje na tichu — je to fakt, ne přání.
const posun = (t: Task, den: string): Partial<Task> =>
  t.scheduledFor ? { scheduledFor: den } : { dueDate: den }

const propadloDne = (t: Task): string =>
  [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d)).sort()[0] ?? todayISO()

export function TriageSheet({
  ukoly,
  clients,
  onClose,
}: {
  ukoly: Task[]
  clients: Map<string, Client>
  onClose: () => void
}) {
  // Od nejstaršího: co leží nejdéle, potřebuje rozhodnout nejvíc.
  const [fronta] = useState(() =>
    [...ukoly].sort((a, b) => propadloDne(a).localeCompare(propadloDne(b))),
  )
  const [hotovo, setHotovo] = useState<Krok[]>([])

  const na = hotovo.length
  const task = fronta[na]
  const dnes = todayISO()
  // Odložit = přesunout tam, kde je na to místo: nejbližší pracovní den
  // s nejmenší zátěží v příštím týdnu. Počítá se živě, takže když sem
  // v jedné triáži pošleš pět úkolů, nesesypou se na jeden den.
  const naloz = useNaloz()
  const volny = volnejsiDen(naloz, toISODate(addDays(fromISODate(dnes), 1)), 7)

  const odpovez = (odpoved: Odpoved) => {
    if (!task) return
    const pred = {
      scheduledFor: task.scheduledFor,
      dueDate: task.dueDate,
      status: task.status,
    }
    if (odpoved === 'dnes') void updateTask(task.id, posun(task, dnes))
    if (odpoved === 'tyden') void updateTask(task.id, posun(task, volny))
    // `dropped` místo smazání: úkol zmizí ze všech otevřených seznamů,
    // ale zůstane v datech — zahozená práce je taky informace.
    if (odpoved === 'neplati') void updateTask(task.id, { status: 'dropped' })
    setHotovo((h) => [...h, { task, odpoved, pred }])
  }

  const zpet = () => {
    const posledni = hotovo[hotovo.length - 1]
    if (!posledni) return
    if (posledni.odpoved !== 'preskoceno') void updateTask(posledni.task.id, posledni.pred)
    setHotovo((h) => h.slice(0, -1))
  }

  const spocitej = (o: Odpoved) => hotovo.filter((k) => k.odpoved === o).length

  return (
    <Sheet onClose={onClose} tone="paper" className="space-y-4">
      {(close) => (
        <>
          <header className="flex items-baseline justify-between gap-3 pt-1">
            <h2 className="display text-2xl font-bold">Po termínu</h2>
            <span className="shrink-0 text-sm text-ink-soft">
              {Math.min(na + 1, fronta.length)} / {fronta.length}
            </span>
          </header>

          {task ? (
            <>
              {/* Ukazatel postupu: bez něj člověk neví, jestli je to na dvě
                  minuty nebo na půl hodiny, a radši to zavře. */}
              <div className="h-1 overflow-hidden rounded-full bg-well">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${(na / fronta.length) * 100}%` }}
                />
              </div>

              <div className="rounded-2xl bg-card p-4 shadow-card">
                <div className="flex items-center gap-2">
                  {task.clientId && clients.get(task.clientId) && (
                    <>
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: clients.get(task.clientId)!.color }}
                      />
                      <span className="truncate text-[13px] text-ink-soft">
                        {clients.get(task.clientId)!.name}
                      </span>
                    </>
                  )}
                </div>
                <p className="display mt-1 text-xl font-semibold leading-snug">{task.title}</p>
                <p className="mt-1.5 text-[13px] text-ink-faint">
                  {`Propadlo ${formatDaysAgo(propadloDne(task))}`}
                  {task.dueDate && task.dueDate < dnes && ` · pevný termín byl ${formatDayLabel(task.dueDate)}`}
                </p>
              </div>

              <div className="space-y-2">
                <button
                  onClick={() => odpovez('dnes')}
                  className="w-full rounded-xl bg-accent py-3 text-[15px] font-medium text-card transition-transform duration-150 active:scale-[0.98]"
                >
                  Dnes
                </button>
                <button
                  onClick={() => odpovez('tyden')}
                  className="w-full rounded-xl bg-card py-3 text-[15px] font-medium text-ink shadow-card transition-transform duration-150 active:scale-[0.98]"
                >
                  {`Volnější den (${formatDayLabel(volny)})`}
                </button>
                <button
                  onClick={() => odpovez('neplati')}
                  className="w-full rounded-xl py-3 text-[15px] font-medium text-danger transition-transform duration-150 active:scale-[0.98]"
                >
                  Už neplatí
                </button>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setHotovo((h) => [...h, { task, odpoved: 'preskoceno', pred: {} as Krok['pred'] }])}
                  className="px-2 py-2 text-sm font-medium text-ink-soft transition-transform duration-150 active:scale-95"
                >
                  Nechat být
                </button>
                <button
                  onClick={zpet}
                  disabled={hotovo.length === 0}
                  className="px-2 py-2 text-sm font-medium text-accent-deep transition-transform duration-150 active:scale-95 disabled:opacity-30"
                >
                  Zpět
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-2xl bg-card px-5 py-8 text-center shadow-card">
                <p className="display text-lg font-medium">Projito</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {`${hotovo.length} ${plural(hotovo.length, 'úkol', 'úkoly', 'úkolů')} vyřízeno`}
                </p>
                <p className="mt-3 text-[13px] text-ink-faint">
                  {`dnes ${spocitej('dnes')} · volnější den ${spocitej('tyden')} · už neplatí ${spocitej('neplati')}`}
                  {spocitej('preskoceno') > 0 && ` · beze změny ${spocitej('preskoceno')}`}
                </p>
              </div>
              <button
                onClick={close}
                className="w-full rounded-xl bg-accent py-3 text-[15px] font-medium text-card transition-transform duration-150 active:scale-[0.98]"
              >
                Hotovo
              </button>
            </>
          )}
        </>
      )}
    </Sheet>
  )
}
