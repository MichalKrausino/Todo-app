// Objem naplánované práce v minutách — jediné, k čemu odhady ještě slouží.
//
// KDE UŽ NESLOUŽÍ: verdikt „tenhle den je přeplněný" se z minut počítat
// přestal. `estimateMinutes` je hádaný (`estimate.ts` ho razítkuje z osmi
// klíčových slov; 53 % úkolů ho nemá vůbec a tiše se za ně počítá 60 min)
// a s realitou se nikdy neporovná, protože appka čas neměří. Stavět na
// tom soud o dni znamenalo stavět ho na písku — strop dne proto měří
// POČET úkolů proti osobnímu průtoku (`prutok.ts`, `kapacitaDne.ts`)
// a volnější den se vybírá taky podle počtu (`volnyDen.ts`).
//
// Zbyl obrázek, ne verdikt: délka dílů v pruhu dne a hrubé „~3 h" pod
// seznamem. Odhad u jednotlivého úkolu se nikde neukazuje (CLAUDE.md).

import type { Task } from '../db/types'

export const DEFAULT_TASK_MINUTES = 60

export function plannedMinutes(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + (t.estimateMinutes ?? DEFAULT_TASK_MINUTES), 0)
}
