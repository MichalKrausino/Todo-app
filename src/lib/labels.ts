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

// Tlumené kvašové tóny, aby seděly na papírové pozadí.
export const CLIENT_COLORS = [
  '#a63d2f', // rez
  '#c1702c', // jantar
  '#a08526', // hořčice
  '#6b7a34', // oliva
  '#4c7a5c', // mech
  '#2f6d6a', // borovice
  '#41678f', // modř
  '#6f5aa0', // švestka
  '#9c4c74', // ostružina
  '#7a5c48', // umbra
]
