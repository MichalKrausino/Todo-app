// Detail úkolu: na telefonu panel zdola, na Macu sloupec vpravo.
//
// PROČ ZROVNA DETAIL A NE VŠECHNY PANELY
//
// Panel zdola je na telefonu správně: obrazovka je jedna a detail ji má
// překrýt. Na Macu je ale detail úkolu to jediné, co člověk otevírá
// SOUČASNĚ se seznamem — odškrtává, přepisuje termín, dívá se na další
// řádek. Panel by mu pod rukama zakryl přesně to, s čím pracuje.
//
// Ostatní panely (nastavení, triáž, klient, ohlédnutí) zůstávají modální
// i na Macu, protože jsou to úkony, které se dělají místo práce se
// seznamem, ne vedle ní. Sloupec by z nich udělal druhou obrazovku
// a appka by měla dvě různá „kde to jsem".
//
// Obal je stejný na obou stranách: `children` dostává `close()`, takže
// tlačítka uvnitř nevědí, jestli zavírají panel, nebo sloupec.

import { useEffect } from 'react'
import { Sheet, pripojNadPanel } from './Sheet'
import { useSiroko } from '../lib/siroko'

export function DetailObal({
  onClose,
  children,
}: {
  onClose: () => void
  children: (close: () => void) => React.ReactNode
}) {
  const siroko = useSiroko()
  // Escape zavírá i sloupec — a hlásí se kvůli tomu do TÉHOŽ zásobníku
  // jako panely (`pripojNadPanel`). Sloupec panel není, ale pro klávesy
  // je to táž věc: leží nad appkou, takže jí klávesy nepatří.
  //
  // Bez zásobníku se o Escape prali dva posluchače na `window`: zkratky
  // v `App.tsx` ho při otevřeném zadávání berou jako „zavři zadávání".
  // Změřeno auditem chování — s otevřeným zadáváním první Escape sloupec
  // nezavřel, teprve druhý. Klávesa, která dělá něco jiného podle toho,
  // co je zrovna otevřené, je horší než klávesa, která nedělá nic.
  useEffect(() => {
    if (!siroko) return
    const misto = pripojNadPanel()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && misto.navrchu()) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      misto.odpojit()
    }
  }, [siroko, onClose])

  if (!siroko) {
    return (
      <Sheet onClose={onClose} className="space-y-4">
        {children}
      </Sheet>
    )
  }

  return (
    <aside
      aria-label="Detail úkolu"
      className="flex w-[420px] shrink-0 flex-col overflow-y-auto overscroll-none border-l border-line bg-card px-4 pb-6"
      style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
    >
      <div className="space-y-4">{children(onClose)}</div>
    </aside>
  )
}
