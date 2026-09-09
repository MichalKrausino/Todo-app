// BorderBeam — podle magicui (registry/magicui/border-beam.tsx): světlo
// obíhá po okraji karty (offset-path po obdélníku, maska nechá jen
// rámeček). V appce jen na ranním návrhu — je to jediná karta, kterou
// napsal server, a zaslouží si říct „tohle je pro tebe".
import { motion, type MotionStyle } from 'motion/react'
import { cn } from '../../lib/cn'
import { klidovyRezim } from '../../lib/motion'

export function BorderBeam({
  className,
  size = 60,
  duration = 7,
  delay = 0,
  colorFrom = 'var(--color-accent)',
  colorTo = 'var(--color-accent-deep)',
  borderWidth = 1.5,
  reverse = false,
}: {
  className?: string
  size?: number
  duration?: number
  delay?: number
  colorFrom?: string
  colorTo?: string
  borderWidth?: number
  reverse?: boolean
}) {
  if (klidovyRezim()) return null
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
      style={{ '--border-beam-width': `${borderWidth}px` } as React.CSSProperties}
    >
      <motion.div
        className={cn('absolute aspect-square bg-linear-to-l from-(--color-from) via-(--color-to) to-transparent', className)}
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            '--color-from': colorFrom,
            '--color-to': colorTo,
          } as MotionStyle
        }
        initial={{ offsetDistance: '0%' }}
        animate={{ offsetDistance: reverse ? ['100%', '0%'] : ['0%', '100%'] }}
        transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay }}
      />
    </div>
  )
}
