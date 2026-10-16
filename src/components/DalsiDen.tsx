import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Client, Task } from '../db/types'
import { calendarEventsOn } from '../db/repo'
import { formatEventRange, formatFullDate, formatFullDateNa, fromISODate } from '../lib/dates'
import { jePreplneno } from '../lib/kapacitaDne'
import { plural } from '../lib/labels'
import { dilyDne } from '../lib/pruhDne'
import { vetaSabatu } from '../lib/sabat'
import { titulekDne } from '../lib/tahDnu'
import { PruhDne } from './PruhDne'
import { SipkyDnu, type useTahDnu } from './TahDnu'
import { TextEffect } from './ui/TextEffect'

// Den za dneškem na obrazovce Dnes (tah přes hlavičku, viz `tahDnu.ts`).
//
// Je to TÝŽ jazyk jako dnešek, jen bez toho, co patří jen k dnešku:
// titulek, datum, pruh dne proti osobnímu stropu, schůzky a úkoly toho
// dne. Chipy (návrh, uzávěrka, nové pro tebe…), řádka triáže a hotové
// tu nejsou — nic z toho se netýká dne, na který se teprve díváš.
//
// Úkoly jsou MOJE (filtruje volající) a patří sem podle téhož „kdy to je"
// jako všude jinde: dřívější z termínu a naplánování.
export function DalsiDen({
  den,
  posun,
  tah,
  onZmen,
  ukoly,
  clientMap,
  strop,
  klid,
  radek,
}: {
  den: string
  posun: number
  tah: ReturnType<typeof useTahDnu>
  onZmen: (o: -1 | 1) => void
  ukoly: Task[]
  clientMap: Map<string, Client>
  strop: number | undefined
  klid: boolean
  radek: (t: Task) => React.ReactNode
}) {
  const events = useLiveQuery(() => calendarEventsOn(den), [den]) ?? []
  const schuzky = useMemo(
    () => [...events].sort((a, b) => Number(b.allDay) - Number(a.allDay) || String(a.start ?? '').localeCompare(String(b.start ?? ''))),
    [events],
  )
  const dily = useMemo(() => dilyDne(ukoly, (id) => clientMap.get(id)?.color), [ukoly, clientMap])
  const titulek = titulekDne(posun, den)
  const datum = fromISODate(den)
  const preplneno = jePreplneno(ukoly.length, strop)
  const sabat = vetaSabatu(den)

  return (
    <>
      <header className="rise" {...tah.obsluha} style={tah.styl}>
        <div style={tah.stylObalu}>
          <TextEffect as="h1" per="char" preset="blur" className="display text-[2.1rem] font-semibold leading-tight">
            {titulek}
          </TextEffect>
          <div className="mt-1.5 flex items-center gap-2 text-[13px] text-ink-soft">
            <span className="min-w-0 flex-1 truncate first-letter:uppercase">
              {/* Od pozítří nese jméno dne titulek — pod ním stačí datum. */}
              {posun === 1 ? formatFullDate(datum) : formatFullDate(datum).replace(/^\S+\s+/, '')}
              {ukoly.length > 0 && ` · ${ukoly.length} ${plural(ukoly.length, 'úkol', 'úkoly', 'úkolů')}`}
            </span>
            <SipkyDnu posun={posun} onZmen={onZmen} />
          </div>
          {sabat && <p className="text-[13px] text-ink-soft first-letter:uppercase">{sabat}</p>}
          {ukoly.length > 0 && (
            <div className="mt-2">
              <PruhDne dily={dily} klid={klid} strop={strop} className="h-1.5" />
              {preplneno && strop !== undefined && (
                <p className="mt-1.5 text-[13px] font-medium leading-snug text-note-ink">
                  na den je toho moc · obvykle zvládneš {strop} {plural(strop, 'úkol', 'úkoly', 'úkolů')}
                </p>
              )}
            </div>
          )}
        </div>
      </header>

      <section className="rise" style={{ '--stagger': 1 } as React.CSSProperties}>
        {ukoly.length > 0 && <h2 className="section-label mb-2">{titulek.toLocaleLowerCase('cs')} · {ukoly.length}</h2>}
        {schuzky.length > 0 || ukoly.length > 0 ? (
          <div className="seznam-na-papire">
            {schuzky.length > 0 && (
              <ul className="divide-y divide-line">
                {schuzky.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-24 shrink-0 text-[13px] tabular-nums text-ink-soft">{formatEventRange(e)}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{e.title}</span>
                  </li>
                ))}
              </ul>
            )}
            {ukoly.length > 0 && <ul className={`divide-y divide-line ${schuzky.length > 0 ? 'border-t border-line' : ''}`}>{ukoly.map(radek)}</ul>}
          </div>
        ) : (
          <p className="text-sm text-ink-faint">
            {posun === 1 ? 'Na zítřek zatím nic nemáš.' : `Na ${formatFullDateNa(datum)} zatím nic nemáš.`}
          </p>
        )}
      </section>
    </>
  )
}
