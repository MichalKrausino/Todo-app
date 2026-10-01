// Zpřesnění zadání modelem (Fáze 5) — čistá logika s testy.
//
// Zadávání se kvůli tomu nemění ani o milisekundu: úkol se uloží hned
// a offline, parser v telefonu z textu vytáhne, co umí. Když po něm
// v názvu zůstane dlouhá věta, uloží se k úkolu i původní text
// (`Task.zadani`) a model ho zpřesní později, až bude síť (`src/sync/zpresneni.ts`).
//
// Návrh se NIKDY nepoužije sám — appka si nemá vymýšlet (stejný důvod,
// proč odešly odhady času) a hlavně: než návrh dorazí, mohl člověk úkol
// na jiném zařízení sám upravit. Nabízí se proto jen pole, která od
// zadání nikdo nezměnil (porovnání se `zaklad`), a co člověk změnil,
// návrh už nepřebije. Přijetí i zahození `zadani` smaže, takže nabídka
// zmizí na všech zařízeních naráz běžnou synchronizací.

import type { Priority, Subtask, Task, ZadaniUkolu } from '../db/types'
import type { Navrh } from '../../supabase/functions/zpresni/navrh'
import { sPridanym } from './sdileniUkolu'

export type { Navrh }

/** Od kolika slov v názvu, který po parseru zbyl, má smysl se ptát modelu. */
export const PRAH_SLOV = 6

const slova = (s: string) => s.split(/\s+/).filter(Boolean)

/**
 * Má smysl si zadání nechat pro model?
 *
 * Krátký název („Zavolat Pavlovi") parser zvládne sám a posílat ho
 * modelu by byla platba za nic. Dlouhý zbytek je znamení, že v něm
 * zůstalo něco, co parser nepochopil. Druhá cesta je jméno kolegy
 * v textu: „…ať to udělá Ben" je krátké, ale je to předání, a to
 * parser nezná vůbec.
 */
export function potrebujeZpresneni(nazev: string, jmenaLidi: readonly string[] = []): boolean {
  if (slova(nazev).length >= PRAH_SLOV) return true
  const male = nazev.toLocaleLowerCase('cs')
  return jmenaLidi.some((j) => {
    const kmen = j.toLocaleLowerCase('cs').slice(0, Math.max(3, j.length - 2))
    return kmen.length >= 3 && new RegExp(`(^|\\s)${kmen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(male)
  })
}

/** Co uložit k úkolu při založení; `undefined` = model netřeba. */
export function zadaniPro(
  text: string,
  zaklad: ZadaniUkolu['zaklad'],
  jmenaLidi: readonly string[] = [],
): ZadaniUkolu | undefined {
  const t = text.trim()
  if (!t || t.length > 600) return undefined
  if (!potrebujeZpresneni(zaklad.title, jmenaLidi)) return undefined
  return { text: t, zaklad }
}

export type Pole = 'nazev' | 'klient' | 'projekt' | 'termin' | 'cas' | 'priorita' | 'komu' | 'kroky'

export interface Zmena {
  pole: Pole
  /** Nová hodnota v podobě, kterou uloží `pouzij` (id, datum, seznam kroků…). */
  hodnota: string | string[]
}

/** Co appka v tuhle chvíli ví o platnosti odkazů — z Dexie, ne ze serveru. */
export interface Platnost {
  /** Klienti, kteří pořád existují (bez tombstonu, neuzavření). */
  klienti: ReadonlySet<string>
  /** Projekt → jeho klient (jen živé projekty). */
  projekty: ReadonlyMap<string, string>
  /** Komu jde úkol u daného klienta předat; `undefined` = nevím, nenabízet. */
  lzePredat: (klientId: string | undefined, komu: string) => boolean
  dnes: string
}

/**
 * Které části návrhu jde u úkolu v tuhle chvíli nabídnout.
 *
 * Pole se nabídne jen když (1) ho od zadání nikdo nezměnil — hodnota na
 * úkolu je pořád ta, kterou vytáhl parser —, (2) návrh říká něco jiného
 * a (3) to, na co ukazuje, pořád existuje. Úkol z Todoistu se nezpřesňuje
 * vůbec: název, termín i zařazení vlastní Todoist a další stažení by je
 * přepsalo zpátky.
 */
export function nabidka(task: Task, navrh: Navrh, p: Platnost): Zmena[] {
  const z = task.zadani?.zaklad
  if (!z || task.todoistId || task.deletedAt) return []
  if (task.status !== 'active' && task.status !== 'inbox') return []
  const out: Zmena[] = []

  if (navrh.nazev && task.title === z.title && navrh.nazev !== task.title) {
    out.push({ pole: 'nazev', hodnota: navrh.nazev })
  }

  // Klient a projekt jdou spolu: projekt bere svého klienta s sebou.
  // Klienta jde změnit jen u úkolu bez projektu — projekt už klienta
  // určuje a úkol by jinak visel v projektu cizího klienta.
  const klientNedotcen = (task.clientId ?? undefined) === (z.clientId ?? undefined)
  const projektNedotcen = (task.projectId ?? undefined) === (z.projectId ?? undefined)
  const muzeKlient = klientNedotcen && !task.projectId
  let klient = task.clientId
  if (navrh.klientId && muzeKlient && navrh.klientId !== task.clientId && p.klienti.has(navrh.klientId)) {
    out.push({ pole: 'klient', hodnota: navrh.klientId })
    klient = navrh.klientId
  }
  if (navrh.projektId && projektNedotcen && navrh.projektId !== task.projectId) {
    const kp = p.projekty.get(navrh.projektId)
    if (kp && kp === klient) {
      out.push({ pole: 'projekt', hodnota: navrh.projektId })
    } else if (kp && muzeKlient && klient === task.clientId && p.klienti.has(kp)) {
      out.push({ pole: 'klient', hodnota: kp }, { pole: 'projekt', hodnota: navrh.projektId })
      klient = kp
    }
  }

  let termin = task.dueDate
  if (navrh.termin && task.dueDate === z.dueDate && navrh.termin !== task.dueDate && navrh.termin >= p.dnes) {
    out.push({ pole: 'termin', hodnota: navrh.termin })
    termin = navrh.termin
  }
  if (navrh.cas && termin && task.dueTime === z.dueTime && navrh.cas !== task.dueTime) {
    out.push({ pole: 'cas', hodnota: navrh.cas })
  }
  if (navrh.priorita && task.priority === z.priority && navrh.priorita !== task.priority) {
    out.push({ pole: 'priorita', hodnota: navrh.priorita })
  }
  if (navrh.komu && !task.assignedTo && klient && p.lzePredat(klient, navrh.komu)) {
    out.push({ pole: 'komu', hodnota: navrh.komu })
  }
  if (navrh.kroky && navrh.kroky.length >= 2 && !(task.subtasks ?? []).length) {
    out.push({ pole: 'kroky', hodnota: navrh.kroky })
  }
  return out
}

/**
 * Vybrané změny → úprava úkolu. Vždy smaže `zadani`: přijetí i zahození
 * je rozhodnutí, po kterém se už nemá nic nabízet (ani na druhém zařízení).
 */
export function pouzij(task: Task, zmeny: readonly Zmena[]): Partial<Task> {
  const patch: Partial<Task> = { zadani: undefined }
  for (const z of zmeny) {
    const v = z.hodnota
    if (z.pole === 'nazev' && typeof v === 'string') patch.title = v
    if (z.pole === 'klient' && typeof v === 'string') patch.clientId = v
    if (z.pole === 'projekt' && typeof v === 'string') patch.projectId = v
    if (z.pole === 'termin' && typeof v === 'string') patch.dueDate = v
    if (z.pole === 'cas' && typeof v === 'string') patch.dueTime = v
    if (z.pole === 'priorita' && typeof v === 'string') patch.priority = v as Priority
    if (z.pole === 'komu' && typeof v === 'string') {
      // Přidělit = nasdílet (jako `assignTask`): práce, na kterou přidělený
      // nevidí, je úkol, o kterém neví nikdo.
      patch.assignedTo = v
      patch.sharedWith = sPridanym(task.sharedWith, v)
    }
    if (z.pole === 'kroky' && Array.isArray(v)) {
      patch.subtasks = v.map((title): Subtask => ({ id: crypto.randomUUID(), title, done: false }))
    }
  }
  // Úkol s termínem nepatří do inboxu — stejné pravidlo jako při založení.
  if (patch.dueDate && task.status === 'inbox') patch.status = 'active'
  return patch
}
