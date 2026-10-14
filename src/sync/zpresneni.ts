// Vyzvednutí návrhů k zadání úkolů (Fáze 5) — síťová půlka zpřesnění.
//
// Návrhy NEPÍŠE appka ani placené API: píše je rutina Claude Code na
// předplatném (supabase/rutina-zpresneni.md). Jednou za hodinu si sama
// vezme z databáze úkoly s uloženým zadáním — `Task.zadani` se na server
// dostane běžnou synchronizací — a odpověď uloží do `zpresneni_navrhy`.
// Appka nikam nic neposílá; jen se podívá, co je hotové, přeloží odkazy
// a návrh si uloží lokálně (`db.navrhy`) — proč jen lokálně, viz `NavrhRow`.
//
// Pouští to plánovač (`live.ts`) po každém syncu, tedy jen v popředí
// a se signálem. Pravidla, která drží tohle levné a klidné:
// - ptá se jen když existuje můj otevřený úkol se zadáním a bez návrhu,
//   a nejvýš jednou za `ROZESTUP_MS` — rutina jede po hodině, častější
//   dotaz by nepřinesl nic;
// - selhaný dotaz = „nevím": zkusí se při dalším průchodu;
// - server bez tabulky (SQL ještě neběželo) zastaví dotazy do restartu.

import { db } from '../db/db'
import type { Task } from '../db/types'
import { navrhZRadku } from '../lib/zpresneniNavrh'
import { getSupabase } from './engine'

const ROZESTUP_MS = 5 * 60_000
const NA_DOTAZ = 100

let bezi = false
let zastaveno = false
let posledniDotaz = 0

const otevreny = (t: Task) => !t.deletedAt && (t.status === 'active' || t.status === 'inbox')

export async function zpresniCekajici(): Promise<void> {
  if (bezi || zastaveno || !navigator.onLine) return
  const sb = getSupabase()
  if (!sb) return
  bezi = true
  try {
    const ja = (await db.syncState.get('meta'))?.userId
    const kandidati = (await db.tasks.toArray()).filter(
      (t) => t.zadani && otevreny(t) && !t.todoistId && (!t.ownerId || t.ownerId === ja),
    )
    if (!kandidati.length) return
    const hotove = new Map((await db.navrhy.bulkGet(kandidati.map((t) => t.id))).map((r) => [r?.taskId, r]))
    const fronta = kandidati.filter((t) => hotove.get(t.id)?.text !== t.zadani!.text).slice(0, NA_DOTAZ)
    if (!fronta.length) return
    if (Date.now() - posledniDotaz < ROZESTUP_MS) return

    const { data: sezeni } = await sb.auth.getSession()
    if (!sezeni.session) return
    posledniDotaz = Date.now()

    // RLS vrací jen moje a jen hotové řádky.
    const { data, error } = await sb
      .from('zpresneni_navrhy')
      .select('task_id, text, vstup, odpoved')
      .in(
        'task_id',
        fronta.map((t) => t.id),
      )
    if (error) {
      // Tabulka chybí: PostgREST ji nezná (PGRST205), Postgres taky ne (42P01).
      if (error.code === 'PGRST205' || error.code === '42P01') zastaveno = true
      return
    }

    const podleId = new Map(fronta.map((t) => [t.id, t]))
    const at = new Date().toISOString()
    const nove = ((data ?? []) as { task_id: string; text: string; vstup: unknown; odpoved: unknown }[]).flatMap((r) => {
      const t = podleId.get(r.task_id)
      // Návrh k jinému znění zadání neplatí — zadání se mezitím změnilo
      // a rutina ho vezme znovu.
      if (!t || r.text !== t.zadani!.text) return []
      return [{ taskId: t.id, text: r.text, navrh: navrhZRadku(r.vstup, r.odpoved), at }]
    })
    if (nove.length) await db.navrhy.bulkPut(nove)
  } catch {
    // Výpadek sítě: zkusí se při dalším průchodu plánovače.
  } finally {
    bezi = false
  }
}
