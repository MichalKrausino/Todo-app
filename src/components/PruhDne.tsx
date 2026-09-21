// Pruh dne — jediný opravdu vlastní obrázek, který appka má: délka je
// práce (jeden díl = jeden úkol), barvy jsou klienti, šedý díl jsou úkoly
// bez klienta. Kreslí se v Plánu u každého dne a na Dnes pod hlavičkou;
// obojí musí vypadat stejně, proto je to jedna komponenta a ne dvakrát
// týž kus JSX.
//
// Prázdný pruh není prázdné místo, ale tichá kolej — graf s nulou má pořád
// osu. Díly narostou zleva (`.pruh-roste`), v klidovém režimu stojí.
//
// Neutrální díl (práce bez klienta) je `edge`, ne `ink-faint`: `ink-faint`
// je barva textu a na pruhu, který může zabrat celou šířku, z něj byla
// černá lišta — na Dnes hned pod titulkem nejhlasitější prvek obrazovky.
// Barevná je práce pro klienta, všechno ostatní je podklad.
//
// PLNÝ PRUH = OSOBNÍ STROP
//
// Dřív byl základ osm hodin z odhadovaných minut, tedy číslo, které nikdo
// nespočítal (viz `../lib/pruhDne.ts`). Teď se pruh kreslí proti stropu
// z vlastní historie — kolik úkolů za den tímhle člověkem doopravdy
// projde. Plný pruh proto znamená totéž co verdikt nad ním, jen nakreslený;
// dvě různé představy o plném dni na jedné obrazovce byla vada, kvůli
// které tohle všechno vzniklo. Samotný pruh přesto nic netvrdí — „je toho
// moc" říká číslo dne v mřížce, řádka pod agendou a toast při zadávání.
import { ZAKLAD_BEZ_STROPU, ukolyVDilech, type Dil } from '../lib/pruhDne'

export function PruhDne({
  dily,
  klid,
  strop,
  className = 'h-2.5',
}: {
  dily: Dil[]
  klid: boolean
  /** osobní strop dne v úkolech; `undefined` = appka ho ještě nezná */
  strop?: number
  /** výška a cokoli navíc — v Plánu h-2.5, na Dnes tenčí */
  className?: string
}) {
  const celkem = ukolyVDilech(dily)
  // Přeplněný den se stlačí na celý pruh; že přetekl, řekne popisek.
  const zaklad = Math.max(celkem, strop ?? ZAKLAD_BEZ_STROPU)
  return (
    <span
      // Značka pro audit: ten měří POMĚR zaplnění (součet dílů proti šířce
      // pruhu), a musí umět najít pruh v buňce mřížky i ten pod agendou.
      // Že oba kreslí proti témuž stropu, se okem nepozná — v mřížce je
      // pruh 28 px široký.
      data-pruh=""
      className={`flex w-full gap-px overflow-hidden rounded-full ${celkem > 0 ? 'bg-well' : 'bg-well/60'} ${className}`}
    >
      {dily.map((dil, i) => (
        <span
          key={i}
          className={`h-full ${dil.barva ? '' : 'bg-edge'} ${klid ? '' : 'pruh-roste'}`}
          style={{
            // pod 2 % by díl zmizel úplně — jeden úkol je pořád vidět
            width: `${Math.max(2, (dil.pocet / zaklad) * 100)}%`,
            background: dil.barva,
            animationDelay: klid ? undefined : `${i * 60}ms`,
          }}
        />
      ))}
    </span>
  )
}
