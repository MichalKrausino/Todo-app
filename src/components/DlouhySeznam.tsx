// Seznam, který se nevykreslí celý najednou.
//
// Měřeno na 1200 úkolech (reálná roční hromádka u pár klientů): obrazovka
// Dnes vykreslila 760 řádků a 9 000 uzlů, Plán 1 080 řádků — přepnutí
// obrazovky pak na pomalejším telefonu trvalo přes čtyři vteřiny. Čtení
// z databáze na tom má podíl 37 ms; celý zbytek je vykreslování řádků,
// které stejně nikdo nepřečte.
//
// Není to jen výkon. Zeď sedmi set propadlých úkolů je k neunesení i pro
// hlavu — appka má ukázat, co je před člověkem, ne archiv. Zbytek je na
// jedno klepnutí.

import { useState } from 'react'
import { plural } from '../lib/labels'

export function DlouhySeznam<T>({
  polozky,
  radek,
  davka = 25,
  className = 'divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card',
}: {
  polozky: T[]
  // Řádek si nese vlastní klíč (TaskRow ho má na sobě) — obal by tu byl
  // navíc jen kvůli tomu, aby ho zopakoval.
  radek: (p: T) => React.ReactNode
  davka?: number
  className?: string
}) {
  const [limit, setLimit] = useState(davka)
  const viditelne = polozky.slice(0, limit)
  const zbyva = polozky.length - viditelne.length

  return (
    <>
      <ul className={className}>{viditelne.map(radek)}</ul>
      {zbyva > 0 && (
        <button
          onClick={() => setLimit((l) => l + davka)}
          className="w-full py-2.5 text-center text-sm font-medium text-accent-deep transition-transform duration-150 active:scale-[0.98]"
        >
          {`Zobrazit ${Math.min(zbyva, davka)} ${plural(Math.min(zbyva, davka), 'další', 'další', 'dalších')}`}
          {zbyva > davka && ` (zbývá ${zbyva})`}
        </button>
      )}
    </>
  )
}
