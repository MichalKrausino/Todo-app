// Kontextový chip — jedna řádka pod hlavičkou (Dnes, detail klienta):
// pilulka s ikonou a počtem, která otevírá panel. Není to sekce — nese
// jen stav a je na jedno ťuknutí. Tóny: card (klidný), accent (návrh,
// napojení), note (signál), moss (v pořádku).
import { cn } from '../lib/cn'

export const CHIP =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-transform duration-150 active:scale-95'

export function Chip({
  tone = 'card',
  className,
  ...props
}: React.ComponentProps<'button'> & { tone?: 'card' | 'accent' | 'note' | 'moss' }) {
  return (
    <button
      type="button"
      className={cn(
        CHIP,
        tone === 'card' && 'bg-card text-ink shadow-card',
        tone === 'accent' && 'bg-accent-wash text-accent-deep',
        tone === 'note' && 'bg-card text-note-ink shadow-card',
        tone === 'moss' && 'bg-card text-moss shadow-card',
        className,
      )}
      {...props}
    />
  )
}
