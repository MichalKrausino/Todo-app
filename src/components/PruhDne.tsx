// Pruh dne — jediný opravdu vlastní obrázek, který appka má: délka je čas,
// barvy jsou klienti, šedý díl jsou schůzky a práce bez klienta. Kreslí se
// v Plánu u každého dne a na Dnes pod hlavičkou; obojí musí vypadat stejně,
// proto je to jedna komponenta a ne dvakrát týž kus JSX.
//
// Prázdný pruh není prázdné místo, ale tichá kolej — graf s nulou má pořád
// osu. Díly narostou zleva (`.pruh-roste`), v klidovém režimu stojí.
//
// Neutrální díl (schůzka, práce bez klienta) je `edge`, ne `ink-faint`:
// `ink-faint` je barva textu a na pruhu, který může zabrat celou šířku,
// z něj byla černá lišta — na Dnes hned pod titulkem nejhlasitější prvek
// obrazovky. Barevná je práce pro klienta, všechno ostatní je podklad.
import { PLNY_DEN_MIN, minutyDilu, type Dil } from '../lib/pruhDne'
import { jePreplneno } from '../lib/kapacitaDne'

export function PruhDne({
  dily,
  klid,
  className = 'h-2.5',
  znackaPreteceni = true,
  strop,
}: {
  dily: Dil[]
  klid: boolean
  /** výška a cokoli navíc — v Plánu h-2.5, na Dnes tenčí */
  className?: string
  /**
   * Značka useknuté osy na konci. V pruhu přes celou šířku je to pětipixelový
   * proužek z ~350, tedy přesně tak tichá, jak má být. V buňce mřížky je pruh
   * 28 px široký a týž proužek z něj zabere pětinu — změřeno na snímku ve
   * čtyřnásobném zvětšení a čte se jako DALŠÍ KLIENT, ne jako „useknuto".
   * Mřížka proto přetečení říká barvou čísla dne a značku si vypíná.
   */
  znackaPreteceni?: boolean
  /** strop dne v minutách; bez něj platí pracovní doba (viz kapacitaDne.ts) */
  strop?: number
}) {
  const celkem = minutyDilu(dily)
  // Přetečený den se stlačí na celý pruh — délka je čas a delší než den
  // být nemůže. Že přetekl, proto musí říct ZNAČKA NA KONCI: pod agendou
  // je pod pruhem popisek, ale v mřížce Plánu žádný není, takže tam
  // vypadal den s osmi hodinami a den s třinácti úplně stejně — a mřížka
  // je přitom to jediné místo, kde se den vybírá. Je to tentýž způsob,
  // jakým se v grafu značí sloupec useknutý osou.
  const preplneno = jePreplneno(celkem, strop) && znackaPreteceni
  // Celý pruh = STROP DNE, ne nominálních osm hodin. Jinak by pruh a
  // verdikt nad ním říkaly každý něco jiného: den se třemi hodinami by
  // vypadal ze čtvrtiny plný a přitom by byl u konce toho, co tímhle
  // člověkem za den projde.
  const zaklad = Math.max(celkem, strop ?? PLNY_DEN_MIN)
  return (
    <span
      className={`relative flex w-full gap-px overflow-hidden ${preplneno ? 'rounded-l-full' : 'rounded-full'} ${celkem > 0 ? 'bg-well' : 'bg-well/60'} ${className}`}
    >
      {dily.map((dil, i) => (
        <span
          key={i}
          className={`h-full ${dil.barva ? '' : 'bg-edge'} ${klid ? '' : 'pruh-roste'}`}
          style={{
            // pod 2 % by díl zmizel úplně — čtvrthodina je pořád vidět
            width: `${Math.max(2, (dil.minuty / zaklad) * 100)}%`,
            background: dil.barva,
            animationDelay: klid ? undefined : `${i * 60}ms`,
          }}
        />
      ))}
      {preplneno && (
        // Vlasová mezera v barvě stránky před značkou: bez ní vypadal
        // proužek na konci jako další klient, ne jako useknutá osa.
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-[5px] border-l border-paper bg-note-ink"
        />
      )}
    </span>
  )
}
