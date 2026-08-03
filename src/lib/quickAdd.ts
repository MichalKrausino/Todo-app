// Parser rychlého zadávání — běží čistě v prohlížeči, bez sítě a bez modelu.
// Rozumí: „ve čtvrtek poslat report @klientx #web !vysoká“, „za 3 dny“,
// „příští týden“, „15.9.“, „15. srpna“, „do pátku“, „víkend“, „koncem měsíce“,
// „každý všední den“, „!!“ (vysoká) / „!!!“ (kritická), poznámka za „//“.
// Funguje i bez diakritiky. Co nepochopí, nechá v názvu úkolu.

import type { Priority } from '../db/types'
import { addDays, nextMonday, toISODate } from './dates'
import { JS_TO_BYDAY } from './rrule'

export interface ClientRef {
  id: string
  name: string
}

export interface ProjectRef {
  id: string
  name: string
  clientId?: string
}

export interface QuickAddParse {
  title: string
  dueDate?: string
  priority: Priority
  clientId?: string
  clientName?: string
  projectId?: string
  projectName?: string
  recurrenceRule?: string
  notes?: string
}

// Normalizace zachovávající délku řetězce (indexy zůstávají zarovnané s originálem),
// aby šlo rozpoznané tokeny vyříznout z původního textu.
const normalizeAligned = (s: string) =>
  s
    .split('')
    .map((c) => (c.normalize('NFD')[0] ?? c).toLowerCase()[0] ?? c)
    .join('')

// Složení jména do porovnatelného tokenu: bez diakritiky, mezer a symbolů.
// Sdílí ho parser i našeptávač v UI.
export const foldToken = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '')

// Jméno ve tvaru vložitelném za @/# — bez mezer a symbolů, diakritika zůstává
// („Klient X“ → „KlientX“; parser si ji pak složí přes foldToken).
export const mentionToken = (name: string) => name.replace(/[^\p{L}\p{N}-]+/gu, '')

const WEEKDAYS: Record<string, number> = {
  pondeli: 1,
  utery: 2,
  streda: 3,
  stredu: 3,
  stredy: 3,
  ctvrtek: 4,
  ctvrtka: 4,
  patek: 5,
  patku: 5,
  sobota: 6,
  sobotu: 6,
  soboty: 6,
  nedele: 0,
  nedeli: 0,
}

const NUM_WORDS: Record<string, number> = {
  jeden: 1,
  dva: 2,
  tri: 3,
  ctyri: 4,
  pet: 5,
  sest: 6,
  sedm: 7,
  osm: 8,
  devet: 9,
  deset: 10,
  dvanact: 12,
  ctrnact: 14,
}

const MONTHS: Record<string, number> = {
  ledna: 1,
  unora: 2,
  brezna: 3,
  dubna: 4,
  kvetna: 5,
  cervna: 6,
  cervence: 7,
  srpna: 8,
  zari: 9,
  rijna: 10,
  listopadu: 11,
  prosince: 12,
}

const PRIORITIES: Record<string, Priority> = {
  kriticka: 'critical',
  critical: 'critical',
  krit: 'critical',
  vysoka: 'high',
  high: 'high',
  nizka: 'low',
  low: 'low',
  normalni: 'normal',
  normal: 'normal',
}

const WD = 'pondeli|utery|stredu|streda|stredy|ctvrtek|ctvrtka|patek|patku|sobotu|sobota|soboty|nedeli|nedele'

const RE_PRIORITY = /(?<=^|\s)!(kriticka|critical|krit|vysoka|high|nizka|low|normalni|normal)(?=$|[\s,.;!?])/
// „!!!“ = kritická, „!!“ = vysoká (zkratka jako v Todoistu)
const RE_BANGS = /(?<=^|\s)(!{2,3})(?=$|[\s,.;])/
const RE_CLIENT = /(?<=^|\s)@([\w-]+)/
const RE_PROJECT = /(?<=^|\s)#([\w-]+)/
const RE_NUMDATE = /(?<=^|\s)(?:do\s+)?(\d{1,2})\.\s?(\d{1,2})\.?(?:\s?(\d{4}))?(?=$|[\s,;])/
const RE_MONTHDATE = new RegExp(
  `(?<=^|\\s)(?:do\\s+)?(\\d{1,2})\\.?\\s?(${Object.keys(MONTHS).join('|')})(?:\\s?(\\d{4}))?(?=$|[\\s,.;])`,
)
const RE_ZA = /(?<=^|\s)za\s+(\d{1,2}|jeden|dva|tri|ctyri|pet|sest|sedm|osm|devet|deset|dvanact|ctrnact)\s+(dny|dni|dnu|den|tydny|tydnu|tyden|mesic|mesice|mesicu)(?=$|[\s,.;])/
const RE_PRISTI_TYDEN = /(?<=^|\s)pristi\s+tyden(?=$|[\s,.;])/
const RE_PRISTI_MESIC = /(?<=^|\s)pristi\s+mesic(?=$|[\s,.;])/
const RE_KONCEM = /(?<=^|\s)koncem\s+(tydne|mesice)(?=$|[\s,.;])/
const RE_VIKEND = /(?<=^|\s)(?:(pristi)\s+)?(?:(?:o|na)\s+)?vikendu?(?=$|[\s,.;])/
const RE_WEEKDAY = new RegExp(`(?<=^|\\s)(?:(pristi)\\s+)?(?:(?:ve?|do)\\s+)?(${WD})(?=$|[\\s,.;])`)
const RE_RELWORD = /(?<=^|\s)(dneska|dnes|zejtra|zitra|pozitri)(?=$|[\s,.;])/
// „každý pátek", „každé pondělí a čtvrtek", „každý všední den",
// „každý den/týden/měsíc/rok", „každých 14 dní", „každé 2 týdny"
const RE_RECUR = new RegExp(
  `(?<=^|\\s)kazd(?:y|a|e|ou|ych)\\s+(?:(den|tyden|mesic|rok)|(\\d{1,2})\\s+(dni|dny|dnu|tydny|tydnu|mesice|mesicu)|(vsedni|pracovni)\\s+den|((?:${WD})(?:\\s+a\\s+(?:${WD}))*))(?=$|[\\s,.;])`,
)
// poznámka: všechno za „ //“ (mezera chrání URL typu https://…)
const RE_NOTES = /(^|\s)\/\/\s?/

type DateHit = { iso: string; start: number; end: number }
type RecurHit = { rule: string; dueDate: string; start: number; end: number }

// Nejbližší výskyt dne v týdnu, dnešek se počítá.
const nearestDow = (today: Date, dow: number) => addDays(today, (dow - today.getDay() + 7) % 7)

// Rozpoznání opakování. Termín úkolu je první výskyt (dnešek se počítá).
function parseRecurrence(norm: string, today: Date): RecurHit | null {
  const m = RE_RECUR.exec(norm)
  if (!m) return null
  const span = { start: m.index, end: m.index + m[0].length }
  const todayISO = toISODate(today)

  if (m[5]) {
    // každý <den v týdnu>, případně výčet „a“ — BYDAY seznam
    const days = [...new Set(m[5].split(/\s+a\s+/).map((w) => WEEKDAYS[w]))]
    days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) // od pondělí, jen kosmetika
    const due = days
      .map((d) => nearestDow(today, d))
      .reduce((a, b) => (toISODate(a) <= toISODate(b) ? a : b))
    return {
      rule: `FREQ=WEEKLY;BYDAY=${days.map((d) => JS_TO_BYDAY[d]).join(',')}`,
      dueDate: toISODate(due),
      ...span,
    }
  }

  if (m[4]) {
    // každý všední/pracovní den
    const dow = today.getDay()
    const due = dow === 0 || dow === 6 ? nearestDow(today, 1) : today
    return { rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', dueDate: toISODate(due), ...span }
  }

  if (m[2]) {
    // každých N dní/týdnů/měsíců
    const n = Number(m[2])
    const unit = m[3]
    let rule: string
    if (unit.startsWith('tyd')) {
      rule = `FREQ=WEEKLY;INTERVAL=${n};BYDAY=${JS_TO_BYDAY[today.getDay()]}`
    } else if (unit.startsWith('mesic')) {
      rule = `FREQ=MONTHLY;INTERVAL=${n};BYMONTHDAY=${today.getDate()}`
    } else {
      rule = n === 1 ? 'FREQ=DAILY' : `FREQ=DAILY;INTERVAL=${n}`
    }
    return { rule, dueDate: todayISO, ...span }
  }

  // každý den/týden/měsíc/rok
  const rule =
    m[1] === 'den'
      ? 'FREQ=DAILY'
      : m[1] === 'tyden'
        ? `FREQ=WEEKLY;BYDAY=${JS_TO_BYDAY[today.getDay()]}`
        : m[1] === 'mesic'
          ? `FREQ=MONTHLY;BYMONTHDAY=${today.getDate()}`
          : `FREQ=YEARLY;BYMONTH=${today.getMonth() + 1};BYMONTHDAY=${today.getDate()}`
  return { rule, dueDate: todayISO, ...span }
}

function parseDate(norm: string, today: Date): DateHit | null {
  let m = RE_NUMDATE.exec(norm)
  if (m) {
    const day = Number(m[1])
    const month = Number(m[2])
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const year = m[3] ? Number(m[3]) : today.getFullYear()
      let d = new Date(year, month - 1, day)
      // Datum bez roku, které už letos proběhlo, znamená příští rok.
      if (!m[3] && toISODate(d) < toISODate(today)) d = new Date(year + 1, month - 1, day)
      return { iso: toISODate(d), start: m.index, end: m.index + m[0].length }
    }
  }

  m = RE_MONTHDATE.exec(norm)
  if (m) {
    const day = Number(m[1])
    if (day >= 1 && day <= 31) {
      const month = MONTHS[m[2]]
      const year = m[3] ? Number(m[3]) : today.getFullYear()
      let d = new Date(year, month - 1, day)
      if (!m[3] && toISODate(d) < toISODate(today)) d = new Date(year + 1, month - 1, day)
      return { iso: toISODate(d), start: m.index, end: m.index + m[0].length }
    }
  }

  m = RE_ZA.exec(norm)
  if (m) {
    const n = NUM_WORDS[m[1]] ?? Number(m[1])
    let d: Date
    if (m[2].startsWith('mesic')) {
      d = new Date(today.getFullYear(), today.getMonth() + n, today.getDate())
    } else {
      d = addDays(today, n * (m[2].startsWith('tyd') ? 7 : 1))
    }
    return { iso: toISODate(d), start: m.index, end: m.index + m[0].length }
  }

  m = RE_PRISTI_TYDEN.exec(norm)
  if (m) {
    return { iso: toISODate(nextMonday(today)), start: m.index, end: m.index + m[0].length }
  }

  m = RE_PRISTI_MESIC.exec(norm)
  if (m) {
    const d = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    return { iso: toISODate(d), start: m.index, end: m.index + m[0].length }
  }

  m = RE_KONCEM.exec(norm)
  if (m) {
    const d =
      m[1] === 'tydne'
        ? nearestDow(today, 5) // pátek
        : new Date(today.getFullYear(), today.getMonth() + 1, 0) // poslední den měsíce
    return { iso: toISODate(d), start: m.index, end: m.index + m[0].length }
  }

  m = RE_VIKEND.exec(norm)
  if (m) {
    // sobota; „příští víkend“ = sobota příštího týdne
    const d = m[1] ? addDays(nextMonday(today), 5) : nearestDow(today, 6)
    return { iso: toISODate(d), start: m.index, end: m.index + m[0].length }
  }

  m = RE_WEEKDAY.exec(norm)
  if (m) {
    const dow = WEEKDAYS[m[2]]
    // „příští pátek“ = pátek příštího týdne; jinak nejbližší výskyt
    const d = m[1] ? addDays(nextMonday(today), (dow + 6) % 7) : nearestDow(today, dow)
    return { iso: toISODate(d), start: m.index, end: m.index + m[0].length }
  }

  m = RE_RELWORD.exec(norm)
  if (m) {
    const offset = { dneska: 0, dnes: 0, zejtra: 1, zitra: 1, pozitri: 2 }[m[1]] ?? 0
    return { iso: toISODate(addDays(today, offset)), start: m.index, end: m.index + m[0].length }
  }

  return null
}

function matchClient(token: string, clients: ClientRef[]): ClientRef | null {
  let best: ClientRef | null = null
  for (const c of clients) {
    const n = foldToken(c.name)
    if (n === token) return c
    if (!best && (n.startsWith(token) || token.startsWith(n))) best = c
  }
  return best
}

// Projekt se hledá nejdřív u zadaného klienta, pak kdekoli.
function matchProject(token: string, projects: ProjectRef[], clientId?: string): ProjectRef | null {
  const pools = clientId
    ? [projects.filter((p) => p.clientId === clientId), projects]
    : [projects]
  for (const pool of pools) {
    let best: ProjectRef | null = null
    for (const p of pool) {
      const n = foldToken(p.name)
      if (n === token) return p
      if (!best && (n.startsWith(token) || token.startsWith(n))) best = p
    }
    if (best) return best
  }
  return null
}

function removeSpans(s: string, spans: Array<[number, number]>): string {
  if (!spans.length) return s
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  let out = ''
  let pos = 0
  for (const [a, b] of sorted) {
    out += s.slice(pos, a)
    pos = Math.max(pos, b)
  }
  out += s.slice(pos)
  return out
}

// Položka šablony stejným jazykem jako rychlé zadávání:
// „každé pondělí kontrola kampaní !vysoká #PPC". Šablona je nezávislá
// na klientovi, takže #token je volný název projektu (ne párování).
// Bez opakování vrací recurrenceRule undefined — UI si řekne o doplnění.
export interface TemplateItemParse {
  title: string
  recurrenceRule?: string
  priority: Priority
  projectName?: string
}

export function parseTemplateItem(input: string, today: Date = new Date()): TemplateItemParse {
  let projectName: string | undefined
  const pm = RE_PROJECT.exec(normalizeAligned(input))
  if (pm) {
    projectName = input.slice(pm.index + 1, pm.index + pm[0].length)
    input = `${input.slice(0, pm.index)} ${input.slice(pm.index + pm[0].length)}`
  }
  const r = parseQuickAdd(input, [], today, [])
  return { title: r.title, recurrenceRule: r.recurrenceRule, priority: r.priority, projectName }
}

export function parseQuickAdd(
  input: string,
  clients: ClientRef[],
  today: Date = new Date(),
  projects: ProjectRef[] = [],
): QuickAddParse {
  // Poznámka se odřízne z originálu jako první — v ní se už nic neparsuje.
  let notes: string | undefined
  const nm = RE_NOTES.exec(input)
  if (nm) {
    notes = input.slice(nm.index + nm[0].length).trim() || undefined
    input = input.slice(0, nm.index)
  }

  const norm = normalizeAligned(input)
  const spans: Array<[number, number]> = []

  let priority: Priority = 'normal'
  const pm = RE_PRIORITY.exec(norm)
  if (pm) {
    priority = PRIORITIES[pm[1]]
    spans.push([pm.index, pm.index + pm[0].length])
  } else {
    const bm = RE_BANGS.exec(norm)
    if (bm) {
      priority = bm[1].length >= 3 ? 'critical' : 'high'
      spans.push([bm.index, bm.index + bm[0].length])
    }
  }

  let clientId: string | undefined
  let clientName: string | undefined
  const cm = RE_CLIENT.exec(norm)
  if (cm) {
    const match = matchClient(cm[1], clients)
    if (match) {
      clientId = match.id
      clientName = match.name
      spans.push([cm.index, cm.index + cm[0].length])
    }
  }

  let projectId: string | undefined
  let projectName: string | undefined
  const prm = RE_PROJECT.exec(norm)
  if (prm) {
    const match = matchProject(prm[1], projects, clientId)
    if (match) {
      projectId = match.id
      projectName = match.name
      spans.push([prm.index, prm.index + prm[0].length])
      // Projekt bez zadaného klienta klienta doplní — úkol nespadne mimo.
      if (!clientId && match.clientId) {
        clientId = match.clientId
        clientName = clients.find((c) => c.id === match.clientId)?.name
      }
    }
  }

  let dueDate: string | undefined
  let recurrenceRule: string | undefined
  const rm = parseRecurrence(norm, today)
  if (rm) {
    recurrenceRule = rm.rule
    dueDate = rm.dueDate
    spans.push([rm.start, rm.end])
  } else {
    const dm = parseDate(norm, today)
    if (dm) {
      dueDate = dm.iso
      spans.push([dm.start, dm.end])
    }
  }

  const title = removeSpans(input, spans)
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[,;\s]+|[,;\s]+$/g, '')

  return { title, dueDate, priority, clientId, clientName, projectId, projectName, recurrenceRule, notes }
}
