// Živá data — když kolega odškrtne úkol, uvidíš to hned.
//
// PROČ TO VŮBEC JE
//
// Zápis se odesílá po 2,5 s a druhé zařízení se na změny ptalo jednou za
// minutu (plánovač v live.ts). Odškrtnutí u kolegy tak mohlo být vidět
// až za minutu — u společné práce to nevypadá jako pomalý sync, ale jako
// rozbitá appka: „odškrtl jsem to, a on to pořád vidí nehotové."
//
// UDÁLOST JE ŤUKNUTÍ, NE DATA
//
// Realtime se tu NEPOUŽÍVÁ jako druhý zdroj dat. Přijde-li událost,
// spustí se obyčejný sync a data si přitečou stávající cestou
// pull → Dexie → UI. Vypadá to jako oklika, ale jsou za tím dva důvody:
//
//  1. Nevzniká druhá cesta, na které by se dalo rozejít s LWW a tombstony.
//     Architektonické pravidlo „nestaví se druhý synchronizační kanál"
//     platí i tady — realtime je urychlovač, ne kanál.
//  2. Na obsahu události nezáleží, takže z ní nemůže nic uniknout, ani
//     kdyby přišla událost o řádku, na který nemám právo. Appka si stejně
//     stáhne jen to, co jí server dá.
//
// A plyne z toho i třetí vlastnost zadarmo: když spojení spadne nebo
// realtime vůbec nefunguje, appka se chová jako dřív — plánovač po minutě
// je pořád pod tím. Není to bod, na kterém by se dalo selhat úplně.

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { syncNow } from './engine'

// Jedna změna u kolegy = jedna událost za tabulku. Odškrtnutí úkolu ale
// sáhne i na klienta (lastActivityAt), takže přijdou dvě těsně za sebou —
// a hromadná úprava jich pošle klidně padesát. Krátké sečkání z nich
// udělá jeden průchod; slučování běhů (koalescence.ts) je pod tím jako
// druhá pojistka.
const SECKANI_MS = 400

let kanal: RealtimeChannel | null = null
let timer: ReturnType<typeof setTimeout> | undefined

function tuklo(): void {
  clearTimeout(timer)
  // Pouhý spouštěč, ne zápis: připojí se k běžícímu průchodu místo aby si
  // vynutil druhý (viz `zZapisu` v engine.ts).
  timer = setTimeout(() => void syncNow().catch(() => {}), SECKANI_MS)
}

/**
 * Začne poslouchat změny. Volá se po přihlášení; opakované zavolání je
 * bez následků, takže se o to volající nemusí starat.
 */
export function startRealtime(sb: SupabaseClient): void {
  if (kanal) return
  kanal = sb
    .channel('zmeny')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, tuklo)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, tuklo)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, tuklo)
    .subscribe()
}

/** Přestane poslouchat — při odhlášení a při přepnutí účtu. */
export function stopRealtime(sb: SupabaseClient | null): void {
  clearTimeout(timer)
  if (!kanal) return
  const k = kanal
  kanal = null
  void sb?.removeChannel(k)
}

/** Jen pro testy a diagnostiku: posloucháme právě teď? */
export const realtimeBezi = (): boolean => kanal !== null
