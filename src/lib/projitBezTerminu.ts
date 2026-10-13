// Které úkoly bez termínu přidat dnes do „Projít" — čistá logika s testy.
//
// PROČ TO VŮBEC JE
//
// Úkol bez termínu se sám nikde nepřipomene: na Dnes nepatří, v Plánu leží
// pod chipem a „Projít" bralo jen propadlé. Jediné místo, kde se ozval
// sám od sebe, byl ranní návrh — a ten se na skutečných datech skoro
// nečte: za posledních dvacet rán byl panel otevřený DVAKRÁT. Úkol
// „Dát přístup na Google disk se soubory" (Domča) tak ležel sedmnáct dní
// bez termínu a nikde se neukázal ani jednou; ranní návrh ho nenabídl
// nikdy, protože bez odpovědí se nabídka netočí a nahoře stály pořád
// tytéž starší úkoly (jeden z nich 17×).
//
// „Projít" je přitom to, co člověk opravdu dělá — rozhoduje tam po jednom,
// kam s čím. Tak ať tam chodí i práce bez dne, ne jen ta propadlá.
//
// PRAVIDLA
//
// 1. Úkol bez termínu i bez naplánování, otevřený, můj (to hlídá volající —
//    sem chodí už jen moje úkoly z Dnes).
// 2. Založený PŘED dneškem: co jsem zapsal před hodinou, nemusím hned
//    znovu rozhodovat. Druhý den ráno se ale ozve, ať nezapadne.
// 3. Prošel jsem ho a nechal bez termínu (`prohlednuto`)? Pak má
//    `PAUZA_DNI` pokoj. Jinak by se týž seznam vracel každé ráno a z
//    průchodu by byla zeď, kterou se naučím odklikávat naslepo.
// 4. Odpočívá z ranního návrhu („Volnější den", druhé „Dnes ne")? Pak se
//    neozve před dnem, který mu appka slíbila — dva hlasy, z nichž jeden
//    říká „až v pátek" a druhý „teď", jsou appka, která si protiřečí.
// 5. Nejvýš `NA_DEN` za den, nejdůležitější a nejdéle neviděné první.
//    Zbytek přijde zítra — průchod má trvat minutu, ne půl hodiny.

import type { Priority, Task } from '../db/types'
import { daysSince } from './dates'

/** Kolik dní má pokoj úkol, který jsem prošel a nechal bez termínu. */
export const PAUZA_DNI = 7
/** Kolik úkolů bez termínu se do „Projít" přidá za jeden den. */
export const NA_DEN = 5

const VAHA: Record<Priority, number> = { critical: 3, high: 2, normal: 1, low: 0 }

/** Den, od kterého se počítá, jak dlouho úkol nikdo neviděl. */
const naposledy = (t: Task): string => t.prohlednuto ?? t.createdAt

export function jeBezTerminu(t: Pick<Task, 'dueDate' | 'scheduledFor'>): boolean {
  return !t.dueDate && !t.scheduledFor
}

export function bezTerminuKProjiti(
  ukoly: readonly Task[],
  dnes: string,
  odpociva: ReadonlyMap<string, string> = new Map(),
): Task[] {
  return ukoly
    .filter((t) => {
      if (t.deletedAt || (t.status !== 'active' && t.status !== 'inbox')) return false
      if (!jeBezTerminu(t) || t.pinnedFor === dnes) return false
      if (daysSince(t.createdAt, dnes) < 1) return false
      if (t.prohlednuto && daysSince(t.prohlednuto, dnes) < PAUZA_DNI) return false
      const doKdy = odpociva.get(t.id)
      return !(doKdy && doKdy > dnes)
    })
    .sort(
      (a, b) =>
        (VAHA[b.priority] ?? 1) - (VAHA[a.priority] ?? 1) ||
        daysSince(naposledy(b), dnes) - daysSince(naposledy(a), dnes) ||
        a.createdAt.localeCompare(b.createdAt),
    )
    .slice(0, NA_DEN)
}
