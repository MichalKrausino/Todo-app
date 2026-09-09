// BlurText — podle react-bits (src/ts-tailwind/TextAnimations/BlurText):
// slova se vynoří z rozostření, každé o chvilku později, až když je
// prvek vidět. Nadpis prázdného stavu na Dnes.
import { useEffect, useRef, useState } from 'react'
import { motion, type Transition } from 'motion/react'
import { klidovyRezim } from '../../lib/motion'

export function BlurText({
  text,
  delay = 120,
  className = '',
  animateBy = 'words',
  direction = 'top',
  stepDuration = 0.32,
}: {
  text: string
  delay?: number
  className?: string
  animateBy?: 'words' | 'letters'
  direction?: 'top' | 'bottom'
  stepDuration?: number
}) {
  const dilky = animateBy === 'words' ? text.split(' ') : text.split('')
  const [vidno, setVidno] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)
  const klid = klidovyRezim()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVidno(true)
          io.disconnect()
        }
      },
      { threshold: 0.1 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const od = direction === 'top' ? { filter: 'blur(10px)', opacity: 0, y: -18 } : { filter: 'blur(10px)', opacity: 0, y: 18 }
  const kroky = [
    { filter: 'blur(5px)', opacity: 0.5, y: direction === 'top' ? 4 : -4 },
    { filter: 'blur(0px)', opacity: 1, y: 0 },
  ]
  const klice = { filter: [od.filter, ...kroky.map((k) => k.filter)], opacity: [od.opacity, ...kroky.map((k) => k.opacity)], y: [od.y, ...kroky.map((k) => k.y)] }

  return (
    <p ref={ref} className={`flex flex-wrap justify-center ${className}`} aria-label={text}>
      {dilky.map((d, i) => {
        const prechod: Transition = { duration: stepDuration * kroky.length, times: [0, 0.5, 1], delay: (i * delay) / 1000 }
        return (
          <motion.span
            key={i}
            aria-hidden="true"
            initial={klid ? false : od}
            animate={klid ? undefined : vidno ? klice : od}
            transition={prechod}
            className="inline-block will-change-[transform,filter,opacity]"
          >
            {d === ' ' ? ' ' : d}
            {animateBy === 'words' && i < dilky.length - 1 && ' '}
          </motion.span>
        )
      })}
    </p>
  )
}
