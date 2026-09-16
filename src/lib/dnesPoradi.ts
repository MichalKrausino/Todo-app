// Pořadí seznamu na obrazovce Dnes — čistá logika s testy.
//
// Dnes odpovídá na jedinou otázku: „co teď?". Odpověď na ni dává
// PRIORITA, ne to, kterého dne měl úkol být hotový.
//
// Dřív se seznam skládal ze tří bloků za sebou — připnuté, propadlé,
// dnešní — a priorita řadila jen uvnitř každého z nich. Kritický dnešní
// úkol tak stál pod nízkoprioritním propadlým a seznam ve skutečnosti
// odpovídal na „kdy to mělo být". Propadlost přitom pořadí nést nemusí:
// na řádku ji říká červené datum (`showDate`), kolik jich je a co s nimi
// řeší řádka triáže nad seznamem. Sloučením se tedy žádný signál
// neztrácí — jen přestane přebíjet ten, na kterém obrazovka stojí.
//
// Připnuté zůstávají blokem nahoře schválně. Špendlík („Top 3 dne") je
// ruční „tohle první", tedy jiná osa než priorita; kdyby ho priorita
// přebila, přestalo by připnutí znamenat cokoli.
//
// Při shodné prioritě rozhoduje termín (to dělá `serad`), takže se
// propadlé uvnitř své úrovně dostanou nad dnešní samy od sebe.

import type { Task } from '../db/types'

export interface PolozkaDne {
  task: Task
  /** Ukázat datum na řádku — tedy že je úkol propadlý. */
  showDate: boolean
}

export interface PoradiDne {
  /**
   * Propadlé úkoly BEZ připnutých — počet v řádce triáže i fronta, kterou
   * triáž prochází. Připnuté se sem nepočítají: ty už si člověk na dnešek
   * vybral, takže je nemá co „projít".
   */
  propadleNepripnute: Task[]
  poradi: PolozkaDne[]
}

/**
 * `serad` je `sortTasks` z repo vrstvy — předává se, aby modul zůstal
 * čistý a testovatelný bez databáze.
 */
export function poradiDne(
  propadle: Task[],
  dnesni: Task[],
  dnes: string,
  serad: (ukoly: Task[]) => Task[],
): PoradiDne {
  const pripnuty = (t: Task) => t.pinnedFor === dnes
  // Propadlost se pozná podle koše, ze kterého úkol přišel — ne dopočtem
  // data, aby modul nemusel znát, co je „nejbližší relevantní den".
  const propadleId = new Set(propadle.map((t) => t.id))

  const pripnute = serad([...propadle, ...dnesni].filter(pripnuty))
  const propadleNepripnute = propadle.filter((t) => !pripnuty(t))
  const zbytek = serad([...propadleNepripnute, ...dnesni.filter((t) => !pripnuty(t))])

  return {
    propadleNepripnute,
    poradi: [...pripnute, ...zbytek].map((task) => ({
      task,
      showDate: propadleId.has(task.id),
    })),
  }
}
