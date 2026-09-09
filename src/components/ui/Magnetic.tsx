// Magnetic — podle motion-primitives (components/core/magnetic.tsx):
// prvek se pod kurzorem lehce přitahuje k myši. Jen tam, kde je myš —
// na dotykovém displeji Safari syntetizuje mouseenter při ťuknutí a
// tlačítko by zůstalo vychýlené.
import { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useSpring, type SpringOptions } from 'motion/react'

const PRUZINA: SpringOptions = { stiffness: 26.7, damping: 4.1, mass: 0.2 }

const maMys = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches

export function Magnetic({
  children,
  intensity = 0.6,
  range = 100,
  springOptions = PRUZINA,
}: {
  children: React.ReactNode
  intensity?: number
  range?: number
  springOptions?: SpringOptions
}) {
  const [aktivni, setAktivni] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, springOptions)
  const sy = useSpring(y, springOptions)
  const [mys] = useState(maMys)

  useEffect(() => {
    if (!mys) return
    const pohyb = (e: MouseEvent) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const dx = e.clientX - (r.left + r.width / 2)
      const dy = e.clientY - (r.top + r.height / 2)
      const d = Math.hypot(dx, dy)
      if (aktivni && d <= range) {
        const s = 1 - d / range
        x.set(dx * intensity * s)
        y.set(dy * intensity * s)
      } else {
        x.set(0)
        y.set(0)
      }
    }
    document.addEventListener('mousemove', pohyb)
    return () => document.removeEventListener('mousemove', pohyb)
  }, [mys, aktivni, intensity, range, x, y])

  if (!mys) return <>{children}</>
  return (
    <motion.div
      ref={ref}
      onMouseEnter={() => setAktivni(true)}
      onMouseLeave={() => {
        setAktivni(false)
        x.set(0)
        y.set(0)
      }}
      style={{ x: sx, y: sy }}
      className="inline-flex"
    >
      {children}
    </motion.div>
  )
}
