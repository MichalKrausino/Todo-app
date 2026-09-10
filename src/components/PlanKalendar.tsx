// Kalendář Plánu — týden jako tichý graf času.
//
// Dvě verze za sebou byly „kalendář jako všude": čísla, tečky, šipky.
// Tečka umí říct jen „něco tam je", a marketér s pěti klienty potřebuje
// vidět jinou věc: KOLIK času ten den sežere a KOMU patří. Pod každým
// číslem proto stojí sloupek — výška je naplánovaný čas (strop osm
// hodin), barvy jsou klienti, šedá je schůzka nebo úkol bez klienta.
// Týden se tak čte jako malý graf: čtvrtek je V Bílém, pátek nabitý,
// víkend prázdný. Přesný obsah dne pak stojí v kartě pod kalendářem,
// která z vybraného dne vyrůstá (ocásek karty sedí pod jeho sloupcem).
//
// Listuje se NATIVNĚ: pás tří stránek (minulý · tento · další) s
// `scroll-snap`, takže tah má setrvačnost a dopružení prohlížeče, ne
// naši aproximaci přes pointer events. Po dojetí se pás tiše přestaví
// zpátky na prostřední stránku (useLayoutEffect před vykreslením —
// obsah je stejný, oko nic nepozná). Listování bere výběr s sebou:
// týden dopředu = tentýž den příští týden, agenda dole vždycky patří
// dni, který je vidět. Šipky jsou jen pro myš (`pointer-fine`).
//
// Jediná plná výplň je inkoustový kroužek vybraného dne, který mezi dny
// plyne (`layoutId`); dnešek je modré písmo a v hlavičce sloupce má
// místo zkratky dne štítek „dnes". Audit kontrastu čte podklad z předků,
// ne z létající pilulky: vybraný kroužek proto dostane vlastní `bg-ink`,
// jakmile pilulka dojede (400 ms), a v klidovém režimu hned.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { addDays, formatFullDate, fromISODate, mondayOf, toISODate, todayISO } from '../lib/dates'
import { plural } from '../lib/labels'
import { klidovyRezim } from '../lib/motion'

export type PlanRezim = 'tyden' | 'mesic'

/** Nálož jednoho dne: minuty podle klienta (bez barvy = schůzka / bez klienta). */
export interface DenNaloz {
  polozky: number
  minuty: number
  dily: { barva?: string; minuty: number }[]
}

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

// Pás má tři stránky — okno dnů, pro které kalendář potřebuje nálož.
export function oknoPasu(kotva: string, rezim: PlanRezim): [string, string] {
  const pred = dnyObdobi(posunKotvu(kotva, rezim, -1), rezim)
  const po = dnyObdobi(posunKotvu(kotva, rezim, 1), rezim)
  return [pred[0], po[po.length - 1]]
}

// Strop sloupku: osm hodin je plný den.
const PLNY_DEN_MIN = 8 * 60
// Než pilulka dojede na nové místo (pružina 0.45 s).
const DOJEZD_MS = 400
// Klid po posledním scroll eventu = tah dojel (záloha za `scrollend`).
const DOJEZD_SCROLL_MS = 140

const pruzina = { type: 'spring', bounce: 0.2, duration: 0.45 } as const

export function PlanKalendar({
  kotva,
  rezim,
  vybrany,
  naloz,
  onVyber,
  onRezim,
}: {
  kotva: string
  rezim: PlanRezim
  vybrany: string
  /** nálož dnů v okně pásu (`oknoPasu`) — sloupky pod čísly */
  naloz: Map<string, DenNaloz>
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

  // Pevný podklad pod vybraným kroužkem až po dojezdu pilulky.
  const [usazeno, setUsazeno] = useState(klid)
  useEffect(() => {
    if (klid) return
    setUsazeno(false)
    const t = setTimeout(() => setUsazeno(true), DOJEZD_MS)
    return () => clearTimeout(t)
  }, [vybrany, rezim, klid])

  // Pás: po každé změně období stojí prostřední stránka uprostřed.
  const pas = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = pas.current
    if (el) el.scrollLeft = el.clientWidth
  }, [kotva, rezim])

  const dojel = () => {
    const el = pas.current
    if (!el || el.clientWidth === 0) return
    const i = Math.round(el.scrollLeft / el.clientWidth) - 1
    if (i !== 0) onVyber(posunVyber(vybrany, rezim, i))
  }
  const casovac = useRef<ReturnType<typeof setTimeout> | null>(null)
  const priScrollu = () => {
    if (casovac.current) clearTimeout(casovac.current)
    casovac.current = setTimeout(dojel, DOJEZD_SCROLL_MS)
  }
  useEffect(() => {
    const el = pas.current
    if (!el) return
    const h = () => {
      if (casovac.current) clearTimeout(casovac.current)
      dojel()
    }
    el.addEventListener('scrollend', h)
    return () => el.removeEventListener('scrollend', h)
  })

  // Šipky (jen myš): plynulé odrolování na vedlejší stránku, zbytek
  // udělá dojezd stejně jako po tahu prstem.
  const listuj = (delta: number) => {
    const el = pas.current
    if (!el) return
    if (klid) {
      onVyber(posunVyber(vybrany, rezim, delta))
      return
    }
    el.scrollTo({ left: el.clientWidth * (1 + delta), behavior: 'smooth' })
  }

  // Sloupek: v týdnu vyšší (čte se jako graf), v měsíci nižší, aby se
  // šest řádků vešlo. Když na dni něco je, má sloupek aspoň minimum —
  // hodina z osmi by jinak byla dvoupixelová čárka bez barvy.
  const vyskaSloupku = rezim === 'tyden' ? 22 : 8
  const minSloupku = rezim === 'tyden' ? 6 : 3

  const bunka = (iso: string) => {
    const d = fromISODate(iso)
    const n = naloz.get(iso)
    const polozky = n?.polozky ?? 0
    const selected = iso === vybrany
    const isToday = iso === today
    const past = iso < today
    const cislo = selected
      ? 'font-semibold text-card'
      : isToday
        ? 'font-semibold text-accent-deep'
        : past
          ? 'text-ink-faint'
          : polozky > 0
            ? 'font-semibold text-ink'
            : 'text-ink-soft'
    // Sloupek: výška je čas (strop osm hodin, aspoň 3 px, když něco je),
    // díly odspoda od největšího.
    const celkem = n?.minuty ?? 0
    const vyska = celkem > 0 ? Math.max(minSloupku, Math.round((Math.min(celkem, PLNY_DEN_MIN) / PLNY_DEN_MIN) * vyskaSloupku)) : 0
    const dily = n ? [...n.dily].sort((a, b) => b.minuty - a.minuty) : []
    const popis = `${formatFullDate(d)}${polozky > 0 ? `, ${polozky} ${plural(polozky, 'položka', 'položky', 'položek')}` : ', volno'}`
    return (
      <button
        key={iso}
        type="button"
        data-day={iso}
        data-load={polozky}
        aria-pressed={selected}
        aria-label={popis}
        onClick={() => onVyber(iso)}
        className={`flex flex-col items-center transition-transform duration-150 active:scale-95 ${rezim === 'tyden' ? 'py-1' : 'py-0.5'}`}
      >
        <span
          className={`relative flex h-9 w-9 items-center justify-center rounded-full ${selected && usazeno ? 'bg-ink' : ''}`}
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
          <span className={`relative z-10 text-[17px] leading-none tabular-nums ${cislo}`}>{d.getDate()}</span>
        </span>
        <span className={`mt-1 flex items-end ${rezim === 'tyden' ? 'w-6' : 'w-5'}`} style={{ height: vyskaSloupku }} aria-hidden="true">
          {vyska > 0 && klid && (
            <span className="flex w-full flex-col-reverse overflow-hidden rounded-[3px]" style={{ height: vyska }}>
              {dily.map((dil, i) => (
                <span
                  key={i}
                  className={dil.barva ? '' : 'bg-ink-faint'}
                  style={{ flex: `${dil.minuty} 0 0`, background: dil.barva }}
                />
              ))}
            </span>
          )}
          {/* Sloupky vyrostou odspoda, každý sloupec o chlup později —
              graf se „nakreslí", místo aby naskočil. */}
          {vyska > 0 && !klid && (
            <motion.span
              className="flex w-full flex-col-reverse overflow-hidden rounded-[3px]"
              initial={{ height: 0 }}
              animate={{ height: vyska }}
              transition={{ type: 'spring', bounce: 0, duration: 0.55, delay: 0.05 + ((d.getDay() + 6) % 7) * 0.03 }}
            >
              {dily.map((dil, i) => (
                <span
                  key={i}
                  className={dil.barva ? '' : 'bg-ink-faint'}
                  style={{ flex: `${dil.minuty} 0 0`, background: dil.barva }}
                />
              ))}
            </motion.span>
          )}
        </span>
      </button>
    )
  }

  // Stránka pásu: týden je sedm buněk, měsíc tolik řádků, kolik chce
  // nejdelší ze tří stránek v pásu — sousedi mají stejnou výšku, takže
  // tah neposkakuje, a prázdný šestý řádek se kreslí jen když ho někdo
  // z nich opravdu potřebuje.
  const stranky = [-1, 0, 1].map((i) => posunKotvu(kotva, rezim, i))
  const radkuMesice = (k: string) => {
    const d = dnyObdobi(k, rezim)
    return Math.ceil(((fromISODate(d[0]).getDay() + 6) % 7 + d.length) / 7)
  }
  const radky = rezim === 'mesic' ? Math.max(...stranky.map(radkuMesice)) : 1
  const stranka = (k: string) => {
    const dnyStranky = dnyObdobi(k, rezim)
    const lead = rezim === 'mesic' ? (fromISODate(dnyStranky[0]).getDay() + 6) % 7 : 0
    const trail = rezim === 'mesic' ? radky * 7 - lead - dnyStranky.length : 0
    return (
      <div key={k} className="grid w-full shrink-0 snap-start grid-cols-7">
        {Array.from({ length: lead }).map((_, i) => (
          <span key={`l${i}`} />
        ))}
        {dnyStranky.map(bunka)}
        {Array.from({ length: trail }).map((_, i) => (
          <span key={`t${i}`} />
        ))}
      </div>
    )
  }

  // Hlavička sloupců: v týdnu patří prostřední stránce, takže dnešek má
  // místo zkratky „dnes"; v měsíci jsou to jen dny v týdnu.
  const hlavicky = DNY.map((w, i) => {
    const iso = rezim === 'tyden' ? dny[i] : null
    const dnes = iso === today
    return (
      <span
        key={w}
        className={`pb-1 text-center text-[11px] font-medium leading-none ${dnes ? 'text-accent-deep' : 'text-ink-faint'}`}
      >
        {dnes ? 'dnes' : w}
      </span>
    )
  })

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        {/* Název období je zároveň přepínač týden ↔ měsíc — šipka vedle
            říká, kam se to rozbalí. */}
        <button
          type="button"
          onClick={() => onRezim(rezim === 'tyden' ? 'mesic' : 'tyden')}
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
              onClick={() => onVyber(today)}
              className="pop-soft h-10 rounded-full px-2.5 text-[13px] font-medium text-accent-deep transition-transform duration-150 active:scale-95"
            >
              Dnes
            </button>
          )}
          <button
            type="button"
            onClick={() => listuj(-1)}
            aria-label={rezim === 'tyden' ? 'Předchozí týden' : 'Předchozí měsíc'}
            className="hidden h-10 w-10 items-center justify-center rounded-full text-ink-soft transition-transform duration-150 pointer-fine:flex active:scale-90"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => listuj(1)}
            aria-label={rezim === 'tyden' ? 'Další týden' : 'Další měsíc'}
            className="hidden h-10 w-10 items-center justify-center rounded-full text-ink-soft transition-transform duration-150 pointer-fine:flex active:scale-90"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7">{hlavicky}</div>
      <div
        ref={pas}
        onScroll={priScrollu}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        {stranky.map(stranka)}
      </div>
    </div>
  )
}
