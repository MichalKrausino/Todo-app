// Kbd — podle shadcn/ui (registry/new-york-v4/ui/kbd.tsx): klávesa jako
// malá kostka; uvnitř tooltipu se obrátí do světlého na tmavém.
import { cn } from '../../lib/cn'

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-0.5 rounded-[5px] bg-well px-1.5 font-sans text-[11px] font-medium text-ink-soft',
        '[.tip_&]:bg-paper/20 [.tip_&]:text-paper',
        className,
      )}
      {...props}
    />
  )
}

export function KbdGroup({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('inline-flex items-center gap-1', className)} {...props} />
}
