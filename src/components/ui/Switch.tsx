// Switch — podle shadcn/ui (registry/new-york-v4/ui/switch.tsx) nad Radix
// Switch: přístupný přepínač (role, klávesnice, stav) v barvách appky —
// zapnuto zelené `moss` jako všude, kde appka říká „v pořádku".
import { Switch as S } from 'radix-ui'
import { cn } from '../../lib/cn'

export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        'group relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 data-[state=checked]:bg-moss data-[state=unchecked]:bg-edge',
        className,
      )}
      {...props}
    >
      <S.Thumb className="pointer-events-none block h-6 w-6 translate-x-0.5 rounded-full bg-card shadow-card transition-transform duration-300 ease-spring data-[state=checked]:translate-x-[22px]" />
    </S.Root>
  )
}
