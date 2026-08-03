// Kapacita dne (inspirace Sunsama/Motion): tichý součet odhadované práce
// vs. volný čas v kalendáři. Odhady jednotlivých úkolů se nikdy neukazují
// (CLAUDE.md) — ven jde jen celkový objem a klidné varování při přetížení.

import type { Task } from '../db/types'

export const DEFAULT_TASK_MINUTES = 60
// Bez kalendáře srovnáváme s rozumnou denní kapacitou soustředěné práce.
export const DEFAULT_DAY_CAPACITY_MIN = 6 * 60

export function plannedMinutes(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + (t.estimateMinutes ?? DEFAULT_TASK_MINUTES), 0)
}

// Přetížení: víc naplánované práce, než kolik je volného času (nebo výchozí
// kapacity, když kalendář nic neví). Malý přesah (do 30 min) neřešíme.
export function isOverloaded(workMinutes: number, freeMinutes: number | null): boolean {
  const capacity = freeMinutes ?? DEFAULT_DAY_CAPACITY_MIN
  return workMinutes > capacity + 30
}
