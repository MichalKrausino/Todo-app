// Nastavení klienta — jeden panel místo pěti sekcí na obrazovce.
//
// Detail klienta dřív skládal pod sebe napojení na Todoist, šablony,
// hlídání, sdílení a mazání — samá nastavení, která se nastaví jednou
// a pak se na ně nesahá, a přitom stála mezi polem pro nový úkol a
// seznamem, do kterého úkol padá. Obrazovka je teď práce; co je
// nastavení, bydlí tady, na jedno ťuknutí za chipem „Upravit".
//
// Všechno se ukládá hned (jméno při opuštění pole) — je to nastavení,
// ne rozepsaný formulář, který by se dal zahodit.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Client, ClientKind, Task } from '../db/types'
import { removeClient, restoreDeleted, updateClient } from '../db/repo'
import { activeTemplates, deployTemplate, undeployTemplate } from '../db/templates'
import {
  checkFrequencyOf,
  setClientCheck,
  type CheckFrequency,
} from '../db/clientCheck'
import { COLOR_NAMES, KIND_LABELS, plural } from '../lib/labels'
import { formatDayLabel, formatDaysAgo } from '../lib/dates'
import { nabidniVraceni } from '../lib/toast'
import { ClientSharing } from './ClientSharing'
import { ColorPicker } from './ColorPicker'
import { Sheet } from './Sheet'
import { Button } from './ui/Button'
import { Switch } from './ui/Switch'
import { AnimatedBackground } from './ui/AnimatedBackground'

const row = 'flex items-center justify-between gap-3 px-4 py-3'
const seg =
  'relative flex-1 rounded-full px-2 py-2 text-[13px] font-medium text-ink-soft transition-colors duration-200 data-[checked=true]:text-ink'

// Přepínač s pilulkou, která mezi volbami plyne (AnimatedBackground).
// Stejný prvek jako Priorita / Klient na Dnes a vzhled v nastavení.
function Prepinac<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: Array<[T, string]>
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-full bg-card p-1 shadow-card">
      <AnimatedBackground value={value} onValueChange={(id) => onChange(id as T)} className="rounded-full bg-well">
        {options.map(([id, text]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} data-id={id} className={seg}>
            {text}
          </button>
        ))}
      </AnimatedBackground>
    </div>
  )
}

export function KlientSheet({
  client,
  checkTask,
  todoistCount,
  onClose,
  onDeleted,
}: {
  client: Client
  checkTask: Task | undefined
  todoistCount: number
  onClose: () => void
  /** po smazání — obrazovka detailu se vrací na seznam */
  onDeleted: () => void
}) {
  const templates = useLiveQuery(activeTemplates, []) ?? []
  const [draftName, setDraftName] = useState(client.name)
  const [pickingColor, setPickingColor] = useState(false)
  const id = client.id

  const saveName = () => {
    const name = draftName.trim()
    if (!name) {
      setDraftName(client.name)
      return
    }
    if (name !== client.name) void updateClient(id, { name })
  }

  const setWatch = (value: string) => {
    const n = Number(value)
    void updateClient(id, { checkIntervalDays: n > 0 ? n : undefined })
  }

  // Bez ptaní, ale vratně. Systémový `confirm()` rozbíjel dojem nativní
  // appky a stejně nechrání — kdo ho vidí pokaždé, odklepne ho po očku.
  const del = async (close: () => void) => {
    const jmeno = client.name
    const plan = await removeClient(id)
    close()
    onDeleted()
    const pocet = plan.tasks?.length ?? 0
    nabidniVraceni(
      pocet
        ? `Smazán „${jmeno}" a ${pocet} ${plural(pocet, 'úkol', 'úkoly', 'úkolů')}`
        : `Smazán „${jmeno}"`,
      () => restoreDeleted(plan),
    )
  }

  const napojenTodoist = (client.todoistProjectIds?.length ?? 0) > 0
  const kontrola = checkFrequencyOf(checkTask) ?? 'off'

  return (
    <Sheet onClose={onClose} tone="paper" className="space-y-5">
      {(close) => (
        <>
          <header>
            <h2 className="text-lg font-bold">Nastavení klienta</h2>
            <p className="text-sm text-ink-soft">
              {KIND_LABELS[client.kind]}
              {client.status === 'archived' && ' · archivovaný'}
            </p>
          </header>

          {/* Jméno a barva jsou v seznamu jedna věc — tečka a text vedle
              ní — tak stojí vedle sebe i tady. Paleta se rozbalí ťuknutím
              na tečku; appka barvu přidělila sama a měnit ji má smysl
              jen výjimečně. */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPickingColor((v) => !v)}
                aria-label={`Barva klienta: ${COLOR_NAMES[client.color] ?? client.color}`}
                aria-expanded={pickingColor}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-card shadow-card transition-transform duration-150 active:scale-90"
              >
                <span className="h-5 w-5 rounded-full" style={{ background: client.color }} />
              </button>
              <input
                value={draftName}
                aria-label="Jméno klienta"
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                }}
                className="min-w-0 flex-1 rounded-full bg-card px-4 py-2.5 text-[16px] font-medium text-ink shadow-card outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              />
            </div>
            {pickingColor && (
              <div className="rounded-2xl bg-card px-3 shadow-card">
                <ColorPicker
                  value={client.color}
                  onPick={(c) => {
                    void updateClient(id, { color: c })
                    setPickingColor(false)
                  }}
                />
              </div>
            )}
            <Prepinac<ClientKind>
              label="Druh"
              value={client.kind}
              options={(Object.keys(KIND_LABELS) as ClientKind[]).map((k) => [k, KIND_LABELS[k]])}
              onChange={(kind) => void updateClient(id, { kind })}
            />
          </section>

          <section className="space-y-2">
            <h3 className="section-label">hlídání</h3>
            <div className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
              <div className="space-y-2.5 px-4 py-3">
                <div className="text-sm">
                  <div className="font-medium">Pravidelná kontrola</div>
                  <div className="text-xs text-ink-soft">
                    {checkTask?.dueDate
                      ? `Příště ${formatDayLabel(checkTask.dueDate).toLowerCase()} · úkol se sám vrací na Dnes`
                      : 'Úkol „Zkontrolovat klienta" se sám vrací na Dnes'}
                  </div>
                </div>
                <Prepinac<CheckFrequency | 'off'>
                  label="Pravidelná kontrola"
                  value={kontrola}
                  options={[
                    ['off', 'Vypnuto'],
                    ['weekly', 'Týdně'],
                    ['biweekly', '2 týdny'],
                    ['monthly', 'Měsíčně'],
                  ]}
                  onChange={(f) => void setClientCheck(client, f === 'off' ? null : f)}
                />
              </div>
              <div className={row}>
                <div className="min-w-0 text-sm">
                  <div className="font-medium">Hlídat zanedbání</div>
                  <div className="text-xs text-ink-soft">
                    {client.lastActivityAt
                      ? `Poslední aktivita ${formatDaysAgo(client.lastActivityAt)}`
                      : 'Zatím žádná aktivita'}
                  </div>
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-sm text-ink-soft">
                  po
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    aria-label="Hlídat zanedbání po dnech"
                    defaultValue={client.checkIntervalDays ?? ''}
                    placeholder="14"
                    onBlur={(e) => setWatch(e.target.value)}
                    className="h-9 w-14 rounded-full bg-well text-center text-[15px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  />
                  dnech
                </label>
              </div>
            </div>
          </section>

          {templates.length > 0 && (
            <section className="space-y-2">
              <h3 className="section-label">šablony</h3>
              <div className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
                {templates.map((t) => {
                  const on = client.templateIds.includes(t.id)
                  return (
                    <div key={t.id} className={row}>
                      <div className="min-w-0 text-sm">
                        <div className="truncate font-medium">{t.name}</div>
                        <div className="text-xs text-ink-soft">
                          {t.items.length} {plural(t.items.length, 'pravidelný úkol', 'pravidelné úkoly', 'pravidelných úkolů')}
                        </div>
                      </div>
                      <Switch
                        checked={on}
                        aria-label={`Šablona ${t.name}`}
                        onCheckedChange={(v) =>
                          void (v ? deployTemplate(id, t.id) : undeployTemplate(id, t.id))
                        }
                      />
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Napojení na Todoist patří k tomuhle klientovi — do nastavení
              appky kvůli jednomu klientovi nikdo lézt nebude. */}
          {napojenTodoist && (
            <section className="space-y-2">
              <h3 className="section-label">todoist</h3>
              <div className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
                <div className={row}>
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">Nové úkoly zakládat i v Todoistu</div>
                    <div className="text-xs text-ink-soft">
                      Klient je uvidí ve sdíleném projektu
                      {todoistCount > 0 &&
                        ` · ${todoistCount} ${plural(todoistCount, 'úkol', 'úkoly', 'úkolů')} odtamtud`}
                    </div>
                  </div>
                  <Switch
                    checked={Boolean(client.todoistPushSince)}
                    aria-label="Nové úkoly zakládat i v Todoistu"
                    onCheckedChange={(v) =>
                      void updateClient(id, { todoistPushSince: v ? new Date().toISOString() : undefined })
                    }
                  />
                </div>
              </div>
            </section>
          )}

          <ClientSharing clientId={id} />

          <footer className="flex items-center gap-2 pt-1">
            <Button
              variant="secondary"
              onClick={() => void updateClient(id, { status: client.status === 'archived' ? 'active' : 'archived' })}
            >
              {client.status === 'archived' ? 'Obnovit' : 'Archivovat'}
            </Button>
            <Button variant="destructive" onClick={() => void del(close)}>
              Smazat klienta
            </Button>
          </footer>
        </>
      )}
    </Sheet>
  )
}
