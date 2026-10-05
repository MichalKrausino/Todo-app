// Hlídání ticha u klienta — kolik dní se u něj nic nestalo, když už to
// stojí za řeč. Ukazuje to stavová řádka klienta („ticho 45 dní",
// `clientStatus.ts`) a týž práh ctí ranní návrh na serveru
// (`prahHlidani` v `supabase/functions/morning-plan/pick.ts`).

import type { Client } from '../db/types'
import { daysSince } from './dates'

/**
 * Po kolika dnech ticha se ozve hlídání u klienta, který si vlastní práh
 * nenastavil. Je to TÁŽ čtrnáctka, kterou pole v nastavení klienta
 * odjakživa ukazuje jako `placeholder` — rozhraní ji slibovalo, jen ji
 * logika nedodala.
 */
export const HLIDANI_VYCHOZI_DNI = 14

/**
 * Kolik dní je u klienta ticho, když už stojí za řeč — jinak `null`.
 *
 * CHYBĚJÍCÍ NASTAVENÍ ZNAMENÁ VÝCHOZÍ STAV, NE VYPNUTO
 *
 * Tohle pravidlo má appka zapsané u ranních návrhů („nesmyslný čas taky
 * ne — notifikace, která tiše zmizí, je horší než notifikace ve špatnou
 * hodinu") a tady ho porušovala: hlídání zanedbaných klientů je jedna
 * z věcí, kvůli kterým appka vůbec vznikla, a **nešlo ho spustit jinak
 * než ručně u každého klienta zvlášť**. Bezpečnostní síť, kterou si
 * musíš u každého klienta zvlášť zapnout, není bezpečnostní síť.
 *
 * Změřeno na skutečných datech: `checkIntervalDays` nemá nastavený ANI
 * JEDEN z pěti klientů, takže hlídání nemohlo promluvit vůbec — zatímco
 * `lastActivityAt` se poctivě razítkuje u všech (založení i dokončení
 * úkolu). Appka to celou dobu věděla a mlčela: klient „Chcinadhled" byl
 * **45 dní bez jediné stopy** a bez jediného otevřeného úkolu.
 *
 * Čtrnáct dní není odhad — je to číslo, které pole v nastavení klienta
 * odjakživa ukazuje jako `placeholder`. Rozhraní ho slibovalo, logika
 * ne. Na jeho datech se ozve právě u toho jednoho klienta, který
 * doopravdy vypadl (45 dní), a mlčí u zbylých tří (12, 5 a 1 den) —
 * upozornění má zůstat vzácné a zasloužené.
 *
 * **Výchozí práh platí jen pro KLIENTA, ne pro oblast.** „Osobní"
 * a „Interní" jsou přihrádky na moji vlastní práci, ne vztah, který může
 * utichnout — nadávat mi, že jsem si čtrnáct dní nezaložil osobní úkol,
 * je hluk. Vlastní `checkIntervalDays` se naopak ctí u čehokoli: kdo si
 * ho nastavil, rozhodl se.
 */
export function neglectedDays(c: Client, today?: string): number | null {
  const prah = c.checkIntervalDays ?? (c.kind === 'client' ? HLIDANI_VYCHOZI_DNI : undefined)
  if (!prah || !c.lastActivityAt) return null
  const days = daysSince(c.lastActivityAt, today)
  return days > prah ? days : null
}
