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

export function PruhDne({
  dily,
  klid,
  className = 'h-2.5',
}: {
  dily: Dil[]
  klid: boolean
  /** výška a cokoli navíc — v Plánu h-2.5, na Dnes tenčí */
  className?: string
}) {
  const celkem = minutyDilu(dily)
  // Přetečený den se stlačí na celý pruh; že přetekl, řekne popisek.
  const zaklad = Math.max(celkem, PLNY_DEN_MIN)
  return (
    <span
      className={`flex w-full gap-px overflow-hidden rounded-full ${celkem > 0 ? 'bg-well' : 'bg-well/60'} ${className}`}
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
    </span>
  )
}
