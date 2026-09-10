import { useState } from 'react'
import {
  MONTHS,
  PRESET_LABELS,
  WEEKDAYS,
  partsFromRule,
  ruleFromParts,
  sortByday,
  type RecurrencePreset,
  type RuleParts,
} from '../lib/rrule'

// Dny a stavba pravidla žijí v knihovně (src/lib/rrule.ts) — stejné
// části používá i detail úkolu. Tady zůstává jen ovládání.
export const bydayToSet = (byday: string): Set<string> =>
  new Set(byday.split(',').map((d) => d.trim()).filter(Boolean))

/** Zpátky do pravidla, vždy v pořadí týdne. */
export const setToByday = (dny: Set<string>): string => sortByday(dny).join(',')

const field = 'rounded-lg border border-line bg-card px-3 py-2 text-[16px] outline-none focus:border-accent/60'

function parseInitial(rule: string): RuleParts {
  return partsFromRule(rule) ?? { preset: 'weekly', byday: ['MO'], dom: 1, month: 1 }
}

export function buildRule(preset: RecurrencePreset, byday: string, dom: number, month: number): string {
  return ruleFromParts({ preset, byday: [...bydayToSet(byday)], dom, month })
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
  const [byday, setByday] = useState(init.byday.join(','))
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
