// Tooltip — podle shadcn/ui (registry/new-york-v4/ui/tooltip.tsx) nad
// Radix Tooltip. Otevírá se jen z myši nebo klávesnice (Radix ťuknutí
// prstem přeskočí), takže na iPhonu nepřekáží a na Macu ukáže zkratku.
// z-index pod panely (z-50): otevřený panel tooltip zakryje.
import { Tooltip as T } from 'radix-ui'
import { cn } from '../../lib/cn'

export function TooltipProvider(props: React.ComponentProps<typeof T.Provider>) {
  return <T.Provider delayDuration={350} skipDelayDuration={400} {...props} />
}

export const Tooltip = T.Root
export const TooltipTrigger = T.Trigger

export function TooltipContent({ className, sideOffset = 6, children, ...props }: React.ComponentProps<typeof T.Content>) {
  return (
    <T.Portal>
      <T.Content
        sideOffset={sideOffset}
        className={cn(
          'tip pointer-events-none z-[45] flex items-center gap-1.5 rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-medium text-paper shadow-float',
          className,
        )}
        {...props}
      >
        {children}
      </T.Content>
    </T.Portal>
  )
}
