// Měsíc jako mřížka — klasický kalendář: sedm sloupců, týden od pondělí,
// listuje se po měsících.
//
// Kreslí se TOUŽE řečí jako kalendářík u zadávání (`MonthPicker`), protože
// dva různě vypadající kalendáře v jedné appce jsou dva jazyky: jediná
// plná výplň je VYBRANÝ den, dnešek má kroužek, a co na dni stojí, je
// vidět pod číslem. Rozdíl je jen v té značce pod číslem — tady je to
// pruh dne v barvách klientů, ne semaforová tečka, protože Plán se ptá
// „kolik toho ten den je a komu to patří", ne „je tam něco?".
//
// Prázdný den značku nedostane. Na řádku (kde byl pruh přes celou šířku)
// platilo „graf s nulou má pořád osu" a prázdný den měl tichou kolej;
// v mřížce by z třiceti kolejí byla šedá tapeta a značka by přestala
// znamenat cokoli. Tady je osou sama mřížka.

import { PruhDne } from './PruhDne'
import { fromISODate } from '../lib/dates'
import { dnuVMesici, odsazeniMesice } from '../lib/mesic'
import type { Dil } from '../lib/pruhDne'

const DNY_ZKRATKY = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']

export interface DenZnacka {
  dily: Dil[]
  popis: string
  /** na ten den je víc práce, než se do něj vejde */
  preplneno?: boolean
}

export function MesicniMrizka({
  kotva,
  dnes,
  vybrany,
  znacky,
  klid,
  strop,
  onVyber,
}: {
  /** „2026-09" */
  kotva: string
  dnes: string
  vybrany: string
  /** co na kterém dni stojí; dny bez záznamu jsou volné */
  znacky: Map<string, DenZnacka>
  klid: boolean
  /**
   * Osobní strop dne v úkolech. Proti němu se kreslí délka pruhu —
   * a musí to být TÝŽ strop, proti jakému se kreslí pruh vybraného dne
   * pod mřížkou. Kdyby si každý bral svůj, měla by jedna obrazovka dvě
   * měřítka a den by v mřížce vypadal jinak plný než hned pod ní.
   */
  strop?: number
  onVyber: (iso: string) => void
}) {
  const odsazeni = odsazeniMesice(kotva)
  const pocet = dnuVMesici(kotva)

  return (
    <ul key={kotva} className="grid grid-cols-7 gap-y-1 text-center">
      {DNY_ZKRATKY.map((d) => (
        <li key={d} className="pb-1 text-[12px] font-medium text-ink-faint">
          {d}
        </li>
      ))}
      {Array.from({ length: odsazeni }).map((_, i) => (
        <li key={`pred${i}`} aria-hidden="true" />
      ))}
      {Array.from({ length: pocet }, (_, i) => {
        const iso = `${kotva}-${String(i + 1).padStart(2, '0')}`
        const znacka = znacky.get(iso)
        const vybrano = iso === vybrany
        const jeDnes = iso === dnes
        const minulost = iso < dnes
        const vikend = [0, 6].includes(fromISODate(iso).getDay())
        // Přeplněný den nese svou zprávu ČÍSLEM, ne pruhem. Pruh v buňce
        // je 28 px a přes svůj základ se natáhnout nemůže, takže den se
        // čtyřmi a den s deseti úkoly kreslí totéž — plno. Mřížka je
        // přitom jediné místo, kde se den vybírá, takže to tam musí být
        // vidět. Výběr a dnešek zůstávají
        // nad tím: kde zrovna stojím, je vždycky důležitější než jak je
        // tam nabito.
        const cislo = vybrano
          ? 'bg-accent font-semibold text-card'
          : jeDnes
            ? 'font-semibold text-accent-deep ring-1 ring-accent'
            : minulost
              ? 'text-ink-faint'
              : znacka?.preplneno
                ? 'font-semibold text-note-ink'
                : vikend
                  ? 'text-ink-soft'
                  : 'text-ink'
        return (
          <li key={iso}>
            <button
              type="button"
              data-day={iso}
              aria-current={vybrano ? 'date' : undefined}
              onClick={() => onVyber(iso)}
              aria-label={`${i + 1}. ${kotva}${znacka ? `, ${znacka.popis}` : ', volno'}`}
              className="flex w-full flex-col items-center gap-1 py-1"
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-[15px] tabular-nums transition-colors duration-150 ${cislo}`}
              >
                {i + 1}
              </span>
              {/* Pevná výška i u prázdného dne — jinak by čísla v řádce
                  stála každé jinde podle toho, kdo má práci. */}
              <span className="block h-1 w-7">
                {znacka && (
                  <PruhDne dily={znacka.dily} klid={klid} strop={strop} className="h-1" />
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
