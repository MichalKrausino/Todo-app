// Parser rychlého zadávání — běží čistě v prohlížeči, bez sítě a bez modelu.
// Rozumí: „ve čtvrtek poslat report @klientx !vysoká“, „za 3 dny“, „příští týden“,
// „15.9.“, „zítra“… Funguje i bez diakritiky. Co nepochopí, nechá v názvu úkolu.

import type { Priority } from '../db/types'
import { addDays, nextMonday, toISODate } from './dates'
import { JS_TO_BYDAY } from './rrule'

export interface ClientRef {
  id: string
  name: string
}

export interface QuickAddParse {
  title: string
  dueDate?: string
  priority: Priority
  clientId?: string
  clientName?: string
  recurrenceRule?: string
}

// Normalizace zachovávající délku řetězce (indexy zůstávají zarovnané s originálem),
// aby šlo rozpoznané tokeny vyříznout z původního textu.
const normalizeAligned = (s: string) =>
  s
    .split('')
    .map((c) => (c.normalize('NFD')[0] ?? c).toLowerCase()[0] ?? c)
    .join('')

const WEEKDAYS: Record<string, number> = {
  pondeli: 1,
  utery: 2,
  streda: 3,
  stredu: 3,
  ctvrtek: 4,
  patek: 5,
  sobota: 6,
  sobotu: 6,
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

const RE_PRIORITY = /(?<=^|\s)!(kriticka|critical|krit|vysoka|high|nizka|low|normalni|normal)(?=$|[\s,.;!?])/
const RE_CLIENT = /(?<=^|\s)@([\w-]+)/
const RE_NUMDATE = /(?<=^|\s)(\d{1,2})\.\s?(\d{1,2})\.?(?:\s?(\d{4}))?(?=$|[\s,;])/
const RE_ZA = /(?<=^|\s)za\s+(\d{1,2}|jeden|dva|tri|ctyri|pet|sest|sedm|osm|devet|deset|dvanact|ctrnact)\s+(dny|dni|dnu|den|tydny|tydnu|tyden)(?=$|[\s,.;])/
const RE_PRISTI_TYDEN = /(?<=^|\s)pristi\s+tyden(?=$|[\s,.;])/
const RE_WEEKDAY = /(?<=^|\s)(?:(pristi)\s+)?(?:ve?\s+)?(pondeli|utery|stredu|streda|ctvrtek|patek|sobotu|sobota|nedeli|nedele)(?=$|[\s,.;])/
const RE_RELWORD = /(?<=^|\s)(dnes|zitra|pozitri)(?=$|[\s,.;])/
// „každý pátek", „každý den/týden/měsíc/rok", „každých 14 dní", „každé 2 týdny"
const RE_RECUR = /(?<=^|\s)kazd(?:y|a|e|ou|ych)\s+(?:(den|tyden|mesic|rok)|(\d{1,2})\s+(dni|dny|dnu|tydny|tydnu|mesice|mesicu)|(pondeli|utery|stredu|streda|ctvrtek|patek|sobotu|sobota|nedeli|nedele))(?=$|[\s,.;])/

type DateHit = { iso: string; start: number; end: number }
type RecurHit = { rule: string; dueDate: string; start: number; end: number }

// Rozpoznání opakování. Termín úkolu je první výskyt (dnešek se počítá).
function parseRecurrence(norm: string, today: Date): RecurHit | null {
  const m = RE_RECUR.exec(norm)
  if (!m) return null
  const span = { start: m.index, end: m.index + m[0].length }
  const todayISO = toISODate(today)

  if (m[4]) {
    // každý <den v týdnu>
    const dow = WEEKDAYS[m[4]]
    const due = addDays(today, (dow - today.getDay() + 7) % 7)
    return { rule: `FREQ=WEEKLY;BYDAY=${JS_TO_BYDAY[dow]}`, dueDate: toISODate(due), ...span }
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

  m = RE_ZA.exec(norm)
  if (m) {
    const n = NUM_WORDS[m[1]] ?? Number(m[1])
    const mult = m[2].startsWith('tyd') ? 7 : 1
    return { iso: toISODate(addDays(today, n * mult)), start: m.index, end: m.index + m[0].length }
  }

  m = RE_PRISTI_TYDEN.exec(norm)
  if (m) {
    return { iso: toISODate(nextMonday(today)), start: m.index, end: m.index + m[0].length }
  }

  m = RE_WEEKDAY.exec(norm)
  if (m) {
    const dow = WEEKDAYS[m[2]]
    let d: Date
    if (m[1]) {
      // „příští pátek“ = pátek příštího týdne
      d = addDays(nextMonday(today), (dow + 6) % 7)
    } else {
      // nejbližší výskyt, dnešek se počítá
      d = addDays(today, (dow - today.getDay() + 7) % 7)
    }
    return { iso: toISODate(d), start: m.index, end: m.index + m[0].length }
  }

  m = RE_RELWORD.exec(norm)
  if (m) {
    const offset = { dnes: 0, zitra: 1, pozitri: 2 }[m[1]] ?? 0
    return { iso: toISODate(addDays(today, offset)), start: m.index, end: m.index + m[0].length }
  }

  return null
}

function matchClient(token: string, clients: ClientRef[]): ClientRef | null {
  let best: ClientRef | null = null
  for (const c of clients) {
    const n = normalizeAligned(c.name).replace(/\s+/g, '')
    if (n === token) return c
    if (!best && (n.startsWith(token) || token.startsWith(n))) best = c
  }
  return best
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

export function parseQuickAdd(
  input: string,
  clients: ClientRef[],
  today: Date = new Date(),
): QuickAddParse {
  const norm = normalizeAligned(input)
  const spans: Array<[number, number]> = []

  let priority: Priority = 'normal'
  const pm = RE_PRIORITY.exec(norm)
  if (pm) {
    priority = PRIORITIES[pm[1]]
    spans.push([pm.index, pm.index + pm[0].length])
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

  return { title, dueDate, priority, clientId, clientName, recurrenceRule }
}
