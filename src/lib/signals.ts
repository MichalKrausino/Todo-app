// Tiché signály (Fáze 4.5): zapomenutá práce se prozrazuje tichem.
// Čisté funkce nad daty — porovnávají „co by se mělo dít" s „co se děje"
// a vracejí seznam věcí, které pravděpodobně propadly. UI je zobrazuje
// střídmě, ranní návrh dne (Fáze 6) z nich později bude čerpat.

import type { Client, Project, Task } from '../db/types'
import { addDays, daysSince, fromISODate, toISODate } from './dates'

// Prahy záměrně konzervativní — signál má být vzácný a zasloužený.
export const INBOX_AGE_DAYS = 7 // po kolika dnech je nezařazený úkol „ležák"
export const POSTPONE_THRESHOLD = 3 // kolik odkladů už stojí za zmínku
export const NEW_ENTITY_GRACE_DAYS = 3 // novým klientům/projektům se nenadává hned
/**
 * Po kolika dnech ticha se ozve hlídání u klienta, který si vlastní práh
 * nenastavil. Je to TÁŽ čtrnáctka, kterou pole v nastavení klienta
 * odjakživa ukazuje jako `placeholder` — rozhraní ji slibovalo, jen ji
 * logika nedodala.
 */
export const HLIDANI_VYCHOZI_DNI = 14

export interface Signals {
  /** klienti s hlídáním, u kterých se dlouho nic nedělo (dny bez aktivity) */
  neglected: Array<{ client: Client; days: number }>
  /** aktivní klienti (kind=client) bez jediného naplánovaného úkolu */
  unplanned: Client[]
  /** aktivní projekty bez jediného otevřeného úkolu — bez dalšího kroku */
  stalledProjects: Array<{ project: Project; client: Client }>
  /** úkoly ležící v inboxu déle než INBOX_AGE_DAYS */
  agingInbox: Task[]
  /** úkoly odložené aspoň POSTPONE_THRESHOLD× */
  postponed: Task[]
}

/**
 * Kolik dní je u klienta ticho, když už stojí za řeč — jinak `null`.
 *
 * CHYBĚJÍCÍ NASTAVENÍ ZNAMENÁ VÝCHOZÍ STAV, NE VYPNUTO
 *
 * Tohle pravidlo má appka zapsané u ranních návrhů („nesmyslný čas taky
 * ne — notifikace, která tiše zmizí, je horší než notifikace ve špatnou
 * hodinu") a tady ho porušovala: hlídání zanedbaných klientů je jedna
 * z věcí, kvůli kterým appka vůbec vznikla, a **nešlo ho spustit jinak
 * než ručně u každého klienta zvlášť**. Bezpečnostní síť, kterou si
 * musíš u každého klienta zvlášť zapnout, není bezpečnostní síť.
 *
 * Změřeno na skutečných datech: `checkIntervalDays` nemá nastavený ANI
 * JEDEN z pěti klientů, takže signál nemohl vzniknout vůbec — zatímco
 * `lastActivityAt` se poctivě razítkuje u všech (založení i dokončení
 * úkolu). Appka to celou dobu věděla a mlčela: klient „Chcinadhled" byl
 * **45 dní bez jediné stopy** a bez jediného otevřeného úkolu.
 *
 * Čtrnáct dní není odhad — je to číslo, které pole v nastavení klienta
 * odjakživa ukazuje jako `placeholder`. Rozhraní ho slibovalo, logika
 * ne. Na jeho datech se ozve právě u toho jednoho klienta, který
 * doopravdy vypadl (45 dní), a mlčí u zbylých tří (12, 5 a 1 den) —
 * signál má zůstat vzácný a zasloužený.
 *
 * **Výchozí práh platí jen pro KLIENTA, ne pro oblast.** „Osobní"
 * a „Interní" jsou přihrádky na moji vlastní práci, ne vztah, který může
 * utichnout — nadávat mi, že jsem si čtrnáct dní nezaložil osobní úkol,
 * je hluk. Vlastní `checkIntervalDays` se naopak ctí u čehokoli: kdo si
 * ho nastavil, rozhodl se.
 */
export function neglectedDays(c: Client, today?: string): number | null {
  const prah = c.checkIntervalDays ?? (c.kind === 'client' ? HLIDANI_VYCHOZI_DNI : undefined)
  if (!prah || !c.lastActivityAt) return null
  const days = daysSince(c.lastActivityAt, today)
  return days > prah ? days : null
}

const effectiveDate = (t: Task): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter((d): d is string => Boolean(d))
  return dates.sort()[0]
}

export function computeSignals(
  clients: Client[],
  projects: Project[],
  tasks: Task[],
  today: string,
): Signals {
  const liveClients = clients.filter((c) => !c.deletedAt && c.status === 'active')
  const open = tasks.filter((t) => !t.deletedAt && (t.status === 'inbox' || t.status === 'active'))
  const graceCutoff = toISODate(addDays(fromISODate(today), -NEW_ENTITY_GRACE_DAYS))

  const neglected = liveClients
    .map((client) => ({ client, days: neglectedDays(client, today) }))
    .filter((x): x is { client: Client; days: number } => x.days !== null)
    .sort((a, b) => b.days - a.days)
  const neglectedIds = new Set(neglected.map((n) => n.client.id))

  const plannedClientIds = new Set(
    open
      .filter((t) => t.clientId && (effectiveDate(t) ?? '') >= today)
      .map((t) => t.clientId as string),
  )
  const unplanned = liveClients.filter(
    (c) =>
      c.kind === 'client' &&
      !neglectedIds.has(c.id) && // zanedbaný klient už svou zmínku má
      c.createdAt.slice(0, 10) <= graceCutoff &&
      !plannedClientIds.has(c.id),
  )

  const liveClientById = new Map(liveClients.map((c) => [c.id, c]))
  const projectIdsWithOpenTask = new Set(
    open.filter((t) => t.projectId).map((t) => t.projectId as string),
  )
  const stalledProjects = projects
    .filter(
      (p) =>
        !p.deletedAt &&
        p.status === 'active' &&
        liveClientById.has(p.clientId) &&
        p.createdAt.slice(0, 10) <= graceCutoff &&
        !projectIdsWithOpenTask.has(p.id),
    )
    .map((project) => ({ project, client: liveClientById.get(project.clientId)! }))

  const agingInbox = open
    .filter(
      (t) => t.status === 'inbox' && !t.dueDate && !t.scheduledFor && t.createdAt.slice(0, 10) <= graceCutoffFor(today, INBOX_AGE_DAYS),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const postponed = open
    .filter((t) => (t.postponeCount ?? 0) >= POSTPONE_THRESHOLD)
    .sort((a, b) => (b.postponeCount ?? 0) - (a.postponeCount ?? 0))

  return { neglected, unplanned, stalledProjects, agingInbox, postponed }
}

const graceCutoffFor = (today: string, days: number) =>
  toISODate(addDays(fromISODate(today), -days))

export const hasAnySignal = (s: Signals): boolean =>
  s.neglected.length > 0 ||
  s.unplanned.length > 0 ||
  s.stalledProjects.length > 0 ||
  s.agingInbox.length > 0 ||
  s.postponed.length > 0
