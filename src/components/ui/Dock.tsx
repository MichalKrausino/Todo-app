// Dock — podle magicui (registry/magicui/dock.tsx): ikony v doku se
// zvětšují podle vzdálenosti od kurzoru jako na Macu. Dvě úpravy pro
// appku, která žije hlavně na iPhonu: (1) sleduje se pointer, ne mouse,
// a jen typ „mouse" — Safari při ťuknutí syntetizuje mousemove a ikona
// by po každém ťuknutí zůstala nafouklá; (2) místo vlastní pilulky
// s okrajem dostává dok jen kontext, vzhled skla drží `.dock` v index.css.
import { createContext, useContext, useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react'
import { cn } from '../../lib/cn'

type Kontext = { mouseX: MotionValue<number>; size: number; magnification: number; distance: number }
const DockContext = createContext<Kontext | null>(null)

export function Dock({
  children,
  className,
  iconSize = 40,
  iconMagnification = 50,
  iconDistance = 90,
}: {
  children: React.ReactNode
  className?: string
  iconSize?: number
  iconMagnification?: number
  iconDistance?: number
}) {
  const mouseX = useMotionValue(Infinity)
  return (
    <div
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') mouseX.set(e.clientX)
      }}
      onPointerLeave={() => mouseX.set(Infinity)}
      className={cn('flex items-center', className)}
    >
      <DockContext.Provider value={{ mouseX, size: iconSize, magnification: iconMagnification, distance: iconDistance }}>
        {children}
      </DockContext.Provider>
    </div>
  )
}

export function DockIcon({ children, className }: { children: React.ReactNode; className?: string }) {
  const ctx = useContext(DockContext)
  const fallback = useMotionValue(Infinity)
  const ref = useRef<HTMLDivElement>(null)
  const size = ctx?.size ?? 40
  const magnification = ctx?.magnification ?? 50
  const distance = ctx?.distance ?? 90
  const vzdalenost = useTransform(ctx?.mouseX ?? fallback, (x: number) => {
    const r = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 }
    return x - r.x - r.width / 2
  })
  const cil = useTransform(vzdalenost, [-distance, 0, distance], [size, magnification, size])
  const velikost = useSpring(cil, { mass: 0.1, stiffness: 150, damping: 12 })
  return (
    <motion.div
      ref={ref}
      // Velikost řídí pružina, CSS přechod tu nemá co dělat — a v klidovém
      // režimu by pojistka `transition-duration: 0.01ms` z každého zápisu
      // šířky dělala „běžící" přechod, který audit chování napočítá.
      style={{ width: velikost, height: velikost, transitionProperty: 'none' }}
      className={cn('flex shrink-0 items-center justify-center', className)}
    >
      {children}
    </motion.div>
  )
}
