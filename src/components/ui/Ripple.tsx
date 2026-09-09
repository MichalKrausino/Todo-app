// Ripple — podle magicui (registry/magicui/ripple.tsx): soustředné kruhy,
// které pomalu dýchají (keyframes `ripple` v index.css). Pozadí prázdného
// stavu na Dnes — klidná hladina místo prázdné karty.
import { memo } from 'react'
import { cn } from '../../lib/cn'

export const Ripple = memo(function Ripple({
  mainCircleSize = 120,
  mainCircleOpacity = 0.18,
  numCircles = 5,
  className,
}: {
  mainCircleSize?: number
  mainCircleOpacity?: number
  numCircles?: number
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 select-none mask-[linear-gradient(to_bottom,white,transparent)]', className)}
    >
      {Array.from({ length: numCircles }, (_, i) => {
        const velikost = mainCircleSize + i * 56
        return (
          <div
            key={i}
            className="ripple absolute rounded-full border border-accent bg-accent/8"
            style={{
              width: velikost,
              height: velikost,
              opacity: Math.max(mainCircleOpacity - i * 0.03, 0.03),
              animationDelay: `${i * 0.06}s`,
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%) scale(1)',
            }}
          />
        )
      })}
    </div>
  )
})
