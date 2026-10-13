// Které úkoly bez termínu patří do „Projít" — čistá logika s testy.
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
// PRAVIDLA — VŠECHNY ÚKOLY BEZ TERMÍNU (Michalova volba)
//
// První verze jich brala nejvýš pět denně a zapsané dnes nechávala na
// zítřek, aby z průchodu nebyla zeď. Michal to chce obráceně: v „Projít"
// má být KAŽDÝ úkol bez termínu a on ho buď pošle na den, nebo nechá být.
// Výjimky jsou jen dvě a obě jsou rozhodnutí, které už udělal sám:
//
// 1. Prošel jsem ho a nechal bez termínu (`prohlednuto`)? Pak má
//    `PAUZA_DNI` pokoj a den návratu stojí pod tlačítkem. Bez toho by se
//    týž seznam vracel hned po zavření průchodu a odpověď by nic neznamenala.
// 2. Odpočívá z ranního návrhu („Volnější den", druhé „Dnes ne")? Pak se
//    neozve před dnem, který mu appka slíbila — dva hlasy, z nichž jeden
//    říká „až v pátek" a druhý „teď", jsou appka, která si protiřečí.
//
// Úkol připnutý na dnešek už na dnešku je, ten se neptá. Pořadí:
// nejdůležitější a nejdéle neviděné první.

import type { Priority, Task } from '../db/types'
import { daysSince } from './dates'

/** Kolik dní má pokoj úkol, který jsem prošel a nechal bez termínu. */
export const PAUZA_DNI = 7

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
}
