// „Ať jsou data pořád aktuální." Jeden plánovač pro všechny tři zdroje,
// který běží, dokud je appka v popředí a je signál (wifi i mobilní data).
//
// Proč vůbec: každý zdroj se dosud obnovoval jen při startu, při návratu
// do popředí a po zápisu. Appka nechaná otevřená hodinu ukazovala hodinu
// stará data. Tikání to řeší, aniž by cokoli tahalo zbytečně — každý
// zdroj má vlastní interval a vlastní pojistku.
//
// Na pozadí se netahá nic: iOS webovým appkám běh na pozadí nedává.
// Od toho jsou push notifikace (Fáze 6), ne polling.

import { maybeRefreshCalendar, refreshCalendar } from './calendar'
import { syncNow } from './engine'
import { isDue, wokeUp } from '../lib/freshness'
import { maybeRefreshTodoist, refreshTodoist } from './todoist'

const TICK_MS = 30_000
const SYNC_INTERVAL_MS = 60_000

let syncLastAt: number | undefined
let lastTickAt: number | undefined
let timer: ReturnType<typeof setInterval> | undefined

const online = () => navigator.onLine
const visible = () => document.visibilityState === 'visible'

// Vlastní data appky (Supabase) — nejlevnější a nejdůležitější, proto
// nejčastěji. Kalendář a Todoist si cadenci hlídají samy uvnitř.
async function tick(): Promise<void> {
  const now = Date.now()
  if (wokeUp(lastTickAt, now, TICK_MS)) {
    lastTickAt = now
    await refreshAll('probuzení')
    return
  }
  lastTickAt = now
  if (!online() || !visible()) return

  if (isDue({ lastAt: syncLastAt, now, intervalMs: SYNC_INTERVAL_MS, online: true, visible: true })) {
    syncLastAt = now
    await syncNow()
  }
  await maybeRefreshCalendar()
  await maybeRefreshTodoist()
}

// Okamžité stažení všeho — po návratu signálu, po přepnutí wifi ↔ data
// a po probuzení zařízení. Tady se pojistky obcházejí schválně: přesně
// v těchhle chvílích jsou data nejvíc zastaralá.
export async function refreshAll(reason: string): Promise<void> {
  if (!online()) return
  syncLastAt = Date.now()
  try {
    await syncNow()
    await refreshCalendar()
    await refreshTodoist(true)
  } catch (e) {
    console.warn(`obnova (${reason}):`, e instanceof Error ? e.message : e)
  }
}

export function initLive(): void {
  clearInterval(timer)
  lastTickAt = Date.now()
  timer = setInterval(() => void tick(), TICK_MS)

  // Návrat signálu — ať už jsem se vrátil na wifi, nebo chytil data.
  window.addEventListener('online', () => void refreshAll('online'))

  // Přepnutí typu připojení (wifi ↔ mobilní data). Safari to zatím
  // nemá, proto opatrně — na jiných prohlížečích to funguje.
  const conn = (navigator as Navigator & { connection?: EventTarget }).connection
  conn?.addEventListener('change', () => void refreshAll('změna sítě'))

  document.addEventListener('visibilitychange', () => {
    if (visible()) {
      lastTickAt = Date.now()
      void tick()
    }
  })
}

// Jen pro testy — plánovač jinak žije po celou dobu běhu appky.
export function stopLive(): void {
  clearInterval(timer)
  timer = undefined
  syncLastAt = undefined
  lastTickAt = undefined
}
