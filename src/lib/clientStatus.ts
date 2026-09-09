// Stavová řádka klienta — jedna, a jen s tím, co má co říct.
//
// Stejná věta stojí v seznamu klientů i v hlavičce detailu, takže žije
// na jednom místě: pořadí je pořadí důležitosti, protože na úzkém
// displeji se ořezává zprava — kolik hoří → ticho → kdy je další práce
// → přívlastky (druh, sdíleno, Todoist).
//
// Propadlé se počítají zvlášť a den se bere jen z toho, co teprve
// přijde: dřív se do „nejbližšího dne" započítal i propadlý termín,
// takže řádek ukazoval „čt 27. 8." — a to se čte jako plán, ne jako
// průšvih.

import type { Client, Task } from '../db/types'
import { formatDayLabel, todayISO } from './dates'
import { KIND_LABELS } from './labels'
import { neglectedDays } from './signals'

export interface StavovaCast {
  text: string
  tone?: 'danger' | 'note'
}

const effectiveDate = (t: Task): string | undefined =>
  [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d)).sort()[0]

export function stavKlienta(
  client: Client,
  otevrene: Task[],
  volby: { sdileno?: boolean; todoist?: boolean } = {},
  today: string = todayISO(),
): StavovaCast[] {
  let hori = 0
  let den: string | undefined
  for (const t of otevrene) {
    const d = effectiveDate(t)
    if (!d) continue
    if (d < today) hori++
    else if (!den || d < den) den = d
  }

  const casti: StavovaCast[] = []
  if (hori > 0) casti.push({ text: `${hori} po termínu`, tone: 'danger' })
  const ticho = neglectedDays(client, today)
  if (ticho !== null) casti.push({ text: `ticho ${ticho} dní`, tone: 'note' })
  if (otevrene.length === 0) casti.push({ text: 'žádné úkoly' })
  else if (den) casti.push({ text: formatDayLabel(den).toLowerCase() })
  // „nic naplánováno" vedle propadlých je hluk — propadlé řeknou dost.
  else if (!hori) casti.push({ text: 'nic naplánováno' })
  // U oblastí („Interní", „Osobní") se druh hlásí — u klienta je zbytečný.
  if (client.kind !== 'client') casti.push({ text: KIND_LABELS[client.kind] })
  if (volby.sdileno) casti.push({ text: 'sdíleno' })
  if (volby.todoist) casti.push({ text: 'Todoist' })
  return casti
}
