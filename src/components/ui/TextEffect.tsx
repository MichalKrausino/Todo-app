// TextEffect — podle motion-primitives (components/core/text-effect.tsx),
// zkrácené na to, co appka používá: text se skládá po znacích nebo slovech,
// každý dílek se vynoří z rozostření. Čtečka dostane celý text najednou
// přes aria-label, dílky jsou aria-hidden — a textContent zůstává jeden
// kus, takže testy čtou „Dnes", ne „DnesDnes" jako u sr-only kopie.
import { useMemo, useRef } from 'react'
import { motion, type Variants } from 'motion/react'
import { klidovyRezim } from '../../lib/motion'

type Per = 'char' | 'word'
type Preset = 'blur' | 'fade-in-blur' | 'fade'

const STAGGER: Record<Per, number> = { char: 0.03, word: 0.05 }

const PRESET: Record<Preset, Variants> = {
  blur: {
    hidden: { opacity: 0, filter: 'blur(10px)' },
    visible: { opacity: 1, filter: 'blur(0px)' },
  },
  'fade-in-blur': {
    hidden: { opacity: 0, y: 12, filter: 'blur(10px)' },
    visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
  },
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  },
}

export function TextEffect({
  children,
  per = 'char',
  as = 'p',
  preset = 'blur',
  className,
  delay = 0,
  speedReveal = 1,
  speedSegment = 1,
}: {
  children: string
  per?: Per
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span'
  preset?: Preset
  className?: string
  delay?: number
  speedReveal?: number
  speedSegment?: number
}) {
  const Tag = useMemo(() => motion.create(as), [as])
  const klid = klidovyRezim()
  const ref = useRef<HTMLElement>(null)
  // Po dojetí se z dílků smaže filtr — blur(0px) v Chromiu rozšiřuje
  // vizuální přesah boxu (viz BlurFade).
  const uklid = () => ref.current?.querySelectorAll<HTMLElement>('span').forEach((el) => el.style.removeProperty('filter'))
  const container: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: STAGGER[per] / speedReveal, delayChildren: delay },
    },
  }
  const item: Variants = {
    hidden: PRESET[preset].hidden,
    visible: { ...(PRESET[preset].visible as object), transition: { duration: 0.3 / speedSegment } },
  }
  const slova = children.split(/(\s+)/)
  return (
    <Tag
      ref={ref as React.RefObject<HTMLParagraphElement>}
      initial={klid ? false : 'hidden'}
      animate="visible"
      variants={container}
      onAnimationComplete={uklid}
      className={className}
      aria-label={children}
    >
      {slova.map((slovo, i) =>
        per === 'word' ? (
          <motion.span key={i} aria-hidden="true" variants={item} className="inline-block whitespace-pre">
            {slovo}
          </motion.span>
        ) : (
          <span key={i} className="inline-block whitespace-pre">
            {slovo.split('').map((znak, j) => (
              <motion.span key={j} aria-hidden="true" variants={item} className="inline-block whitespace-pre">
                {znak}
              </motion.span>
            ))}
          </span>
        ),
      )}
    </Tag>
  )
}
