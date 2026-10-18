// Šabat — od pátečního západu slunce do sobotního. Čistá logika s testy.
//
// Michal je věřící a v tu dobu nepracuje. Tohle je pevné pravidlo, ne
// nastavení: appka ho má znát sama, ne čekat, až si ho někdo zapne.
// Plyne z něj, že v té době appka nepípá (server), na sobotu do večera
// nic nenabízí a ve dnech pátek a sobota říká, kdy klid začíná a končí.
//
// Západ slunce se počítá pro Prahu, vzorcem pro východ a západ slunce
// (NOAA, ve tvaru „sunrise equation"): přesnost je na pár minut, což je
// přesně „zhruba" — pravidlo je „večer po západu slunce", ne astronomická
// tabulka. Vedle hodnot z tabulek pro Prahu sedí do tří minut (viz testy).
//
// Funkce berou KALENDÁŘNÍ DEN (`YYYY-MM-DD`) a OKAMŽIK (ms od epochy),
// nikdy `new Date()` uvnitř — appka v telefonu žije v pražském čase, server
// v UTC, a obě strany pak dostanou stejnou odpověď. Čas pro člověka
// (`casPraha`) se formátuje vždy v pásmu Europe/Prague.
//
// Soubor používá edge funkce `reminders` (ticho během šabatu, páteční
// uzávěrka před západem) a dováží ho appka (`src/lib/sabat.ts`), takže
// obě strany počítají tentýž západ. Ranní návrh (`morning-plan`) ho
// nepotřebuje: jeho okno (3–11 UTC) v sobotu vždycky padne do šabatu,
// a tak ho v sobotu nebudí ani cron (`supabase/sabat.sql`).

export const PRAHA = { sirka: 50.0755, delka: 14.4378 }

const RAD = Math.PI / 180
const sin = (deg: number) => Math.sin(deg * RAD)
const cos = (deg: number) => Math.cos(deg * RAD)

/** Den v týdnu pro `YYYY-MM-DD` — 0 neděle … 5 pátek, 6 sobota. */
export function denVTydnu(den: string): number {
  const [y, m, d] = den.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

/** Posun kalendářního dne o `n` dní (bez časových pásem). */
export function posunDen(den: string, n: number): string {
  const [y, m, d] = den.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10)
}

/**
 * Okamžik západu slunce v daný den (ms od epochy).
 *
 * `n` je počet dní od poledne 1. 1. 2000 do poledne toho dne. Pozor na
 * výchozí juliánské datum: počítá se z PŮLNOCI UTC (končí na ,5),
 * jinak `ceil` přeskočí na další den a západ vyjde o den později.
 */
export function zapadSlunce(den: string, misto = PRAHA): number {
  const [y, m, d] = den.split('-').map(Number)
  const jd = Date.UTC(y, m - 1, d) / 86_400_000 + 2_440_587.5
  const n = Math.ceil(jd - 2_451_545 + 0.0008)
  const jHvezdne = n - misto.delka / 360
  const M = (357.5291 + 0.98560028 * jHvezdne) % 360
  const C = 1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)
  const lambda = (M + C + 180 + 102.9372) % 360
  const jPoledne = 2_451_545 + jHvezdne + 0.0053 * sin(M) - 0.0069 * sin(2 * lambda)
  const sinD = sin(lambda) * sin(23.4397)
  const cosD = Math.sqrt(1 - sinD * sinD)
  const cosW = (sin(-0.833) - sin(misto.sirka) * sinD) / (cos(misto.sirka) * cosD)
  const w = Math.acos(Math.min(1, Math.max(-1, cosW))) / RAD
  return Math.round((jPoledne + w / 360 - 2_440_587.5) * 86_400_000)
}

/**
 * Šabat, do kterého den zasahuje: pátek i sobota vrátí totéž okno (západ
 * v pátek → západ v sobotu), ostatní dny `null`.
 */
export function oknoSabatu(den: string): { od: number; do: number } | null {
  const dt = denVTydnu(den)
  if (dt !== 5 && dt !== 6) return null
  const patek = dt === 5 ? den : posunDen(den, -1)
  return { od: zapadSlunce(patek), do: zapadSlunce(posunDen(patek, 1)) }
}

/** Je v okamžiku `ted` šabat? `den` je kalendářní den toho okamžiku v Praze. */
export function jeSabat(den: string, ted: number): boolean {
  const okno = oknoSabatu(den)
  return okno !== null && ted >= okno.od && ted < okno.do
}

/** „17:58" — čas okamžiku v Praze. */
export function casPraha(ms: number): string {
  return new Date(ms).toLocaleTimeString('cs-CZ', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Minuty od půlnoci v Praze pro okamžik `ms`. */
export function minutyPraha(ms: number): number {
  const [h, m] = casPraha(ms).split(':').map(Number)
  return h * 60 + m
}

/**
 * Krátká věta k pátku a sobotě; ostatní dny `null`.
 *
 * Bez `ted` (den, na který se teprve díváš) mluví o celém dni; s ním
 * (dnešek) o tom, co platí právě teď. Po sobotním západu už je po všem
 * a věta mlčí — sobotní večer je obyčejný pracovní večer.
 */
export function vetaSabatu(den: string, ted?: number): string | null {
  const okno = oknoSabatu(den)
  if (!okno) return null
  const patek = denVTydnu(den) === 5
  if (ted !== undefined && ted >= okno.do) return null
  if (patek) {
    if (ted !== undefined && ted >= okno.od) return `šabat · do zítřka ${casPraha(okno.do)}`
    return `od ${casPraha(okno.od)} šabat`
  }
  return `šabat · práce až po ${casPraha(okno.do)}`
}

/**
 * Krátká poznámka k sobotě („šabat do 17:58") — pod tlačítko nebo do
 * toastu, kde se vybírá den. Jiné dny `null`.
 */
export function poznamkaKSobote(den: string): string | null {
  return denVTydnu(den) === 6 ? `šabat do ${casPraha(zapadSlunce(den))}` : null
}

/**
 * Kdy na Dnes nabídnout večerní uzávěrku (minuty od půlnoci).
 *
 * Běžně od 16:00. V pátek nejpozději hodinu a půl před západem slunce —
 * v zimě zapadá kolem čtvrté, a uzávěrka, která přijde až po začátku
 * šabatu, by přišla pozdě.
 */
export function zacatekUzaverky(den: string): number {
  const bezne = 16 * 60
  if (denVTydnu(den) !== 5) return bezne
  return Math.min(bezne, minutyPraha(zapadSlunce(den)) - 90)
}

/**
 * Do kdy se v pátek smí pracovat (minuty od půlnoci) — pro volno mezi
 * schůzkami. Jiné dny `undefined`, pracovní doba platí beze změny.
 */
export function konecPracePatek(den: string): number | undefined {
  return denVTydnu(den) === 5 ? minutyPraha(zapadSlunce(den)) : undefined
}

/**
 * Páteční uzávěrka ze serveru: okamžik, kdy má notifikace odejít.
 * Běžná doba (`bezne`), ale nejpozději hodinu před západem slunce.
 */
export function patecniUzaverka(den: string, bezne: number): number {
  return Math.min(bezne, zapadSlunce(den) - 60 * 60_000)
}
