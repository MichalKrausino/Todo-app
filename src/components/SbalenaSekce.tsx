// Sekce, která se dá sbalit do jedné řádky s počtem.
//
// Obrazovka Dnes umí ukázat až jedenáct bloků najednou. Každý má důvod,
// ale dohromady na otázku „co teď?" neodpovídají — nabízejí jedenáct
// odpovědí. Co není dnešní práce (inbox, hotovo), proto stojí sbalené:
// je to vidět, je to na jedno klepnutí, a číslo v řádce říká pravdu.
//
// Rozbalení si appka pamatuje (localStorage, klíč jako u ostatních voleb
// zařízení: `todo.…`). Kdo si sekci otevře, nechce ji zítra hledat znovu.

import { useState } from 'react'
import { DisclosureContent } from './ui/Disclosure'

const KLIC = 'todo.dnes.rozbaleno'

const nacti = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(KLIC) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

const uloz = (ids: Set<string>) => {
  try {
    localStorage.setItem(KLIC, JSON.stringify([...ids]))
  } catch {
    /* soukromé okno bez úložiště — volba prostě nepřežije zavření */
  }
}

export function SbalenaSekce({
  id,
  popisek,
  pocet,
  className = '',
  style,
  children,
}: {
  id: string
  popisek: string
  pocet: number
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const [otevreno, setOtevreno] = useState(() => nacti().has(id))

  const prepni = () => {
    const ids = nacti()
    if (otevreno) ids.delete(id)
    else ids.add(id)
    uloz(ids)
    setOtevreno(!otevreno)
  }

  return (
    <section className={className} style={style}>
      {/* py-2: pod třicet pixelů se řádka na telefonu trefuje mizerně. */}
      <button
        onClick={prepni}
        aria-expanded={otevreno}
        className="-my-1 flex w-full items-center justify-between gap-2 py-2 text-left"
      >
        <span className="section-label">
          {popisek} · {pocet}
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 text-ink-faint/70 transition-transform duration-200 ${otevreno ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {/* Disclosure (motion-primitives): obsah se rozbalí na výšku, ne skokem */}
      <DisclosureContent open={otevreno}>
        <div className="pt-1.5">{children}</div>
      </DisclosureContent>
    </section>
  )
}
