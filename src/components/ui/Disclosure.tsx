// DisclosureContent — podle motion-primitives (components/core/disclosure.tsx):
// obsah se rozbaluje na výšku „auto" a zase skládá, místo aby naskočil.
// Spouštěč zůstává komponentě, která rozbalení vlastní (SbalenaSekce
// si pamatuje stav v localStorage), tady je jen animovaný obsah.
import { AnimatePresence, motion } from 'motion/react'
import { klidovyRezim } from '../../lib/motion'
import { cn } from '../../lib/cn'

export function DisclosureContent({
  open,
  children,
  className,
}: {
  open: boolean
  children: React.ReactNode
  className?: string
}) {
  const klid = klidovyRezim()
  return (
    <div className={cn('overflow-hidden', className)}>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={klid ? { duration: 0 } : { duration: 0.32, ease: [0.25, 1, 0.5, 1] }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
