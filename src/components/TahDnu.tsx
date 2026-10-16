import { useRef, useState } from 'react'
import { osaTahu, posunHlavicky, vysledekTahu, type Osa } from '../lib/tahDnu'

// Tah přes hlavičku Dnes listuje dny (pravidla v `src/lib/tahDnu.ts`).
//
// Pointer events + `touch-action: pan-y`: svislý pohyb si nechá prohlížeč
// (stránka se dál roluje i z hlavičky), vodorovný dostaneme my a teprve
// po rozhodnutí osy si prst chytíme (`setPointerCapture`) — do té doby
// projde ťuknutí na tlačítka uvnitř hlavičky beze změny.
//
// Posun za prstem patří VNITŘNÍMU obalu, ne `<header>`: ten má animaci
// `.rise` s `fill: both` a animace v kaskádě přebíjí inline transform —
// hlavička by se prstem nehnula ani o pixel (stejná past jako u panelů).
export function useTahDnu(posun: number, zmen: (o: -1 | 1) => void) {
  const [dx, setDx] = useState(0)
  const stav = useRef<{ x: number; y: number; t: number; id: number; osa: Osa | null } | null>(null)

  const konec = (e: React.PointerEvent) => {
    const s = stav.current
    stav.current = null
    setDx(0)
    if (!s || s.osa !== 'x' || e.type === 'pointercancel') return
    const vysledek = vysledekTahu(e.clientX - s.x, e.timeStamp - s.t, posun)
    if (vysledek !== 0) zmen(vysledek)
  }

  return {
    dx,
    obsluha: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        stav.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, osa: null }
      },
      onPointerMove: (e: React.PointerEvent) => {
        const s = stav.current
        if (!s || s.id !== e.pointerId) return
        const ddx = e.clientX - s.x
        if (!s.osa) {
          s.osa = osaTahu(ddx, e.clientY - s.y)
          if (s.osa === 'y') {
            stav.current = null
            return
          }
          if (s.osa === 'x') e.currentTarget.setPointerCapture(e.pointerId)
        }
        if (s.osa === 'x') setDx(posunHlavicky(ddx, posun))
      },
      onPointerUp: konec,
      onPointerCancel: konec,
    },
    styl: { touchAction: 'pan-y' } as React.CSSProperties,
    // Vnitřní obal: za prstem bez zpoždění, po puštění se vrátí pružně.
    stylObalu: {
      transform: dx ? `translateX(${dx}px)` : undefined,
      transition: dx ? 'none' : 'transform 0.28s var(--ease-glide)',
    } as React.CSSProperties,
  }
}

// Šipky vedle data — cesta pro klávesnici a myš a viditelná nabídka toho,
// že se dá listovat. Na skryté gesto se nespoléhá.
export function SipkyDnu({ posun, onZmen }: { posun: number; onZmen: (o: -1 | 1) => void }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5">
      {posun > 0 && (
        <button
          type="button"
          onClick={() => onZmen(-1)}
          aria-label="Předchozí den"
          className="flex h-8 w-8 items-center justify-center rounded-full text-accent transition-transform duration-150 active:scale-90"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={() => onZmen(1)}
        aria-label="Další den"
        className="flex h-8 w-8 items-center justify-center rounded-full text-accent transition-transform duration-150 active:scale-90"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </span>
  )
}
