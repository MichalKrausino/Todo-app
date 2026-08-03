// Galerie startovacích šablon — hotové balíčky pravidelné péče, jak je
// zná markeťák spravující víc klientů. Přidáním vzniká normální šablona
// (s čerstvými id položek), takže se dá libovolně upravit.

import type { Priority } from '../db/types'

export interface GalleryItem {
  title: string
  recurrenceRule: string
  priority: Priority
  defaultProjectName?: string
}

export interface GalleryPack {
  name: string
  description: string
  items: GalleryItem[]
}

export const TEMPLATE_GALLERY: GalleryPack[] = [
  {
    name: 'Správa PPC',
    description: 'Kontroly výkonu, optimalizace a měsíční report',
    items: [
      { title: 'Kontrola výkonu kampaní', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TH', priority: 'normal', defaultProjectName: 'PPC' },
      { title: 'Optimalizace sestav a klíčových slov', recurrenceRule: 'FREQ=WEEKLY;BYDAY=WE', priority: 'normal', defaultProjectName: 'PPC' },
      { title: 'Měsíční report kampaní pro klienta', recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=5', priority: 'high', defaultProjectName: 'PPC' },
    ],
  },
  {
    name: 'Sociální sítě',
    description: 'Obsahový plán, publikace a vyhodnocení',
    items: [
      { title: 'Obsahový plán na příští týden', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO', priority: 'normal', defaultProjectName: 'Sociální sítě' },
      { title: 'Naplánovat posty na příští týden', recurrenceRule: 'FREQ=WEEKLY;BYDAY=TH', priority: 'normal', defaultProjectName: 'Sociální sítě' },
      { title: 'Měsíční vyhodnocení dosahů a engagementu', recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=28', priority: 'normal', defaultProjectName: 'Sociální sítě' },
    ],
  },
  {
    name: 'SEO péče',
    description: 'Pozice, obsah a pravidelný technický audit',
    items: [
      { title: 'Kontrola pozic a Search Console', recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU', priority: 'normal', defaultProjectName: 'SEO' },
      { title: 'Nový obsahový článek', recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=15', priority: 'normal', defaultProjectName: 'SEO' },
      { title: 'Technický audit webu', recurrenceRule: 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=10', priority: 'normal', defaultProjectName: 'SEO' },
    ],
  },
  {
    name: 'Klientský servis',
    description: 'Týdenní status a fakturace — ať se na nic nezapomene',
    items: [
      { title: 'Poslat klientovi týdenní status', recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR', priority: 'normal' },
      { title: 'Fakturace za uplynulý měsíc', recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=1', priority: 'high' },
    ],
  },
  {
    name: 'Údržba webu',
    description: 'Aktualizace, zálohy a kontrola dostupnosti',
    items: [
      { title: 'Aktualizace pluginů a záloha webu', recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=20', priority: 'normal', defaultProjectName: 'Web' },
      { title: 'Kontrola rychlosti a dostupnosti webu', recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=8', priority: 'normal', defaultProjectName: 'Web' },
    ],
  },
]
