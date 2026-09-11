// Ranní návrh jeden po druhém — stejný vzor jako triáž propadlých.
//
// Dřív stál návrh na Dnes jako čtyřřádková karta s osmi kolečky a pod ní
// tytéž úkoly znovu v „po termínu" s jinými tlačítky. Obrazovka tím
// odpovídala na „co teď?" dvakrát a pokaždé jinak. Teď je návrh jedna
// řádka s počtem a rozhoduje se tady: velký název, důvod a odpovědi.
// Fronta se snímá při otevření — rozhodnutí mění živý dotaz pod tím.
//
// Odpovědi a co znamenají (logiku počítá pick.ts, sem se jen dováží):
//   Přijmout na dnešek — úkol dostane dnešek a blok v kalendáři „Todo".
//   Dnes ne — zítra znovu; podruhé během dvou týdnů = týden pokoj.
//   Až za týden — týden pokoj rovnou.
//   Už neplatí — jen u úkolu, který se vrací z odložení: dvakrát
//     odložené a potřetí nechtěné je nejspíš mrtvé, tak se to řekne.
// Odložení nikdy není zapomenutí: toast řekne, KDY se úkol vrátí, karta
// „Odpočívá" dole ukazuje všechno, co zrovna čeká, a „Vrátit" to probudí.

import { useState } from 'react'
import type { Client, Task } from '../db/types'
import { decideDayPlanSuggestion, probudUkol, updateTask } from '../db/repo'
import { deleteBlockForTask, scheduleBlockForTask } from '../sync/calendar'
import { formatKdy, todayISO } from '../lib/dates'
import { plural } from '../lib/labels'
import { kdySeVrati, type NavrhPamet } from '../lib/navrhPamet'
import { ukazToast } from '../lib/toast'
import { Sheet } from './Sheet'
import { Button } from './ui/Button'

export interface Navrh {
  task: Task
  reason: string
}

export interface Odpocivajici {
  task: Task
  /** den, kdy se úkol vrátí do návrhu */
  do: string
}

type Odpoved = 'prijato' | 'odlozeno' | 'tyden' | 'zahozeno' | 'vraceno'

interface Krok {
  navrh: Navrh
  odpoved: Odpoved
  pred: Pick<Task, 'scheduledFor' | 'status'>
}

export function NavrhSheet({
  planId,
  navrhy,
  clients,
  pamet,
  odpocivajici,
  onClose,
}: {
  planId: string
  navrhy: Navrh[]
  clients: Map<string, Client>
  pamet: NavrhPamet
  odpocivajici: Odpocivajici[]
  onClose: () => void
}) {
  const [fronta] = useState(() => [...navrhy])
  const [hotovo, setHotovo] = useState<Krok[]>([])
  const [probuzene, setProbuzene] = useState<Set<string>>(new Set())
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

  // Vrácení jednoho kroku — z tlačítka Zpět (poslední) i z toastu
  // (třeba už ne poslední: pak se jen přepíše na „vráceno", aby fronta
  // neposkočila zpátky na úkol, který už je rozhodnutý).
  const vrat = (krok: Krok) => {
    void decideDayPlanSuggestion(planId, krok.navrh.task.id, 'ignored')
    if (krok.odpoved === 'prijato') {
      void updateTask(krok.navrh.task.id, krok.pred)
      void deleteBlockForTask(krok.navrh.task)
    } else if (krok.odpoved === 'zahozeno') {
      void updateTask(krok.navrh.task.id, { status: krok.pred.status })
    }
    setHotovo((h) => {
      const i = h.indexOf(krok)
      if (i < 0) return h
      if (i === h.length - 1) return h.slice(0, -1)
      return h.map((k, j) => (j === i ? { ...k, odpoved: 'vraceno' } : k))
    })
  }

  const odpovez = (odpoved: Exclude<Odpoved, 'vraceno'>) => {
    if (!aktualni) return
    const id = aktualni.task.id
    let pred: Krok['pred'] = { scheduledFor: aktualni.task.scheduledFor, status: aktualni.task.status }
    const krok: Krok = { navrh: aktualni, odpoved, pred }
    if (odpoved === 'prijato') {
      pred = prijmi(aktualni)
      krok.pred = pred
    } else if (odpoved === 'odlozeno') {
      // „Dnes ne" úkol nikam neposouvá — zítra se nabídne znovu. Jen
      // podruhé během dvou týdnů z toho vzejde týden pokoj, a to se řekne.
      void decideDayPlanSuggestion(planId, id, 'rejected')
      const navrat = kdySeVrati(id, pamet.histZitra, 'rejected', dnes)
      if (navrat) {
        ukazToast(`Podruhé „dnes ne" — týden pokoj, vrátí se ${formatKdy(navrat)}`, [{ popisek: 'Zpět', kdyz: () => vrat(krok) }])
      }
    } else if (odpoved === 'tyden') {
      void decideDayPlanSuggestion(planId, id, 'snoozed')
      const navrat = kdySeVrati(id, pamet.histZitra, 'snoozed', dnes)
      ukazToast(`Odloženo, vrátí se ${navrat ? formatKdy(navrat) : 'za týden'}`, [{ popisek: 'Zpět', kdyz: () => vrat(krok) }])
    } else {
      // „Už neplatí" — zahozená práce zůstává v datech (status dropped,
      // ne tombstone), stejně jako v triáži.
      void decideDayPlanSuggestion(planId, id, 'rejected')
      void updateTask(id, { status: 'dropped' })
      ukazToast(`Už neplatí — „${aktualni.task.title}"`, [{ popisek: 'Zpět', kdyz: () => vrat(krok) }])
    }
    setHotovo((h) => [...h, krok])
  }

  const prijmiVse = () => {
    const zbyle = fronta.slice(na)
    const kroky = zbyle.map((navrh): Krok => ({ navrh, odpoved: 'prijato', pred: prijmi(navrh) }))
    setHotovo((h) => [...h, ...kroky])
  }

  const zpet = () => {
    const posledni = hotovo[hotovo.length - 1]
    if (posledni) vrat(posledni)
  }

  const probud = (o: Odpocivajici) => {
    void probudUkol(o.task.id)
    setProbuzene((s) => new Set(s).add(o.task.id))
    ukazToast(`Od zítřka zase v návrhu — „${o.task.title}"`)
  }

  const pocet = (o: Odpoved) => hotovo.filter((k) => k.odpoved === o).length
  const klient = aktualni?.task.clientId ? clients.get(aktualni.task.clientId) : undefined
  const vraciSe = aktualni ? pamet.vraci.has(aktualni.task.id) : false
  const tydenOd = hotovo.find((k) => k.odpoved === 'tyden')
  const navratTydne = tydenOd ? kdySeVrati(tydenOd.navrh.task.id, pamet.histZitra, 'snoozed', dnes) : undefined
  const cekajici = odpocivajici.filter((o) => !probuzene.has(o.task.id))

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
                <p className={`mt-1.5 text-[13px] ${vraciSe ? 'text-accent-deep' : 'text-ink-faint'}`}>{aktualni.reason}</p>
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
                <div className="flex items-center justify-center gap-1">
                  <Button variant="ghost" size="sm" className="h-11 px-3 text-ink-soft" onClick={() => odpovez('tyden')}>
                    Až za týden
                  </Button>
                  {vraciSe && (
                    <Button variant="ghost" size="sm" className="h-11 px-3 text-ink-soft" onClick={() => odpovez('zahozeno')}>
                      Už neplatí
                    </Button>
                  )}
                </div>
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
                  {[
                    `přijato ${pocet('prijato')}`,
                    `dnes ne ${pocet('odlozeno')}`,
                    pocet('tyden') > 0 ? `za týden ${pocet('tyden')}` : '',
                    pocet('zahozeno') > 0 ? `už neplatí ${pocet('zahozeno')}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {(pocet('odlozeno') > 0 || pocet('tyden') > 0) && (
                  <p className="mt-3 text-[13px] text-ink-faint">
                    {[
                      pocet('odlozeno') > 0 ? '„Dnes ne" se zítra nabídne znovu.' : '',
                      pocet('tyden') > 0 && navratTydne ? `Odložené se vrátí ${formatKdy(navratTydne)}.` : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </p>
                )}
              </div>
              <Button size="lg" className="w-full rounded-xl" onClick={close}>
                Hotovo
              </Button>
            </>
          )}

          {/* Co zrovna odpočívá — vidět má být vždycky, s dnem návratu.
              „Vrátit" probudí úkol od zítřka; nic se nemaže. */}
          {cekajici.length > 0 && (
            <section>
              <h3 className="section-label px-1 pb-1.5">odpočívá · {cekajici.length}</h3>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
                {cekajici.map((o) => (
                  <li key={o.task.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px]">{o.task.title}</p>
                      <p className="text-[13px] text-ink-faint">vrátí se {formatKdy(o.do)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => probud(o)}
                      className="shrink-0 rounded-full bg-well px-3 py-1.5 text-[13px] font-medium text-accent-deep transition-transform duration-150 active:scale-95"
                    >
                      Vrátit
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Sheet>
  )
}
