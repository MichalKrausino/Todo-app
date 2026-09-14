// Rozpad projektu na kroky nad daty (Fáze 5). Čistá logika je v
// `src/lib/rozpad.ts`, tady se k ní jen sbírají podklady.
//
// Snímá se PŘI OTEVŘENÍ, ne živým dotazem — stejně jako fronta v triáži
// a v „Bez termínu". Živý dotaz by nabídku pod rukama přerovnával
// a navíc by kvůli panelu, který je většinu času zavřený, visel nad
// všemi úkoly ve všech projektech.

import { db } from './db'
import { addTask } from './repo'
import { emitRepoWrite } from './events'
import { navrhniKroky, type Krok, type ZdrojProjekt } from '../lib/rozpad'
import type { Project, Task } from './types'

const zivy = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt

// Zahozený úkol („už neplatí") není krok, který by se měl nabízet dál.
const pouzitelny = (t: Task) => zivy(t) && t.status !== 'dropped'

export async function navrhKroku(project: Project): Promise<Krok[]> {
  const [projekty, ukoly, klienti] = await Promise.all([
    db.projects.filter(zivy).toArray(),
    db.tasks.filter(pouzitelny).toArray(),
    db.clients.filter(zivy).toArray(),
  ])

  const jmenoKlienta = new Map(klienti.map((c) => [c.id, c.name]))
  const podleProjektu = new Map<string, Task[]>()
  for (const t of ukoly) {
    if (!t.projectId) continue
    const stavajici = podleProjektu.get(t.projectId)
    // Nikdy `set(k, [...get(k), x])` — kopie pole při každém přidání je
    // kvadratická práce (viz CLAUDE.md, Výkon).
    if (stavajici) stavajici.push(t)
    else podleProjektu.set(t.projectId, [t])
  }

  const poradi = (a: Task, b: Task) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)

  const historie: ZdrojProjekt[] = projekty
    .filter((p) => p.id !== project.id)
    .map((p) => ({
      id: p.id,
      name: p.name,
      goal: p.goal,
      clientName: jmenoKlienta.get(p.clientId),
      ukoly: (podleProjektu.get(p.id) ?? []).sort(poradi).map((t) => t.title),
    }))

  const uzMa = (podleProjektu.get(project.id) ?? []).map((t) => t.title)
  return navrhniKroky(
    { ...project, clientName: jmenoKlienta.get(project.clientId) },
    historie,
    uzMa,
    klienti.map((c) => c.name),
  )
}

/** Založí vybrané kroky jako úkoly projektu. Vrací jejich id kvůli „Zpět". */
export async function pridejKroky(project: Project, kroky: Krok[]): Promise<string[]> {
  const ids: string[] = []
  for (const k of kroky) {
    const t = await addTask({ title: k.title, clientId: project.clientId, projectId: project.id })
    ids.push(t.id)
  }
  return ids
}

/** „Zpět" u právě přidaných kroků — tombstone, jako každé jiné mazání. */
export async function vratKroky(ids: string[]): Promise<void> {
  const t = new Date().toISOString()
  await db.transaction('rw', db.tasks, async () => {
    for (const id of ids) await db.tasks.update(id, { deletedAt: t, updatedAt: t })
  })
  emitRepoWrite()
}
