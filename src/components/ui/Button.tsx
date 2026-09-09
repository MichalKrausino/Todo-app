// Button — podle shadcn/ui (registry/new-york-v4/ui/button.tsx): jedna
// sada variant přes class-variance-authority místo tříd opisovaných u
// každého tlačítka zvlášť. Barvy jsou tokeny appky, ne shadcn paleta:
// default = akcent, secondary = tichá pilulka well, ghost = jen text.
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '../../lib/cn'

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium outline-none transition-[background-color,color,transform,opacity] duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-30 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent text-card',
        secondary: 'bg-well text-ink',
        ghost: 'text-ink-soft active:bg-well',
        destructive: 'text-danger active:bg-danger-wash',
        link: 'text-accent-deep',
      },
      size: {
        default: 'h-10 px-4 text-sm',
        sm: 'h-9 px-3.5 text-[13px]',
        lg: 'h-11 px-5 text-[15px]',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type = 'button',
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'
  return <Comp type={asChild ? undefined : type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
