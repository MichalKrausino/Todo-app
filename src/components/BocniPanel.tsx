// Navigace na Macu: sloupec vlevo místo plovoucího doku.
//
// PROČ NE DOK
//
// Dok je nejpropracovanější kus téhle appky (čočka, odlesk, tři fáze
// přepnutí) a na telefonu zůstává. Na Macu ale řeší problém, který tam
// není: palec dosáhne dolů, kurzor ne — a hlavně dok stojí NAD obsahem,
// protože na 390 px není kam ho dát. Na 1440 px místo je, takže
// navigace může být vidět pořád a vedle obsahu, ne přes něj.
//
// A co je důležitější: v doku jsou tři sloty po 64 px a čtvrtý by rozbil
// soustřednou kapsli — proto je „Vše" jen druhá poloha Dneška, kterou
// otevře dvojité ťuknutí. Tady ten důvod neplatí: **v sloupci má Vše
// vlastní řádek**, protože skryté gesto je na Macu horší než položka,
// kterou je vidět. Gesto (dvakrát „1") dál funguje, jen už není jediná
// cesta.
//
// Vybraná položka se značí touž inkoustovou pilulkou jako přepínače
// uvnitř appky (`AnimatedBackground`) — ne vlastním vzorem: appka má
// jeden způsob, jak říct „tohle je vybrané".

import { AnimatedBackground } from './ui/AnimatedBackground'

export type BocniId = 'today' | 'vse' | 'upcoming' | 'clients'

export const BOCNI_SIRKA = 232

export function BocniPanel({
  value,
  onVyber,
  onNovy,
  polozky,
  patka,
}: {
  value: BocniId
  onVyber: (id: BocniId) => void
  onNovy: () => void
  polozky: Array<{ id: BocniId; label: string; icon: React.ReactNode }>
  /** Hledání a stav synchronizace — dole, kde je v Mac appkách zvykem. */
  patka: React.ReactNode
}) {
  return (
    <nav
      aria-label="Hlavní navigace"
      className="flex shrink-0 flex-col gap-1 border-r border-line bg-well/40 px-3 pb-3"
      style={{ width: BOCNI_SIRKA, paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
    >
      {/* Zadávání je na Macu jedno tlačítko a klávesa N, ne rozvíjející
          se kapsle: dok se rozvinout musel, protože zabíral řádek nad
          klávesnicí. Tady má pole celý prostřední sloupec. */}
      <button
        onClick={onNovy}
        className="mb-2 flex h-10 items-center gap-2 rounded-xl bg-accent px-3 text-left text-[14px] font-medium text-white transition-transform duration-150 active:scale-[0.98]"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Nový úkol
      </button>

      <div className="flex flex-col gap-0.5">
        <AnimatedBackground
          value={value}
          onValueChange={(id) => id && onVyber(id as BocniId)}
          className="rounded-xl bg-card shadow-card"
        >
          {polozky.map((p) => (
            <button
              key={p.id}
              data-id={p.id}
              className="flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[14px] font-medium text-ink-soft transition-colors duration-150 data-[checked=true]:text-ink"
            >
              <span className="h-[18px] w-[18px] shrink-0">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </AnimatedBackground>
      </div>

      <div className="mt-auto flex items-center gap-1 pt-3">{patka}</div>
    </nav>
  )
}
