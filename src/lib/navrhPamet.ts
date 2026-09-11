// Paměť ranního návrhu v appce — TÁŽ logika, kterou používá server.
// pick.ts z edge funkce se dováží přímo (žádná kopie), takže co appka
// řekne jako „vrátí se v pátek", to server v pátek udělá.
//
// Proč to appka potřebuje: odložení nesmí být zapomenutí. Odpočívající
// úkol má být vidět (inbox, Plán, panel návrhu) i s dnem návratu, a ve
// chvíli, kdy odkládáš, má appka říct, co se stane — ne až zítra ráno.
//
// Dva pohledy: DNES (co server dnes ráno spočítal — které návrhy se
// vracejí z odložení) a ZÍTRA (co s úkoly udělá zítřejší ráno — kdo
// odpočívá a do kdy). Zítřejší pohled počítá i dnešní rozhodnutí,
// dnešní je nevidí, přesně jako server.

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addDays, fromISODate, toISODate, todayISO } from './dates'
import {
  HISTORIE_DNI,
  historieZPlanu,
  pametUkolu,
  type Rec,
  type Rozhodnuti,
} from '../../supabase/functions/morning-plan/pick'

export { pametUkolu, PAUZA_DNI } from '../../supabase/functions/morning-plan/pick'
export type { Pamet, Rozhodnuti } from '../../supabase/functions/morning-plan/pick'

const posun = (iso: string, n: number): string => toISODate(addDays(fromISODate(iso), n))

/** Rozhodnutí z plánů za HISTORIE_DNI dní před `den` (bez toho dne). */
export async function historieRozhodnuti(den: string): Promise<Rozhodnuti[]> {
  const od = posun(den, -HISTORIE_DNI)
  const plans = await db.dayPlans.where('date').aboveOrEqual(od).filter((p) => !p.deletedAt).toArray()
  return historieZPlanu(plans as unknown as Rec[], den)
}

export interface NavrhPamet {
  /** dnešní pohled: navržené úkoly, které se vracejí z odložení */
  vraci: Set<string>
  /** zítřejší pohled: odpočívající úkoly a den, kdy se vrátí */
  odpociva: Map<string, string>
  /** historie k zítřku — pro odhad, co udělá právě zvolená odpověď */
  histZitra: Rozhodnuti[]
}

const PRAZDNA: NavrhPamet = { vraci: new Set(), odpociva: new Map(), histZitra: [] }

export function useNavrhPamet(): NavrhPamet {
  const dnes = todayISO()
  return (
    useLiveQuery(async () => {
      const zitra = posun(dnes, 1)
      const [histDnes, histZitra] = await Promise.all([historieRozhodnuti(dnes), historieRozhodnuti(zitra)])
      const vraci = new Set<string>()
      for (const id of new Set(histDnes.map((h) => h.taskId))) {
        if (pametUkolu(id, histDnes, dnes).navrat) vraci.add(id)
      }
      const odpociva = new Map<string, string>()
      for (const id of new Set(histZitra.map((h) => h.taskId))) {
        const p = pametUkolu(id, histZitra, zitra)
        if (p.pauza && p.pauzaDo) odpociva.set(id, p.pauzaDo)
      }
      return { vraci, odpociva, histZitra }
    }, [dnes]) ?? PRAZDNA
  )
}

/**
 * Co udělá odpověď v dnešním návrhu: den návratu, když z ní vzejde
 * pauza; jinak undefined (úkol se zítra nabídne znovu).
 */
export function kdySeVrati(
  taskId: string,
  histZitra: Rozhodnuti[],
  decision: 'rejected' | 'snoozed',
  dnes = todayISO(),
): string | undefined {
  const bezDnesniho = histZitra.filter((h) => !(h.date === dnes && h.taskId === taskId))
  const p = pametUkolu(taskId, [...bezDnesniho, { date: dnes, taskId, decision }], posun(dnes, 1))
  return p.pauza ? p.pauzaDo : undefined
}
