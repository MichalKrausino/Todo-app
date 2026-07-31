// Obálka nad knihovnou rrule pro denní přesnost (YYYY-MM-DD).
// Počítá se výhradně v UTC poledne — výsledky jsou deterministické na všech
// zařízeních (žádné posuny přes půlnoc kvůli časovým pásmům).

import { RRule } from 'rrule'
import type { Options } from 'rrule'

// Pevná kotva pro pravidla šablon s INTERVAL > 1 (např. „každé 2 týdny",
// „čtvrtletně"). 2024-01-01 bylo pondělí a leden ⇒ kvartály leden/duben/
// červenec/říjen. Díky pevné kotvě generují všechna zařízení stejné dny.
export const RULE_EPOCH = '2024-01-01'

const pad = (n: number) => `${n}`.padStart(2, '0')

const toUTC = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

const fromUTC = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

function buildRule(ruleStr: string, anchorISO: string): RRule {
  const opts = RRule.parseString(ruleStr)
  opts.dtstart = toUTC(anchorISO)
  return new RRule(opts)
}

// Všechny výskyty v intervalu <fromISO, toISO> (včetně krajů).
export function occurrencesBetween(
  ruleStr: string,
  anchorISO: string,
  fromISO: string,
  toISO: string,
): string[] {
  return buildRule(ruleStr, anchorISO).between(toUTC(fromISO), toUTC(toISO), true).map(fromUTC)
}

// Nejbližší výskyt PO daném dni (exkluzivně), nebo null.
export function nextOccurrence(ruleStr: string, anchorISO: string, afterISO: string): string | null {
  const d = buildRule(ruleStr, anchorISO).after(toUTC(afterISO), false)
  return d ? fromUTC(d) : null
}

// --- Stavění pravidel z předvoleb (sdílené UI i parserem) ---

// JS getDay() → iCal BYDAY kód
export const JS_TO_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

// rrule čísluje dny 0=PO..6=NE
const RRULE_DAY_LABELS = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'] as const

export type RecurrencePreset = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'

export const PRESET_LABELS: Record<RecurrencePreset, string> = {
  daily: 'Denně',
  weekly: 'Týdně',
  biweekly: 'Každé 2 týdny',
  monthly: 'Měsíčně',
  quarterly: 'Čtvrtletně',
  yearly: 'Ročně',
}

// Pravidlo z předvolby vztažené ke konkrétnímu dni (pro úkoly: den = termín).
export function ruleFromPreset(preset: RecurrencePreset, dateISO: string): string {
  const [, m, d] = dateISO.split('-').map(Number)
  const byday = JS_TO_BYDAY[toUTC(dateISO).getUTCDay()]
  switch (preset) {
    case 'daily':
      return 'FREQ=DAILY'
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${byday}`
    case 'biweekly':
      return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${byday}`
    case 'monthly':
      return `FREQ=MONTHLY;BYMONTHDAY=${d}`
    case 'quarterly':
      return `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${d}`
    case 'yearly':
      return `FREQ=YEARLY;BYMONTH=${m};BYMONTHDAY=${d}`
  }
}

// Zpětné rozpoznání předvolby (pro select v editaci úkolu).
export function presetFromRule(ruleStr: string): RecurrencePreset | 'custom' {
  let o: Partial<Options>
  try {
    o = RRule.parseString(ruleStr)
  } catch {
    return 'custom'
  }
  const interval = o.interval ?? 1
  if (o.freq === RRule.DAILY) return interval === 1 ? 'daily' : 'custom'
  if (o.freq === RRule.WEEKLY) {
    if (interval === 1) return 'weekly'
    if (interval === 2) return 'biweekly'
    return 'custom'
  }
  if (o.freq === RRule.MONTHLY) {
    if (interval === 1) return 'monthly'
    if (interval === 3) return 'quarterly'
    return 'custom'
  }
  if (o.freq === RRule.YEARLY) return interval === 1 ? 'yearly' : 'custom'
  return 'custom'
}

const dayNumber = (v: unknown): number =>
  typeof v === 'number' ? v : (v as { weekday: number }).weekday

// Krátký český popis pravidla, např. „každé 2 týdny (pá)", „měsíčně 15."
export function humanizeRule(ruleStr: string): string {
  let o: Partial<Options>
  try {
    o = RRule.parseString(ruleStr)
  } catch {
    return ruleStr
  }
  const interval = o.interval ?? 1
  const byday = Array.isArray(o.byweekday)
    ? o.byweekday.map((w) => RRULE_DAY_LABELS[dayNumber(w)]).join(', ')
    : undefined
  const dom = Array.isArray(o.bymonthday) ? o.bymonthday[0] : o.bymonthday

  if (o.freq === RRule.DAILY) return interval === 1 ? 'denně' : `každé ${interval} dny`
  if (o.freq === RRule.WEEKLY) {
    const day = byday ? ` (${byday})` : ''
    if (interval === 1) return `týdně${day}`
    if (interval === 2) return `každé 2 týdny${day}`
    return `každé ${interval} týdny${day}`
  }
  if (o.freq === RRule.MONTHLY) {
    const day = dom ? ` ${dom}.` : ''
    if (interval === 1) return `měsíčně${day}`
    if (interval === 3) return `čtvrtletně${day}`
    return `každé ${interval} měsíce${day}`
  }
  if (o.freq === RRule.YEARLY) {
    const month = Array.isArray(o.bymonth) ? o.bymonth[0] : o.bymonth
    return dom && month ? `ročně ${dom}. ${month}.` : 'ročně'
  }
  return ruleStr
}
