// BorderBeam — nápad z magicui (registry/magicui/border-beam.tsx): světlo
// obíhá po okraji karty, maska nechá vidět jen rámeček. V appce jen na
// ranním návrhu — je to jediná karta, kterou napsal server, a zaslouží si
// říct „tohle je pro tebe".
//
// Pohyb je ale přepsaný. Předloha vede světlo po `offset-path` a animuje
// `offset-distance` — tu vlastnost neumí předat kompozitoru žádný
// prohlížeč, takže ji motion přepisuje z JS **při každém snímku**. Světlo
// tím leží na hlavním vlákně a zastaví se pokaždé, když appka překresluje
// seznam nebo když se roluje (změřeno při 4× zpomaleném procesoru: rozptyl
// kroku ±35 % a sedmkrát za pět vteřin stálo). Tady místo toho rotuje
// kuželový přechod přes `transform`, obyčejnou CSS animací (`.beam-svetlo`
// v `index.css`) — to kompozitor zvládne sám a JS se toho nedotkne.
//
// Rotace znamená stálou úhlovou rychlost, ne dráhovou: po delší hraně
// světlo přejede rychleji. Na chipu „Návrh · 3" je to nepoznat a stojí to
// za to — obíhající světlo, které se zadrhává, je horší než žádné.
import { cn } from '../../lib/cn'
import { klidovyRezim } from '../../lib/motion'

export function BorderBeam({
  className,
  /** vteřiny na jeden oběh */
  doba = 5,
  /** délka světla ve stupních */
  luk = 70,
  colorFrom = 'var(--color-accent)',
  colorTo = 'var(--color-accent-deep)',
  borderWidth = 1.5,
}: {
  className?: string
  doba?: number
  luk?: number
  colorFrom?: string
  colorTo?: string
  borderWidth?: number
}) {
  if (klidovyRezim()) return null
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
      style={{ '--border-beam-width': `${borderWidth}px` } as React.CSSProperties}
    >
      <span
        className={cn('beam-svetlo', className)}
        style={
          {
            '--beam-doba': `${doba}s`,
            '--beam-luk': `${luk}deg`,
            '--beam-od': colorFrom,
            '--beam-do': colorTo,
          } as React.CSSProperties
        }
      />
    </div>
  )
}
