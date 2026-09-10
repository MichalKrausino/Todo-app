// Kalendář Plánu — týden, který se rozbalí na měsíc.
//
// Plán dřív měl pás čtrnácti dnů s tečkami a pod ním sekci na každý den,
// na kterém něco leželo. Prázdný den nešel ani vybrat, natož na něj něco
// naplánovat, a nikde nebyl vidět týden jako celek. Tohle je kalendář,
// jak ho lidé znají z telefonu: sedm dnů v řádce, ťuknutí na název
// měsíce rozbalí celý měsíc, listuje se šipkami i švihnutím do strany.
//
// Jazyk je stejný jako v kalendáříku u zadávání (MonthPicker): jediná
// plná výplň je vybraný den, dnešek má kroužek, vytížení dne je tečka
// pod číslem. Vybraný den se nikdy nepřekrývá s vytížením — tečka se
// u něj neukazuje, co na něm je, stojí rozepsané pod kalendářem.

import { useRef } from 'react'
import { addDays, fromISODate, mondayOf, toISODate, todayISO } from '../lib/dates'

export type PlanRezim = 'tyden' | 'mesic'

const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']
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

// Semaforová tečka: klidná = pár věcí, oranžová = nabito, červená = plno.
function loadDot(count: number): string {
  if (count <= 0) return ''
  if (count <= 2) return 'bg-accent/70'
  if (count <= 4) return 'bg-amber'
  return 'bg-danger'
}

// Práh švihnutí: pod ním je to ťuknutí, nad ním listování.
const SVIH_PX = 48

export function PlanKalendar({
  kotva,
  rezim,
  vybrany,
  zatizeni,
  onVyber,
  onKotva,
  onRezim,
}: {
  kotva: string
  rezim: PlanRezim
  vybrany: string
  /** kolik toho na dni je (úkoly + schůzky) — tečka pod číslem */
  zatizeni: Map<string, number>
  onVyber: (iso: string) => void
  onKotva: (iso: string) => void
  onRezim: (r: PlanRezim) => void
}) {
  const today = todayISO()
  const dny = dnyObdobi(kotva, rezim)
  const prvni = fromISODate(dny[0])
  const posledni = fromISODate(dny[dny.length - 1])
  // Týden přes přelom měsíce se pojmenuje oběma: „září – říjen 2026".
  const nazev =
    rezim === 'mesic' || prvni.getMonth() === posledni.getMonth()
      ? monthYearFmt.format(rezim === 'mesic' ? prvni : posledni)
      : `${monthFmt.format(prvni)} – ${monthYearFmt.format(posledni)}`
  const lead = rezim === 'mesic' ? (prvni.getDay() + 6) % 7 : 0

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
    onKotva(posunKotvu(kotva, rezim, dx < 0 ? 1 : -1))
  }

  const bunka = (iso: string) => {
    const d = fromISODate(iso)
    const n = zatizeni.get(iso) ?? 0
    const selected = iso === vybrany
    const isToday = iso === today
    const past = iso < today
    const weekend = [0, 6].includes(d.getDay())
    const cls = selected
      ? 'bg-accent font-semibold text-card'
      : isToday
        ? 'ring-1 ring-accent font-semibold text-accent-deep'
        : past
          ? 'text-ink-faint'
          : weekend
            ? 'text-ink-soft'
            : 'text-ink'
    return (
      <button
        key={iso}
        type="button"
        data-day={iso}
        data-load={n}
        aria-pressed={selected}
        aria-label={`${iso}${n > 0 ? `, ${n} položek` : ', volno'}`}
        onClick={() => onVyber(iso)}
        className="flex flex-col items-center justify-center"
      >
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-full text-[16px] tabular-nums transition-colors duration-150 ${cls}`}
        >
          {d.getDate()}
        </span>
        <span className={`mt-[3px] h-1.5 w-1.5 rounded-full ${selected ? '' : loadDot(n)}`} />
      </button>
    )
  }

  return (
    <div className="rounded-2xl bg-card px-2 pb-2 pt-1 shadow-card">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onKotva(posunKotvu(kotva, rezim, -1))}
          aria-label={rezim === 'tyden' ? 'Předchozí týden' : 'Předchozí měsíc'}
          className="flex h-10 w-10 items-center justify-center rounded-full text-accent transition-transform duration-150 active:scale-90"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        {/* Název období je zároveň přepínač týden ↔ měsíc — šipka vedle
            říká, kam se to rozbalí. */}
        <button
          type="button"
          onClick={() => onRezim(rezim === 'tyden' ? 'mesic' : 'tyden')}
          aria-expanded={rezim === 'mesic'}
          className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[16px] font-semibold text-ink transition-transform duration-150 first-letter:uppercase active:scale-95"
        >
          <span key={nazev} className="pop-soft inline-block first-letter:uppercase">{nazev}</span>
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 text-ink-faint/70 transition-transform duration-200 ${rezim === 'mesic' ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onKotva(posunKotvu(kotva, rezim, 1))}
          aria-label={rezim === 'tyden' ? 'Další týden' : 'Další měsíc'}
          className="flex h-10 w-10 items-center justify-center rounded-full text-accent transition-transform duration-150 active:scale-90"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <div
        key={`${rezim}:${kotva}`}
        className="rise grid grid-cols-7 gap-y-1.5 text-center"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={start}
        onPointerUp={konec}
        onPointerCancel={() => (tah.current = null)}
      >
        {WEEKDAYS.map((w) => (
          <span key={w} className="pb-0.5 text-[11px] font-medium text-ink-faint">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }).map((_, i) => (
          <span key={`lead${i}`} />
        ))}
        {dny.map(bunka)}
      </div>
    </div>
  )
}
