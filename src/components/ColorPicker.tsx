// Výběr barvy klienta — jedna posuvná řádka, ne mřížka.
//
// Barva klienta je štítek, ne rozhodnutí: appka sama nabídne první volnou
// (`firstFreeColor`) a měnit ji má smysl teprve ve chvíli, kdy klient stojí
// v seznamu vedle ostatních. Proto se při zakládání neptá — je schovaná pod
// tečkou u jména.
//
// Řádka schválně nezalamuje. Deset koleček se na 320 px do jedné řady
// nevejde a dvouřádková mřížka barevných puntíků byla ve formuláři to
// nejhlučnější místo, přestože jde o tu nejmenší věc na klientovi.
// Přetéká k okraji zápornou marží, aby prstenec vybrané barvy nebyl
// oříznutý a poslední barva se dala dorolovat až ke kraji.

import { CLIENT_COLORS, COLOR_NAMES } from '../lib/labels'

export function ColorPicker({
  value,
  onPick,
}: {
  value: string | undefined
  onPick: (color: string) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Barva klienta"
      className="rise -mx-1 flex gap-1.5 overflow-x-auto px-1 py-1"
      style={{ scrollbarWidth: 'none' }}
    >
      {CLIENT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_NAMES[c]}
          onClick={() => onPick(c)}
          className={`h-8 w-8 shrink-0 rounded-full transition-transform duration-150 active:scale-90 ${
            value === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-card' : ''
          }`}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}
