// Command — podle shadcn/ui (registry/new-york-v4/ui/command.tsx) nad
// cmdk: paleta s klávesnicí (šipky, Enter, Esc) a skupinami. Filtrování
// si appka dělá sama bez ohledu na diakritiku (shouldFilter=false),
// cmdk dodává výběr a pohyb po položkách. Vzhled: hlavičky skupin jako
// section-label, položky ve skupinové kartě jako všude jinde.
import { Command as C } from 'cmdk'
import { cn } from '../../lib/cn'

export function Command({ className, ...props }: React.ComponentProps<typeof C>) {
  return <C shouldFilter={false} loop className={cn('flex w-full flex-col', className)} {...props} />
}

export function CommandInput({ className, ...props }: React.ComponentProps<typeof C.Input>) {
  return (
    <C.Input
      className={cn(
        'w-full rounded-full border border-transparent bg-well px-4 py-2.5 text-[16px] text-ink outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent/50 focus:bg-card',
        className,
      )}
      {...props}
    />
  )
}

export function CommandList({ className, ...props }: React.ComponentProps<typeof C.List>) {
  return <C.List className={cn('space-y-4 overflow-y-auto overscroll-contain', className)} {...props} />
}

export function CommandEmpty(props: React.ComponentProps<typeof C.Empty>) {
  return <C.Empty className="px-1 text-[13px] text-ink-faint" {...props} />
}

export function CommandGroup({ className, ...props }: React.ComponentProps<typeof C.Group>) {
  return (
    <C.Group
      className={cn(
        'rise [&_[cmdk-group-heading]]:section-label [&_[cmdk-group-heading]]:mb-2 [&_[cmdk-group-heading]]:block',
        '[&_[cmdk-group-items]]:divide-y [&_[cmdk-group-items]]:divide-line [&_[cmdk-group-items]]:overflow-hidden [&_[cmdk-group-items]]:rounded-2xl [&_[cmdk-group-items]]:bg-card [&_[cmdk-group-items]]:shadow-card',
        className,
      )}
      {...props}
    />
  )
}

export function CommandItem({ className, ...props }: React.ComponentProps<typeof C.Item>) {
  return (
    <C.Item
      className={cn(
        'flex w-full cursor-default items-center gap-2.5 px-4 py-3 text-left transition-colors duration-150 select-none data-[selected=true]:bg-well/60 active:bg-well/60',
        className,
      )}
      {...props}
    />
  )
}

export function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('ml-auto shrink-0', className)} {...props} />
}
