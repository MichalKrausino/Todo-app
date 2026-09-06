import type { ClientKind, Priority } from '../db/types'

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Nízká',
  normal: 'Normální',
  high: 'Vysoká',
  critical: 'Kritická',
}

export const KIND_LABELS: Record<ClientKind, string> = {
  client: 'Klient',
  internal: 'Interní',
  personal: 'Osobní',
}

// Skloňování počtu v češtině: 1 → jednotné číslo, 2–4 → množné,
// 0 a 5 a víc → druhý pád. Nula se do „2–4" pletla a v appce z toho
// vycházelo „0 úkoly" — proto je pravidlo na jednom místě a otestované.
export const plural = (n: number, one: string, few: string, many: string): string => {
  const pocet = Math.abs(Math.round(n))
  if (pocet === 1) return one
  if (pocet >= 2 && pocet <= 4) return few
  return many
}

// Systémová paleta iOS — barvy štítků klientů.
export const CLIENT_COLORS = [
  '#FF3B30', // červená
  '#FF9500', // oranžová
  '#FFCC00', // žlutá
  '#34C759', // zelená
  '#00C7BE', // mátová
  '#30B0C7', // tyrkysová
  '#007AFF', // modrá
  '#5856D6', // indigo
  '#AF52DE', // fialová
  '#FF2D55', // růžová
]

// Pořadí, v jakém se barvy samy rozdávají. Není to pořadí palety: červená
// je v appce barva poplachu (propadlý termín), tak ji nedostane hned první
// klient — a sousední odstíny se střídají, aby se dvě tečky vedle sebe
// nepletly. Ručně jde pak vybrat cokoli.
const AUTO_ORDER = [6, 1, 3, 8, 5, 7, 9, 2, 4, 0].map((i) => CLIENT_COLORS[i])

// Barva klienta je štítek, podle kterého se pozná úkol v seznamu — tři
// klienti se stejnou modrou tečkou nerozliší nic. Nabídne se proto první
// nepoužitá; když už jsou všechny rozebrané, jede se dokola.
export function firstFreeColor(used: Array<string | undefined>): string {
  return (
    AUTO_ORDER.find((c) => !used.includes(c)) ?? AUTO_ORDER[used.length % AUTO_ORDER.length]
  )
}
