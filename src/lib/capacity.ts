// Kapacita dne (inspirace Sunsama/Motion): tichý součet odhadované práce
// vs. volný čas v kalendáři. Odhady jednotlivých úkolů se nikdy neukazují
// (CLAUDE.md) — ven jde jen celkový objem a klidné varování při přetížení.

import type { Task } from '../db/types'
import { PLNY_DEN_MIN } from './pruhDne'

export const DEFAULT_TASK_MINUTES = 60
/**
 * Bez kalendáře se srovnává s pracovní dobou, tedy s TÝMŽ stropem, jaký
 * kreslí pruh dne (`PLNY_DEN_MIN`, `WORK_START`–`WORK_END`).
 *
 * Dřív tu stálo šest hodin — „rozumná kapacita soustředěné práce". Jenže
 * appka pak měla na JEDNÉ obrazovce dvě odpovědi: pod titulkem Dnes stál
 * pruh naplněný ze sedmi osmin, tedy ne plný, a hned pod ním věta „na den
 * je toho moc". Obě čísla byla obhajitelná a dohromady si protiřečila.
 * Strop je jeden a je to ten, který je vidět.
 */
export const DEFAULT_DAY_CAPACITY_MIN = PLNY_DEN_MIN

export function plannedMinutes(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + (t.estimateMinutes ?? DEFAULT_TASK_MINUTES), 0)
}

// Přetížení: víc naplánované práce, než kolik je volného času (nebo výchozí
// kapacity, když kalendář nic neví). Malý přesah (do 30 min) neřešíme.
export function isOverloaded(workMinutes: number, freeMinutes: number | null): boolean {
  const capacity = freeMinutes ?? DEFAULT_DAY_CAPACITY_MIN
  return workMinutes > capacity + 30
}
