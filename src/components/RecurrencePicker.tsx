import { useState } from 'react'
import { PRESET_LABELS, type RecurrencePreset } from '../lib/rrule'

// Pořadí je zároveň kanonické pořadí v pravidle: „MO,TH", ne „TH,MO".
const WEEKDAYS: Array<[string, string]> = [
  ['MO', 'po'],
  ['TU', 'út'],
  ['WE', 'st'],
  ['TH', 'čt'],
  ['FR', 'pá'],
  ['SA', 'so'],
  ['SU', 'ne'],
]

/** Dny z pravidla („MO,TH") na množinu kódů. */
export const bydayToSet = (byday: string): Set<string> =>
  new Set(byday.split(',').map((d) => d.trim()).filter(Boolean))

/** Zpátky do pravidla, vždy v pořadí týdne. */
export const setToByday = (dny: Set<string>): string =>
  WEEKDAYS.map(([kod]) => kod).filter((kod) => dny.has(kod)).join(',')

const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']

const field = 'rounded-lg border border-line bg-card px-3 py-2 text-[16px] outline-none focus:border-accent/60'

function parseInitial(rule: string) {
  const get = (key: string) => new RegExp(`${key}=([^;]+)`).exec(rule)?.[1]
  const freq = get('FREQ')
  const interval = Number(get('INTERVAL') ?? '1')
  const byday = get('BYDAY') ?? 'MO'
  const dom = Number(get('BYMONTHDAY') ?? '1')
  const month = Number(get('BYMONTH') ?? '1')
  let preset: RecurrencePreset = 'weekly'
  if (freq === 'DAILY') preset = 'daily'
  else if (freq === 'WEEKLY') preset = interval === 2 ? 'biweekly' : 'weekly'
  else if (freq === 'MONTHLY') preset = interval === 3 ? 'quarterly' : 'monthly'
  else if (freq === 'YEARLY') preset = 'yearly'
  return { preset, byday, dom, month }
}

export function buildRule(preset: RecurrencePreset, byday: string, dom: number, month: number): string {
  switch (preset) {
    case 'daily':
      return 'FREQ=DAILY'
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${byday}`
    case 'biweekly':
      return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${byday}`
    case 'monthly':
      return `FREQ=MONTHLY;BYMONTHDAY=${dom}`
    case 'quarterly':
      return `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${dom}`
    case 'yearly':
      return `FREQ=YEARLY;BYMONTH=${month};BYMONTHDAY=${dom}`
  }
}

export function RecurrencePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (rule: string) => void
}) {
  const init = parseInitial(value)
  const [preset, setPreset] = useState<RecurrencePreset>(init.preset)
  const [byday, setByday] = useState(init.byday)
  const [dom, setDom] = useState(init.dom)
  const [month, setMonth] = useState(init.month)

  const emit = (p: RecurrencePreset, bd: string, d: number, mo: number) => {
    onChange(buildRule(p, bd, d, mo))
  }

  return (
    <div className="flex flex-wrap gap-2">
      <select
        className={field}
        value={preset}
        onChange={(e) => {
          const p = e.target.value as RecurrencePreset
          setPreset(p)
          emit(p, byday, dom, month)
        }}
      >
        {(Object.keys(PRESET_LABELS) as RecurrencePreset[]).map((p) => (
          <option key={p} value={p}>
            {PRESET_LABELS[p]}
          </option>
        ))}
      </select>

      {(preset === 'weekly' || preset === 'biweekly') && (
        // Přepínače, ne rozbalovátko: pravidlo umí víc dnů naráz („po, čt")
        // a select uměl ukázat jen jeden — u šablony z galerie tak svítilo
        // „pondělí" u pravidla na pondělí a čtvrtek a první dotyk ten
        // čtvrtek zahodil. Navíc se den vybere jedním ťuknutím.
        <div className="flex w-full items-center gap-1" role="group" aria-label="Dny v týdnu">
          {WEEKDAYS.map(([code, label]) => {
            const vybrany = bydayToSet(byday).has(code)
            return (
              <button
                key={code}
                type="button"
                aria-pressed={vybrany}
                onClick={() => {
                  const dny = bydayToSet(byday)
                  if (dny.has(code)) dny.delete(code)
                  else dny.add(code)
                  // Aspoň jeden den musí zůstat — bez něj pravidlo nedává smysl.
                  if (dny.size === 0) return
                  const dalsi = setToByday(dny)
                  setByday(dalsi)
                  emit(preset, dalsi, dom, month)
                }}
                className={`h-10 flex-1 rounded-lg text-[13px] font-medium transition-transform duration-150 active:scale-95 ${
                  vybrany ? 'bg-accent text-card' : 'bg-well text-ink-soft'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {(preset === 'monthly' || preset === 'quarterly' || preset === 'yearly') && (
        <select
          className={field}
          value={dom}
          onChange={(e) => {
            const d = Number(e.target.value)
            setDom(d)
            emit(preset, byday, d, month)
          }}
        >
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}. den
            </option>
          ))}
        </select>
      )}

      {preset === 'yearly' && (
        <select
          className={field}
          value={month}
          onChange={(e) => {
            const mo = Number(e.target.value)
            setMonth(mo)
            emit(preset, byday, dom, mo)
          }}
        >
          {MONTHS.map((label, i) => (
            <option key={label} value={i + 1}>
              {label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
