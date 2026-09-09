// Stavová řádka úkolu — slot pro jednu vlastnost (Termín / Klient /
// Projekt / Priorita / Opakování). Vznikla pro zadávání v doku a stejný
// tvar má i detail úkolu: kdo se naučil jeden, umí i druhý. Tři stavy,
// aby bylo na první pohled jasné, co platí: prázdný (tichý, jen nabízí),
// vyplněný (akcentní, ukazuje hodnotu) a otevřený (plný akcent — patří
// k němu panel s výběrem).

export const pill =
  'shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-transform duration-150 active:scale-95'
// Jeden tvar pro celou stavovou řádku — sloty i to, co vyčetl parser.
// py-1.5 drží slot na 32 px — hlavní ovládání zadávání se musí trefovat
// palcem na první pokus.
export const slotBase =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium'

// Slot stavu úkolu. Tři stavy, aby bylo na první pohled jasné, co platí:
// prázdný (tichý, jen nabízí), vyplněný (akcentní, ukazuje hodnotu)
// a otevřený (plný akcent — patří k němu panel nad polem).
export function SlotChip({
  slot,
  label,
  value,
  dot,
  open,
  onTap,
  icon,
}: {
  slot: string
  label: string
  value?: string
  dot?: string
  open: boolean
  onTap: () => void
  icon: React.ReactNode
}) {
  const tone = open
    ? 'bg-accent text-card'
    : value
      ? 'bg-accent-wash text-accent-deep'
      : 'bg-well/60 text-ink-soft'
  return (
    <button
      type="button"
      data-slot={slot}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onTap}
      aria-label={value ? `${label}: ${value}` : label}
      aria-pressed={open}
      className={`${slotBase} ${tone} transition-[background-color,color,transform] duration-150 active:scale-95`}
    >
      {dot ? (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
      ) : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      )}
      <span className="max-w-32 truncate">{value ?? label}</span>
    </button>
  )
}
