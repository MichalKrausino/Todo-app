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

// PROPADLÉ NENÍ JEDNA VĚC — JSOU TO DVĚ
//
// „Kdy to je" je dřívější z termínu a naplánování (`denUkolu`), a to je
// pro řazení správně. Jenže řádka triáže tomu celému říkala **„po
// termínu"** a psala to červeně, přestože naplánování ŽÁDNÝ TERMÍN NENÍ:
// je to den, který sis vybral sám. Nestihnout vlastní plán se stane
// skoro každý den; nestihnout termín je slib, který jsi dal někomu
// jinému.
//
// Změřeno na skutečných datech: appka hlásila červeně „po termínu · 8"
// a **ani jeden z těch osmi po termínu nebyl** — sedm nemělo termín
// vůbec (11 ze 14 otevřených úkolů žádný nemá) a osmý ho měl až ZÍTRA,
// takže se o den předem tvářil jako propásnutý. Řádek úkolu přitom
// mlčel: `TaskRow` obarvuje datum jen podle `dueDate`, takže nad
// seznamem, ve kterém nebylo nic červeného, stálo červené číslo.
// Obrazovka si protiřečila a hlasitější půlka lhala.
//
// Fronta triáže zůstává jedna — obojí se potřebuje posunout a dvě řádky
// nad jedním seznamem jsou dvě odpovědi na „co se nestihlo". Mění se
// jen JMÉNO a TÓN, a ty se řídí tím, co tam doopravdy je.

/** Termín propadl — slib danému dni, ne sobě. */
export const maPropadlyTermin = (t: Task, dnes: string): boolean =>
  t.dueDate !== undefined && t.dueDate < dnes

/** Minul den, který sis vybral sám; termín buď není, nebo teprve přijde. */
export const jeNestihnuty = (t: Task, dnes: string): boolean =>
  jePropadly(t, dnes) && !maPropadlyTermin(t, dnes)

export interface PopisPropadlych {
  /** text do řádky triáže, bez počtu */
  slovo: string
  /** kolik jich řádka hlásí */
  pocet: number
  tone: 'danger' | 'note'
}

/**
 * Jak se ta hromádka jmenuje. Propadlý termín je hlasitější fakt, takže
 * když nějaký je, mluví se o něm — a zbytek jede ve frontě s ním
 * („Projít" počet neslibuje). Bez jediného propadlého termínu se červená
 * nepoužije vůbec: nestihnutý vlastní plán není průšvih, jen práce,
 * která čeká.
 */
export function popisPropadlych(ukoly: Task[], dnes: string): PopisPropadlych | undefined {
  const propadle = ukoly.filter((t) => jePropadly(t, dnes))
  if (propadle.length === 0) return undefined
  const poTerminu = propadle.filter((t) => maPropadlyTermin(t, dnes)).length
  return poTerminu > 0
    ? { slovo: 'po termínu', pocet: poTerminu, tone: 'danger' }
    : { slovo: 'nestihnuto', pocet: propadle.length, tone: 'note' }
}
