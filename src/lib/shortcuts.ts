// Klávesové zkratky pro Mac (appka běží i na MacBooku). Čistá logika:
// z události udělá pojmenovanou akci, nebo nic. Pravidla:
//  - ⌘K / Ctrl+K hledá vždycky, i uprostřed psaní — tak to dělá každý
//    editor a člověk to má v prstech;
//  - jednopísmenné zkratky (n, /, 1–3) jen mimo pole — jinak by se
//    „n" v názvu úkolu vyložilo jako „nový úkol";
//  - s otevřeným panelem nic: panel má vlastní Escape a klávesy patří jemu.

export type Zkratka = 'hledat' | 'novy' | 'dnes' | 'plan' | 'klienti' | 'zavrit'

export interface Klavesa {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export interface Kontext {
  /** kurzor stojí v poli (input, textarea, contenteditable) */
  piseSe: boolean
  /** nad appkou leží panel (detail, hledání, nastavení…) */
  panel: boolean
  /** zadávání v doku je rozbalené */
  zadavani: boolean
}

export function zkratkaZKlavesy(k: Klavesa, ctx: Kontext): Zkratka | null {
  if (ctx.panel) return null
  const modifikator = k.metaKey || k.ctrlKey
  if (modifikator && !k.altKey && k.key.toLowerCase() === 'k') return 'hledat'
  if (k.key === 'Escape') return ctx.zadavani ? 'zavrit' : null
  if (ctx.piseSe || modifikator || k.altKey) return null
  switch (k.key) {
    case '/':
      return 'hledat'
    case 'n':
    case 'N':
      return 'novy'
    case '1':
      return 'dnes'
    case '2':
      return 'plan'
    case '3':
      return 'klienti'
    default:
      return null
  }
}

// Popisky pro nápovědu — ⌘ na Macu, Ctrl jinde.
export function jeMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')
}

export function zkratkyProNapovedu(mac = jeMac()): Array<{ klavesy: string; co: string }> {
  const mod = mac ? '⌘' : 'Ctrl'
  return [
    { klavesy: `${mod} K`, co: 'hledat' },
    { klavesy: 'N', co: 'nový úkol' },
    { klavesy: '1 · 2 · 3', co: 'Dnes · Plán · Klienti' },
    { klavesy: `${mod} ↩`, co: 'uložit detail úkolu' },
    { klavesy: 'Esc', co: 'zavřít panel nebo zadávání' },
  ]
}
