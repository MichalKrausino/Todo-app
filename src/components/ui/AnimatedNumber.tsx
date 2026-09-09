// AnimatedNumber — podle motion-primitives (components/core/animated-number.tsx).
// Číslo nepřeskočí, ale dojede pružinou; `from` dovolí rozjezd od nuly
// (týdenní ohlédnutí), bez něj číslo na začátku stojí (počet v hlavičce
// Dnes se po otevření nesmí roztančit).
import { useEffect, useMemo } from 'react'
import { motion, useSpring, useTransform, type SpringOptions } from 'motion/react'
import { cn } from '../../lib/cn'
import { klidovyRezim } from '../../lib/motion'

export function AnimatedNumber({
  value,
  from,
  className,
  springOptions = { stiffness: 120, damping: 18, mass: 0.6 },
  as = 'span',
}: {
  value: number
  from?: number
  className?: string
  springOptions?: SpringOptions
  as?: 'span' | 'div'
}) {
  const Tag = useMemo(() => motion.create(as), [as])
  const klid = klidovyRezim()
  const spring = useSpring(klid ? value : (from ?? value), klid ? { duration: 0 } : springOptions)
  const zobraz = useTransform(spring, (v) => Math.round(v).toLocaleString('cs-CZ'))
  useEffect(() => {
    spring.set(value)
  }, [spring, value])
  return <Tag className={cn('tabular-nums', className)}>{zobraz}</Tag>
}
