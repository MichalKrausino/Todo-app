// Vyzvednutí návrhů k zadání úkolů (Fáze 5) — síťová půlka zpřesnění.
//
// Pouští ho plánovač (`live.ts`) po každém syncu, tedy jen v popředí
// a se signálem. Najde moje otevřené úkoly s uloženým zadáním, ke kterým
// tohle zařízení ještě nemá návrh, a zeptá se na ně edge funkce `zpresni`.
// Návrh uloží jen lokálně (`db.navrhy`) — proč, viz `NavrhRow`.
//
// Pravidla, která drží tohle levné a klidné:
// - nejvýš `NA_PRUCHOD` úkolů za průchod a po jednom — nikdy dávka, která
//   by při výpadku spadla celá;
// - selhání = „nevím", ne „nic": úkol se zkusí znovu s rostoucí pauzou
//   (1 → 5 → 30 min) a po třech nezdarech se do restartu nechá být;
// - funkce bez klíče (503 `nenastaveno`) nebo nad denním stropem (429)
//   zastaví dotazy do restartu appky — dál by se jen platilo za odmítnutí;
// - prázdný návrh se uloží taky: „model k tomu nic nemá" je odpověď
//   a ptát se znovu by stálo peníze za tutéž odpověď.

import { db } from '../db/db'
import type { Task } from '../db/types'
import { todayISO } from '../lib/dates'
import { kratkaJmena } from '../lib/tymUkoly'
import type { Kontext, Navrh } from '../../supabase/functions/zpresni/navrh'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { getSupabase } from './engine'

const NA_PRUCHOD = 3
const PAUZY_MS = [60_000, 5 * 60_000, 30 * 60_000]

let bezi = false
let zastaveno = false
const nezdary = new Map<string, { pocet: number; dalsiPo: number }>()

const otevreny = (t: Task) => !t.deletedAt && (t.status === 'active' || t.status === 'inbox')

async function kontext(ja: string | undefined): Promise<Kontext> {
  const [klienti, projekty, lide] = await Promise.all([
    db.clients.toArray(),
    db.projects.toArray(),
    db.lide.toArray(),
  ])
  const jmena = kratkaJmena(lide.map((l) => l.email))
  return {
    dnes: todayISO(),
    klienti: klienti
      .filter((c) => !c.deletedAt && c.status !== 'archived')
      .map((c) => ({ id: c.id, jmeno: c.name })),
    projekty: projekty
      .filter((p) => !p.deletedAt && p.status === 'active')
      .map((p) => ({ id: p.id, jmeno: p.name, klientId: p.clientId })),
    lide: lide
      .filter((l) => l.userId !== ja)
      .map((l) => ({ id: l.userId, jmeno: jmena.get(l.email) ?? l.email })),
  }
}

async function zeptejSe(task: Task, k: Kontext, token: string): Promise<Navrh | 'stop' | null> {
  const z = task.zadani!
  const res = await fetch(`${SUPABASE_URL}/functions/v1/zpresni`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({
      zadani: z.text,
      parser: {
        nazev: z.zaklad.title,
        klientId: z.zaklad.clientId,
        projektId: z.zaklad.projectId,
        termin: z.zaklad.dueDate,
        cas: z.zaklad.dueTime,
        priorita: z.zaklad.priority,
      },
      kontext: { klienti: k.klienti, projekty: k.projekty, lide: k.lide },
    }),
  })
  // 404 = funkce není nasazená, 503 = chybí klíč, 429 = denní strop.
  // Všechno tři do restartu nezmění nic, tak se nemá smysl ptát dál.
  if (res.status === 404 || res.status === 503 || res.status === 429) return 'stop'
  if (!res.ok) return null
  const json = (await res.json().catch(() => null)) as { navrh?: Navrh } | null
  return json?.navrh ?? null
}

export async function zpresniCekajici(): Promise<void> {
  if (bezi || zastaveno || !navigator.onLine) return
  const sb = getSupabase()
  if (!sb || !SUPABASE_URL) return
  bezi = true
  try {
    const { data } = await sb.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    const ja = (await db.syncState.get('meta'))?.userId

    const kandidati = (await db.tasks.toArray()).filter(
      (t) => t.zadani && otevreny(t) && !t.todoistId && (!t.ownerId || t.ownerId === ja),
    )
    if (!kandidati.length) return
    const hotove = new Map((await db.navrhy.bulkGet(kandidati.map((t) => t.id))).map((r) => [r?.taskId, r]))
    const ted = Date.now()
    const fronta = kandidati
      .filter((t) => hotove.get(t.id)?.text !== t.zadani!.text)
      .filter((t) => {
        const n = nezdary.get(t.id)
        return !n || (n.pocet < PAUZY_MS.length && ted >= n.dalsiPo)
      })
      .slice(0, NA_PRUCHOD)
    if (!fronta.length) return

    const k = await kontext(ja)
    for (const t of fronta) {
      let navrh: Navrh | 'stop' | null = null
      try {
        navrh = await zeptejSe(t, k, token)
      } catch {
        navrh = null
      }
      if (navrh === 'stop') {
        zastaveno = true
        return
      }
      if (!navrh) {
        const pocet = (nezdary.get(t.id)?.pocet ?? 0) + 1
        nezdary.set(t.id, { pocet, dalsiPo: Date.now() + (PAUZY_MS[pocet - 1] ?? 0) })
        continue
      }
      nezdary.delete(t.id)
      await db.navrhy.put({ taskId: t.id, text: t.zadani!.text, navrh, at: new Date().toISOString() })
    }
  } finally {
    bezi = false
  }
}
