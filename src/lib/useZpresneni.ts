// Úkoly, ke kterým je co nabídnout ze zpřesnění zadání (Fáze 5).
//
// Živý dotaz nad lokálními návrhy (`db.navrhy`) a úkoly. Nabídka se
// počítá při každé změně znovu (`nabidka`), takže jakmile člověk pole
// upraví sám — tady, v detailu nebo na druhém zařízení —, z nabídky
// zmizí bez jakéhokoli úklidu.

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Task } from '../db/types'
import { todayISO } from './dates'
import { nabidka, type Zmena } from './zpresneni'

export interface NabidkaUkolu {
  task: Task
  zmeny: Zmena[]
}

export function useZpresneni(): NabidkaUkolu[] {
  return useLiveQuery(
    async () => {
      const navrhy = await db.navrhy.toArray()
      if (!navrhy.length) return []
      const [ukoly, klienti, projekty, lide, meta] = await Promise.all([
        db.tasks.bulkGet(navrhy.map((n) => n.taskId)),
        db.clients.toArray(),
        db.projects.toArray(),
        db.lide.toArray(),
        db.syncState.get('meta'),
      ])
      const ja = meta?.userId
      const znami = new Set(lide.map((l) => l.userId))
      const platnost = {
        klienti: new Set(klienti.filter((c) => !c.deletedAt && c.status !== 'archived').map((c) => c.id)),
        projekty: new Map(
          projekty.filter((p) => !p.deletedAt && p.status === 'active').map((p) => [p.id, p.clientId]),
        ),
        // Že člověk u TOHO klienta opravdu je, ověří až panel (`useKolegove`)
        // — tady stačí, že ho vůbec známe a není to on sám.
        lzePredat: (_klient: string | undefined, komu: string) => komu !== ja && znami.has(komu),
        dnes: todayISO(),
      }
      const out: NabidkaUkolu[] = []
      navrhy.forEach((n, i) => {
        const task = ukoly[i]
        if (!task || task.zadani?.text !== n.text) return
        if (task.ownerId && task.ownerId !== ja) return
        const zmeny = nabidka(task, n.navrh, platnost)
        if (zmeny.length) out.push({ task, zmeny })
      })
      return out
    },
    [],
    [],
  )
}
