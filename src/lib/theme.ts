// Vzhled: světlý, tmavý, nebo podle systému.
//
// Zdrojem pravdy pro CSS je atribut `data-theme` na <html> — v index.css
// není jediný `prefers-color-scheme` dotaz. „Podle systému" se překládá
// na konkrétní hodnotu tady, takže tmavá paleta zůstává na jednom místě
// a nová barva se nemusí psát dvakrát.
//
// Volba je čistě lokální (localStorage), nesynchronizuje se: na MacBooku
// můžu chtít světlý režim a na iPhonu tmavý.

export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'todo.theme'

// Musí sedět s tokeny --color-paper v src/index.css, jinak stavový řádek
// na iPhonu nesedí s pozadím appky.
const PAPER = { light: '#f6f6f4', dark: '#0e0e11' }

const subs = new Set<() => void>()
let choice: ThemeChoice = read()

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

const systemIsDark = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

export const getThemeChoice = (): ThemeChoice => choice

// Co se opravdu vykresluje — „system" už rozhodnuté.
export const resolvedTheme = (): 'light' | 'dark' =>
  choice === 'system' ? (systemIsDark() ? 'dark' : 'light') : choice

export function subscribeTheme(fn: () => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}

function apply(): void {
  const t = resolvedTheme()
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PAPER[t])
  subs.forEach((fn) => fn())
}

export function setThemeChoice(next: ThemeChoice): void {
  choice = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // soukromé okno — volba vydrží aspoň do zavření appky
  }
  apply()
}

export function initTheme(): void {
  apply()
  // Když jedu podle systému, musím na jeho přepnutí zareagovat i za běhu
  // (iPhone přepíná tmavý režim podle času sám).
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (choice === 'system') apply()
  })
}
