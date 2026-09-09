// BlurFade — podle magicui (registry/magicui/blur-fade.tsx). Obsah se
// vynoří z lehkého rozostření a posunu; směr říká, odkud přijíždí
// (u přepínání záložek zleva nebo zprava podle toho, kam se jde).
import { useRef } from 'react'
import { AnimatePresence, motion, useInView, type Variants } from 'motion/react'
import { klidovyRezim } from '../../lib/motion'

export function BlurFade({
  children,
  className,
  duration = 0.4,
  delay = 0,
  offset = 6,
  direction = 'down',
  inView = false,
  inViewMargin = '-50px',
  blur = '6px',
}: {
  children: React.ReactNode
  className?: string
  duration?: number
  delay?: number
  offset?: number
  direction?: 'up' | 'down' | 'left' | 'right'
  inView?: boolean
  inViewMargin?: `${number}px`
  blur?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const vidno = useInView(ref, { once: true, margin: inViewMargin })
  const zobrazit = !inView || vidno
  const klid = klidovyRezim()
  const osa = direction === 'left' || direction === 'right' ? 'x' : 'y'
  const variants: Variants = {
    hidden: {
      [osa]: direction === 'right' || direction === 'down' ? -offset : offset,
      opacity: 0,
      filter: `blur(${blur})`,
    },
    visible: { [osa]: 0, opacity: 1, filter: 'blur(0px)' },
  }
  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial={klid ? false : "hidden"}
        animate={zobrazit ? 'visible' : 'hidden'}
        exit="hidden"
        variants={variants}
        transition={{ delay: 0.04 + delay, duration, ease: 'easeOut', filter: { duration } }}
        // Po dojetí filtr pryč: i blur(0px) je v Chromiu „filtr" a obal
        // dostane o pixel širší vizuální přesah — obsah s -mx-4 pak
        // přetekl přes okraj obrazovky (změřeno 391 > 390).
        onAnimationComplete={() => ref.current?.style.removeProperty('filter')}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
