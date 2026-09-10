// Kalendář Plánu — typografie na papíře, ne mřížka v krabici.
//
// První verze byla kalendář z telefonu v bílé kartě: modré šipky, modrý
// vybraný den, modré tečky, pod čísly prázdná řádka pro tečky, a když se
// listovalo, vybraný den zůstal mimo obrazovku, takže agenda dole
// ukazovala den, který nebyl vidět. Tři modré věci v jedné řádce si
// konkurovaly a karta okolo sedmi čísel nic nedělala.
//
// Teď: (1) kalendář stojí přímo na papíře jako pás čísel — jediná karta
// na obrazovce je agenda pod ním; (2) jediná plná výplň je INKOUSTOVÁ
// pilulka vybraného dne, která mezi dny plyne (`layoutId`, stejný vzor
// jako pilulka pod záložkou doku); dnešek je modré písmo a místo zkratky
// dne má štítek „dnes"; (3) vytížení dne dělá váha písma a tři tiché
// tečky uvnitř buňky, ne semafor pod ní; (4) šipky jsou tiché, „Dnes" je
// v hlavičce kalendáře, ne v cizí řádce chipů; (5) listování posouvá
// i výběr — týden dopředu znamená tentýž den příští týden, agenda dole
// tak vždycky patří dni, který je vidět. Název měsíce je přepínač na celý
// měsíc; buňky mají stejný tvar, pilulka jen doplyne na nové místo.
//
// Audit kontrastu čte podklad z předků, ne z létající pilulky: vybraná
// buňka proto dostane vlastní `bg-ink`, jakmile pilulka dojede (400 ms),
// a v klidovém režimu hned.

import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { addDays, formatFullDate, fromISODate, mondayOf, toISODate, todayISO } from '../lib/dates'
import { plural } from '../lib/labels'
import { klidovyRezim } from '../lib/motion'

export type PlanRezim = 'tyden' | 'mesic'

const DNY = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne']
const monthYearFmt = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' })
const monthFmt = new Intl.DateTimeFormat('cs-CZ', { month: 'long' })

// Kotva období: v týdnu pondělí, v měsíci první den měsíce.
export const kotvaPro = (iso: string, rezim: PlanRezim): string =>
  rezim === 'tyden' ? mondayOf(iso) : `${iso.slice(0, 7)}-01`

// Dny období od kotvy — týden má sedm, měsíc tolik, kolik má dní.
export function dnyObdobi(kotva: string, rezim: PlanRezim): string[] {
  if (rezim === 'tyden') {
    return Array.from({ length: 7 }, (_, i) => toISODate(addDays(fromISODate(kotva), i)))
  }
  const d = fromISODate(kotva)
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return Array.from({ length: n }, (_, i) => `${kotva.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`)
}

export function posunKotvu(kotva: string, rezim: PlanRezim, delta: number): string {
  if (rezim === 'tyden') return toISODate(addDays(fromISODate(kotva), 7 * delta))
  const d = fromISODate(kotva)
  return toISODate(new Date(d.getFullYear(), d.getMonth() + delta, 1))
}

// Listování bere výběr s sebou: v týdnu tentýž den v týdnu, v měsíci
// totéž číslo (a když ho další měsíc nemá, jeho poslední den).
export function posunVyber(vybrany: string, rezim: PlanRezim, delta: number): string {
  const d = fromISODate(vybrany)
  if (rezim === 'tyden') return toISODate(addDays(d, 7 * delta))
  const posledni = new Date(d.getFullYear(), d.getMonth() + delta + 1, 0).getDate()
  return toISODate(new Date(d.getFullYear(), d.getMonth() + delta, Math.min(d.getDate(), posledni)))
}

// Práh švihnutí: pod ním je to ťuknutí, nad ním listování.
const SVIH_PX = 48
// Kolik teček nejvýš — přesný obsah dne stojí rozepsaný pod kalendářem.
const TECKY_MAX = 3
// Od kolika položek je den plný a tečky zčervenají.
const PLNY_DEN = 5
// Než pilulka dojede na nové místo (pružina 0.45 s).
const DOJEZD_MS = 400

const pruzina = { type: 'spring', bounce: 0.2, duration: 0.45 } as const

export function PlanKalendar({
  kotva,
  rezim,
  vybrany,
  zatizeni,
  onVyber,
  onRezim,
}: {
  kotva: string
  rezim: PlanRezim
  vybrany: string
  /** kolik toho na dni je (úkoly + schůzky) — tečky a váha čísla */
  zatizeni: Map<string, number>
  onVyber: (iso: string) => void
  onRezim: (r: PlanRezim) => void
}) {
  const today = todayISO()
  const klid = klidovyRezim()
  const dny = dnyObdobi(kotva, rezim)
  const prvni = fromISODate(dny[0])
  const posledni = fromISODate(dny[dny.length - 1])
  // Týden přes přelom měsíce se pojmenuje oběma: „září – říjen 2026".
  const nazev =
    rezim === 'mesic' || prvni.getMonth() === posledni.getMonth()
      ? monthYearFmt.format(rezim === 'mesic' ? prvni : posledni)
      : `${monthFmt.format(prvni)} – ${monthYearFmt.format(posledni)}`
  const lead = rezim === 'mesic' ? (prvni.getDay() + 6) % 7 : 0

  // Směr listování řídí, odkud nová stránka přijede.
  const smer = useRef(0)
  const listuj = (delta: number) => {
    smer.current = delta
    onVyber(posunVyber(vybrany, rezim, delta))
  }
  const prepni = () => {
    smer.current = 0
    onRezim(rezim === 'tyden' ? 'mesic' : 'tyden')
  }

  // Pevný podklad pod vybranou buňkou až po dojezdu pilulky.
  const [usazeno, setUsazeno] = useState(klid)
  useEffect(() => {
    if (klid) return
    setUsazeno(false)
    const t = setTimeout(() => setUsazeno(true), DOJEZD_MS)
    return () => clearTimeout(t)
  }, [vybrany, rezim, klid])

  // Švihnutí do strany listuje; svislý tah patří rolování stránky
  // (touch-action: pan-y), takže se s ním nepere.
  const tah = useRef<{ x: number; y: number } | null>(null)
  const start = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    tah.current = { x: e.clientX, y: e.clientY }
  }
  const konec = (e: React.PointerEvent) => {
    const t = tah.current
    tah.current = null
    if (!t) return
    const dx = e.clientX - t.x
    const dy = e.clientY - t.y
    if (Math.abs(dx) < SVIH_PX || Math.abs(dx) < Math.abs(dy) * 1.2) return
    listuj(dx < 0 ? 1 : -1)
  }

  const bunka = (iso: string) => {
    const d = fromISODate(iso)
    const n = zatizeni.get(iso) ?? 0
    const selected = iso === vybrany
    const isToday = iso === today
    const past = iso < today
    const tyden = rezim === 'tyden'
    const cislo = selected
      ? 'font-semibold text-card'
      : isToday
        ? 'font-semibold text-accent-deep'
        : past
          ? 'text-ink-faint'
          : n > 0
            ? 'font-semibold text-ink'
            : 'text-ink-soft'
    const tecka = selected ? 'bg-card/70' : n >= PLNY_DEN ? 'bg-danger' : 'bg-ink-faint'
    const popis = `${formatFullDate(d)}${n > 0 ? `, ${n} ${plural(n, 'položka', 'položky', 'položek')}` : ', volno'}`
    return (
      <button
        key={iso}
        type="button"
        data-day={iso}
        data-load={n}
        aria-pressed={selected}
        aria-label={popis}
        onClick={() => onVyber(iso)}
        className="flex justify-center py-0.5 transition-transform duration-150 active:scale-95"
      >
        <span
          className={`relative flex w-9 flex-col items-center justify-center rounded-full ${tyden ? 'h-[60px]' : 'h-11'} ${
            selected && usazeno ? 'bg-ink' : ''
          }`}
        >
          {selected &&
            (klid ? (
              <span className="absolute inset-0 rounded-full bg-ink" />
            ) : (
              <motion.span
                layoutId="plan-pilulka"
                className="absolute inset-0 rounded-full bg-ink"
                transition={pruzina}
                initial={false}
              />
            ))}
          {tyden && (
            <span
              className={`relative z-10 text-[11px] font-medium leading-none ${
                selected ? 'text-card' : isToday ? 'text-accent-deep' : 'text-ink-faint'
              }`}
            >
              {isToday ? 'dnes' : DNY[(d.getDay() + 6) % 7]}
            </span>
          )}
          <span className={`relative z-10 text-[17px] leading-none tabular-nums ${tyden ? 'mt-1.5' : ''} ${cislo}`}>
            {d.getDate()}
          </span>
          <span className="relative z-10 mt-1.5 flex h-1 items-center gap-[3px]">
            {Array.from({ length: Math.min(n, TECKY_MAX) }).map((_, i) => (
              <span key={i} className={`h-[3px] w-[3px] rounded-full ${tecka}`} />
            ))}
          </span>
        </span>
      </button>
    )
  }

  const mrizka = (
    <div
      className="grid grid-cols-7"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={start}
      onPointerUp={konec}
      onPointerCancel={() => (tah.current = null)}
    >
      {rezim === 'mesic' &&
        DNY.map((w) => (
          <span key={w} className="pb-1 text-center text-[11px] font-medium leading-none text-ink-faint">
            {w}
          </span>
        ))}
      {Array.from({ length: lead }).map((_, i) => (
        <span key={`lead${i}`} />
      ))}
      {dny.map(bunka)}
    </div>
  )

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        {/* Název období je zároveň přepínač týden ↔ měsíc — šipka vedle
            říká, kam se to rozbalí. */}
        <button
          type="button"
          onClick={prepni}
          aria-expanded={rezim === 'mesic'}
          className="-ml-2 inline-flex h-10 items-center gap-1 rounded-full px-2 text-[17px] font-semibold text-ink transition-transform duration-150 active:scale-95"
        >
          <span key={nazev} className="pop-soft inline-block first-letter:uppercase">{nazev}</span>
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 text-ink-faint transition-transform duration-200 ${rezim === 'mesic' ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <div className="-mr-2 flex items-center">
          {vybrany !== today && (
            <button
              type="button"
              onClick={() => {
                smer.current = vybrany > today ? -1 : 1
                onVyber(today)
              }}
              className="pop-soft h-10 rounded-full px-2.5 text-[13px] font-medium text-accent-deep transition-transform duration-150 active:scale-95"
            >
              Dnes
            </button>
          )}
          <button
            type="button"
            onClick={() => listuj(-1)}
            aria-label={rezim === 'tyden' ? 'Předchozí týden' : 'Předchozí měsíc'}
            className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition-transform duration-150 active:scale-90"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => listuj(1)}
            aria-label={rezim === 'tyden' ? 'Další týden' : 'Další měsíc'}
            className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition-transform duration-150 active:scale-90"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Nová stránka přijede ze strany, kam se listovalo; přepnutí
          týden ↔ měsíc se jen vynoří. V klidu stojí rovnou na místě. */}
      {klid ? (
        <div key={`${rezim}:${kotva}`}>{mrizka}</div>
      ) : (
        <motion.div
          key={`${rezim}:${kotva}`}
          initial={{ opacity: 0, x: smer.current * 18, y: smer.current === 0 ? 6 : 0 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
        >
          {mrizka}
        </motion.div>
      )}
    </div>
  )
}
