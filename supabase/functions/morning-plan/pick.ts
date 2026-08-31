// Výběr úkolů do ranního návrhu — čistá logika bez Dena a bez sítě, aby
// šla otestovat vitestem (pick.test.ts). Edge funkce `morning-plan` si ji
// jen zavolá; skórování a výběr tak mají jedno místo.

export type Rec = Record<string, unknown>

export interface Scored {
  t: Rec
  score: number
  reason: string
}

export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)

export const addDaysISO = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Rozhodné datum úkolu — dřívější z naplánování a termínu. */
export const eff = (t: Rec): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter(Boolean) as string[]
  return dates.sort()[0]
}

export type Priority = 'critical' | 'high' | 'normal' | 'low'
const LEVELS: Priority[] = ['critical', 'high', 'normal', 'low']

const prio = (t: Rec): Priority => {
  const p = t.priority as string
  return LEVELS.includes(p as Priority) ? (p as Priority) : 'normal'
}

// Kolik úkolů BEZ termínu smí do návrhu spadnout z které priority. Klesající
// řada je celý vtip: nabídka má být vážená důležitostí, ne jen „prvních pár
// z inboxu". Nevyčerpaný strop se níž dobere (viz doplnění v cascade), takže
// když kritické nejsou, nabídku vyplní vysoké a tak dál.
const UNDATED_CAPS: Record<Priority, number> = { critical: 2, high: 2, normal: 1, low: 1 }

/** Celkem návrhů na den. */
export const TOTAL = 6
/** Kolik slotů se drží úkolům bez termínu, i když je dost těch s termínem. */
export const UNDATED_MIN = 2
/** Strop pro úkoly bez termínu, ať velký inbox nepřebije skutečné termíny. */
export const UNDATED_MAX = 4
/** Pestrost: víc než tolik úkolů od jednoho klienta návrh nedostane. */
export const PER_CLIENT = 2

// Strop platí jen na skutečné klienty. Úkoly bez klienta spolu nesouvisí,
// takže je nelze sesypat pod jeden klíč — jinak by plný inbox vlastních
// úkolů nabídl vždycky jen dva a zbytek by se nikdy nedostal ke slovu.
const clientKey = (t: Rec): string | undefined => (t.clientId as string) || undefined

function clientFree(c: Scored, used: Map<string, number>): boolean {
  const k = clientKey(c.t)
  return k === undefined || (used.get(k) ?? 0) < PER_CLIENT
}

function takeClient(c: Scored, used: Map<string, number>): void {
  const k = clientKey(c.t)
  if (k === undefined) return
  used.set(k, (used.get(k) ?? 0) + 1)
}

export function scoreAndReason(
  t: Rec,
  clientsById: Map<string, Rec>,
  today: string,
): { score: number; reason: string } {
  const d = eff(t)
  const client = t.clientId ? clientsById.get(t.clientId as string) : undefined
  let score = 0
  const reasons: Array<{ w: number; text: string }> = []

  if (d) {
    if (d < today) {
      const over = daysBetween(d, today)
      score += 4 + Math.min(over, 5) * 0.5
      reasons.push({ w: 5, text: over === 1 ? 'termín byl včera' : `po termínu už ${over} dní` })
    } else if (d === today) {
      score += 5
      reasons.push({ w: 4, text: 'termín je dnes' })
    } else if (d === addDaysISO(today, 1)) {
      score += 1.5
      reasons.push({ w: 2, text: 'termín je zítra' })
    }
  } else {
    // Úkol bez termínu se sám nikde nepřipomene: na Dnes nepatří a v Plánu
    // leží pod čarou „bez termínu". Ranní návrh je jediné místo, kde na sebe
    // upozorní, takže musí projít filtrem score > 0 i s normální a nízkou
    // prioritou — proto základ 1,5 (nízká priorita bere bod, zbyde 0,5).
    // Stárnutí ho pak postupně tlačí nahoru, ať se ležáky samy vyplavou.
    const created = String(t.createdAt ?? '').slice(0, 10)
    const age = /^\d{4}-\d{2}-\d{2}$/.test(created) ? Math.max(0, daysBetween(created, today)) : 0
    score += 1.5 + Math.min(age, 30) * 0.05
    reasons.push({
      w: 0.6,
      text: age >= 7 ? `bez termínu, leží tu ${age} dní` : 'nemá termín',
    })
  }

  const p = prio(t)
  if (p === 'critical') {
    score += 4
    reasons.push({ w: 3, text: 'kritická priorita' })
  } else if (p === 'high') {
    score += 2
    reasons.push({ w: 1.5, text: 'vysoká priorita' })
  } else if (p === 'low') {
    score -= 1
  }

  const postponed = (t.postponeCount as number) ?? 0
  if (postponed >= 2) {
    score += Math.min(postponed, 4) * 0.75
    reasons.push({ w: 2.5, text: `odkládáš to už ${postponed}×` })
  }

  if (t.isClientCheck && d && d <= today) {
    score += 1
    reasons.push({ w: 1, text: 'pravidelná kontrola' })
  }

  if (client) {
    const interval = client.checkIntervalDays as number | undefined
    const last = (client.lastActivityAt as string | undefined)?.slice(0, 10)
    if (interval && last) {
      const idle = daysBetween(last, today)
      if (idle > interval) {
        score += 2 + Math.min(idle, 30) * 0.1
        reasons.push({ w: 3.5, text: `u klienta ${client.name} se ${idle} dní nic nedělo` })
      }
    }
  }

  reasons.sort((a, b) => b.w - a.w)
  return { score, reason: reasons[0]?.text ?? 'dlouho čeká v seznamu' }
}

/** Seřadí kandidáty: skóre dolů, při shodě starší napřed. */
const byScore = (a: Scored, b: Scored): number =>
  b.score - a.score ||
  String(a.t.createdAt ?? '').localeCompare(String(b.t.createdAt ?? ''))

/**
 * Úkoly bez termínu po prioritách: nejdřív strop pro kritické, pak vysoké,
 * pak nižší. Co vyšší priority nevyčerpají, dobere zbytek podle skóre —
 * jinak by uživatel se samými normálními úkoly dostal jediný návrh.
 */
function cascade(undated: Scored[], limit: number, usedClients: Map<string, number>): Scored[] {
  const out: Scored[] = []
  const used = new Set<Scored>()

  for (const level of LEVELS) {
    let taken = 0
    for (const c of undated) {
      if (out.length >= limit) return out
      if (taken >= UNDATED_CAPS[level]) break
      if (used.has(c) || prio(c.t) !== level || !clientFree(c, usedClients)) continue
      out.push(c)
      used.add(c)
      takeClient(c, usedClients)
      taken++
    }
  }

  for (const c of undated) {
    if (out.length >= limit) break
    if (used.has(c) || !clientFree(c, usedClients)) continue
    out.push(c)
    used.add(c)
    takeClient(c, usedClients)
  }
  return out
}

/**
 * Sestaví návrh dne. Úkoly s termínem mají přednost (jsou opravdu naléhavé),
 * ale pár slotů se drží úkolům bez termínu — bez toho by je nabité dny
 * s termíny vytlačily úplně a nikdy by se nepřipomněly.
 */
export function pickSuggestions(candidates: Scored[]): Scored[] {
  const dated = candidates.filter((c) => eff(c.t)).sort(byScore)
  const undated = candidates.filter((c) => !eff(c.t)).sort(byScore)

  const usedClients = new Map<string, number>()
  const rezerva = Math.min(UNDATED_MIN, undated.length)

  const datedPicked: Scored[] = []
  for (const c of dated) {
    if (datedPicked.length >= TOTAL - rezerva) break
    if (!clientFree(c, usedClients)) continue
    datedPicked.push(c)
    takeClient(c, usedClients)
  }

  const undatedPicked = cascade(
    undated,
    Math.min(UNDATED_MAX, TOTAL - datedPicked.length),
    usedClients,
  )

  return [...datedPicked, ...undatedPicked]
}
