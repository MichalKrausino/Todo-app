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
