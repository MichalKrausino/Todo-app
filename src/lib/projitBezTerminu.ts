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
// PRAVIDLA — VŠECHNY ÚKOLY BEZ TERMÍNU, KAŽDÝ DEN (Michalova volba)
//
// První verze jich brala nejvýš pět denně a zapsané dnes nechávala na
// zítřek, aby z průchodu nebyla zeď. Michal to chce obráceně: v „Projít"
// má být KAŽDÝ úkol bez termínu a on ho buď pošle na den, nebo nechá být.
//
// Druhá verze ještě nechávala „Nechat bez termínu" platit TÝDEN a mlčela
// i o úkolech, které odpočívaly z ranního návrhu. Na skutečných datech
// to znamenalo, že jediný úkol bez termínu („Napsat Benovi jak to je
// s platbou bez DPH…", nechaný 16. 10.) se pět dní neukázal nikde —
// a Michal to řekl přesně: „takhle si na ty úkoly nikdy nevzpomenu".
// Týden ticha je zapomenutí, ne pauza. Teď proto platí jediné pravidlo:
//
// O úkolu jsem DNES rozhodl („Nechat bez termínu", „Bez data" —
// `prohlednuto` je dnešek)? Pak se dnes nevrací, ať se týž úkol neobjeví
// znovu hned po zavření průchodu. ZÍTRA je v průchodu zase.
//
// Úkol připnutý na dnešek už na dnešku je, ten se neptá. Pořadí:
// nejdůležitější a nejdéle neviděné první.

import type { Priority, Task } from '../db/types'
import { daysSince } from './dates'

const VAHA: Record<Priority, number> = { critical: 3, high: 2, normal: 1, low: 0 }

/** Den, od kterého se počítá, jak dlouho úkol nikdo neviděl. */
const naposledy = (t: Task): string => t.prohlednuto ?? t.createdAt

export function jeBezTerminu(t: Pick<Task, 'dueDate' | 'scheduledFor'>): boolean {
  return !t.dueDate && !t.scheduledFor
}

export function bezTerminuKProjiti(ukoly: readonly Task[], dnes: string): Task[] {
  return ukoly
    .filter((t) => {
      if (t.deletedAt || (t.status !== 'active' && t.status !== 'inbox')) return false
      if (!jeBezTerminu(t) || t.pinnedFor === dnes) return false
      return t.prohlednuto !== dnes
    })
    .sort(
      (a, b) =>
        (VAHA[b.priority] ?? 1) - (VAHA[a.priority] ?? 1) ||
        daysSince(naposledy(b), dnes) - daysSince(naposledy(a), dnes) ||
        a.createdAt.localeCompare(b.createdAt),
    )
}
