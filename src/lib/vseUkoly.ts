// Co je na obrazovce „Vše" a v jakém pořadí.
//
// PROČ TU UŽ NEJSOU ČASOVÉ KOŠE
//
// Seznam byl dřív rozdělený na „po termínu / dnes / zítra / tento týden /
// později / bez termínu" s tím, že se v třech stech řádcích hledá podle
// času. Jenže na „kde je ten úkol" odpovídá hledání (⌘K) a na „kdy to je"
// celá obrazovka Plán — koše tady dělaly potřetí totéž a rozsekaly
// jediný seznam na šest kousků, z nichž ani jeden nezačínal tím
// nejdůležitějším. Kdo se dívá na VŠECHNO, co má rozdělané, chce vidět
// pořadí práce, ne kalendář: jeden seznam odshora dolů podle priority.
//
// Řadí `sortTasks` z repo vrstvy (priorita, při shodě termín) — tatáž
// funkce jako všude jinde, takže se pořadí nemůže rozejít.
//
// Zbylo jedno: propadlé. Ne jako koš, ale jako ŘÁDKA TRIÁŽE nad seznamem
// — červené číslo a cesta ven po jednom. To není třídění, to je jediná
// věc, kterou seznam sám vyřešit neumí.

import type { Task } from '../db/types'

/**
 * Nejbližší relevantní den úkolu — dřívější z „naplánováno" a „termín".
 * Totéž, co používá Dnes; jedna definice „kdy to je" pro celou appku.
 */
export const denUkolu = (t: Task): string | undefined =>
  [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d)).sort()[0]

/** Propadlé = má den a ten den už byl. Bez dne úkol propadnout nemůže. */
export const jePropadly = (t: Task, dnes: string): boolean => {
  const den = denUkolu(t)
  return den !== undefined && den < dnes
}
