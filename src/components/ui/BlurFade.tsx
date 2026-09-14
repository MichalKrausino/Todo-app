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
  const posun = direction === 'right' || direction === 'down' ? -offset : offset
  // Na nulu se vrací OBĚ osy, ne jen ta, kterou zrovna jede nájezd.
  // Není to opatrnost: `direction` se během letu mění. Směr počítá App
  // z `prevTab` ref, a jakmile ho efekt srovná, vyjde `dir === 0` a směr
  // přeskočí z 'left'/'right' na 'up'. Kdyby `visible` nastavovala jen
  // `[osa]: 0`, ztratí tím klíč `x` — a motion nechá x zmrzlé tam, kde
  // zrovna bylo. Na Plánu se to trefí pokaždé (živé dotazy překreslí
  // obrazovku hned po nájezdu): celá obrazovka pak natrvalo stojí
  // o `offset` vpravo, tedy mimo svislici, na které stojí zbytek appky.
  const variants: Variants = {
    hidden: {
      x: osa === 'x' ? posun : 0,
      y: osa === 'y' ? posun : 0,
      opacity: 0,
      filter: `blur(${blur})`,
    },
    visible: { x: 0, y: 0, opacity: 1, filter: 'blur(0px)' },
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
