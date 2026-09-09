// AnimatedBackground — podle motion-primitives
// (components/core/animated-background.tsx): zvýraznění, které mezi
// položkami plyne (layoutId), místo aby na vybrané naskočilo. Tady
// řízené zvenčí hodnotou `value`; každé dítě nese `data-id` a dostane
// `data-checked`, ať si barvu textu řídí přes data-[checked=true]:.
import { AnimatePresence, motion, type Transition } from 'motion/react'
import { Children, cloneElement, isValidElement, useId, type ReactElement } from 'react'
import { cn } from '../../lib/cn'

type Dite = ReactElement<{
  'data-id': string
  className?: string
  children?: React.ReactNode
  onClick?: () => void
}>

export function AnimatedBackground({
  children,
  value,
  onValueChange,
  className,
  transition = { type: 'spring', bounce: 0.2, duration: 0.45 },
}: {
  children: React.ReactNode
  value: string | null
  onValueChange?: (id: string) => void
  className?: string
  transition?: Transition
}) {
  const uid = useId()
  return Children.map(children, (child) => {
    if (!isValidElement<Dite['props']>(child)) return child
    const id = child.props['data-id']
    const aktivni = value === id
    return cloneElement(
      child,
      {
        className: cn('relative', child.props.className),
        'data-checked': aktivni ? 'true' : 'false',
        onClick: () => {
          onValueChange?.(id)
          child.props.onClick?.()
        },
      } as Partial<Dite['props']>,
      <>
        <AnimatePresence initial={false}>
          {aktivni && (
            <motion.span
              layoutId={`pozadi-${uid}`}
              className={cn('absolute inset-0', className)}
              transition={transition}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          )}
        </AnimatePresence>
        <span className="relative z-10 inline-flex items-center gap-1.5">{child.props.children}</span>
      </>,
    )
  })
}
