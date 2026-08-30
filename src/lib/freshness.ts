// Kdy má která vrstva znovu sáhnout na síť. Čistá logika bez timerů,
// aby se dala otestovat — plánovač nad ní žije v src/sync/live.ts.

export interface FreshnessInput {
  lastAt?: number // kdy naposledy doběhlo (Date.now())
  now: number
  intervalMs: number
  online: boolean
  visible: boolean
}

// Bez signálu nemá smysl zkoušet cokoli; na pozadí (iOS appku uspí)
// taky ne — vrátíme se k tomu při návratu do popředí.
export function isDue({ lastAt, now, intervalMs, online, visible }: FreshnessInput): boolean {
  if (!online || !visible) return false
  if (lastAt === undefined) return true
  return now - lastAt >= intervalMs
}

// Když mezi dvěma tiky uplynulo mnohem víc času, než mělo, zařízení
// spalo (zamčený telefon, uspaný MacBook). Data jsou po probuzení stará,
// tak se neptáme na intervaly a taháme hned.
export function wokeUp(lastTickAt: number | undefined, now: number, tickMs: number): boolean {
  if (lastTickAt === undefined) return false
  return now - lastTickAt > tickMs * 3
}
