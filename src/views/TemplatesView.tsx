import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Client, Priority, Template, TemplateItem } from '../db/types'
import { allClients } from '../db/repo'
import {
  activeTemplates,
  addTemplate,
  deployTemplate,
  duplicateTemplate,
  newTemplateItem,
  removeTemplate,
  undeployTemplate,
  updateTemplate,
} from '../db/templates'
import { addDays, formatDayLabel, fromISODate, toISODate, todayISO } from '../lib/dates'
import { PRIORITY_LABELS } from '../lib/labels'
import { parseTemplateItem } from '../lib/quickAdd'
import { RULE_EPOCH, humanizeRule, occurrencesBetween } from '../lib/rrule'
import { TEMPLATE_GALLERY } from '../lib/templateGallery'
import { RecurrencePicker, buildRule } from '../components/RecurrencePicker'

const field = 'w-full rounded-lg border border-line bg-card px-3 py-2 text-[16px] outline-none focus:border-accent/60'
const chip = 'rounded-full px-2.5 py-0.5 font-medium'

// Nejbližší výskyt pravidla (dnešek se počítá); nevalidní pravidlo → undefined.
function nextOccurrence(rule: string, today: string): string | undefined {
  try {
    const horizon = toISODate(addDays(fromISODate(today), 370))
    return occurrencesBetween(rule, RULE_EPOCH, today, horizon)[0]
  } catch {
    return undefined
  }
}

export function TemplatesView({ onBack }: { onBack: () => void }) {
  const templates = useLiveQuery(activeTemplates, []) ?? []
  const clients = useLiveQuery(allClients, []) ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const selected = selectedId ? templates.find((t) => t.id === selectedId) : null

  const activeClientsList = clients.filter((c) => !c.deletedAt && c.status !== 'archived')
  const deployedCount = (templateId: string) =>
    activeClientsList.filter((c) => c.templateIds.includes(templateId)).length

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    const t = await addTemplate(newName.trim())
    setNewName('')
    setSelectedId(t.id)
  }

  const addFromGallery = async (packName: string) => {
    const pack = TEMPLATE_GALLERY.find((p) => p.name === packName)
    if (!pack) return
    const t = await addTemplate(pack.name, pack.items.map((i) => newTemplateItem(i)))
    setSelectedId(t.id)
  }

  if (selected) {
    return (
      <TemplateDetail
        template={selected}
        clients={activeClientsList}
        onBack={() => setSelectedId(null)}
        onOpenTemplate={setSelectedId}
      />
    )
  }

  // balíčky z galerie, které ještě nemají jmenovkyni mezi šablonami
  const galleryLeft = TEMPLATE_GALLERY.filter(
    (p) => !templates.some((t) => t.name.toLowerCase().startsWith(p.name.toLowerCase())),
  )

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-medium text-accent">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Klienti
      </button>

      <header className="rise">
        <h1 className="display text-[2.1rem] font-semibold leading-tight">Šablony</h1>
        <p className="text-sm text-ink-soft">
          Balíčky pravidelných úkolů — nasadíš je klientům a úkoly se generují samy
        </p>
      </header>

      <form onSubmit={create} className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Např. „Správa PPC“"
          className={`${field} min-w-0 flex-1`}
        />
        <button
          type="submit"
          disabled={!newName.trim()}
          className="rounded-lg bg-accent px-3 text-sm font-medium text-card disabled:opacity-30"
        >
          Vytvořit
        </button>
      </form>

      {templates.length > 0 && (
        <ul className="rise divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setSelectedId(t.id)}
                className="flex w-full items-center gap-3 bg-card px-4 py-3 text-left transition-colors duration-150 active:bg-well/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{t.name}</span>
                  <span className="text-xs text-ink-faint">
                    {t.items.length} {t.items.length === 1 ? 'položka' : t.items.length < 5 ? 'položky' : 'položek'}
                    {deployedCount(t.id) > 0 && ` · u ${deployedCount(t.id)} klientů`}
                  </span>
                </span>
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-faint/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {galleryLeft.length > 0 && (
        <section className="rise" style={{ '--stagger': 1 } as React.CSSProperties}>
          <h2 className="section-label mb-2">
            {templates.length === 0 ? 'začni hotovým balíčkem' : 'galerie balíčků'}
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
            {galleryLeft.map((p) => (
              <li key={p.name} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{p.name}</span>
                  <span className="text-xs text-ink-faint">{p.description}</span>
                </span>
                <button
                  onClick={() => void addFromGallery(p.name)}
                  className="shrink-0 rounded-full bg-accent-wash px-3 py-1.5 text-sm font-medium text-accent-deep transition-transform duration-150 active:scale-95"
                >
                  Přidat
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function TemplateDetail({
  template,
  clients,
  onBack,
  onOpenTemplate,
}: {
  template: Template
  clients: Client[]
  onBack: () => void
  onOpenTemplate: (id: string) => void
}) {
  const [editingItem, setEditingItem] = useState<TemplateItem | null>(null)
  const [quickText, setQuickText] = useState('')
  const today = todayISO()

  // Přirozené zadávání položky — stejný jazyk jako rychlé zadávání.
  const quickParsed = useMemo(
    () => (quickText.trim() ? parseTemplateItem(quickText) : null),
    [quickText],
  )

  const saveItem = async (item: TemplateItem) => {
    const items = template.items.some((i) => i.id === item.id)
      ? template.items.map((i) => (i.id === item.id ? item : i))
      : [...template.items, item]
    await updateTemplate(template.id, { items })
    setEditingItem(null)
  }

  const addQuick = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickParsed?.title || !quickParsed.recurrenceRule) return
    await saveItem(
      newTemplateItem({
        title: quickParsed.title,
        recurrenceRule: quickParsed.recurrenceRule,
        priority: quickParsed.priority,
        defaultProjectName: quickParsed.projectName,
      }),
    )
    setQuickText('')
  }

  const deleteItem = async (id: string) => {
    if (confirm('Odebrat položku? Budoucí nehotové úkoly z ní zmizí u všech klientů.')) {
      await updateTemplate(template.id, { items: template.items.filter((i) => i.id !== id) })
    }
  }

  const del = async () => {
    if (confirm(`Smazat šablonu „${template.name}“? Stáhne se ode všech klientů.`)) {
      await removeTemplate(template.id)
      onBack()
    }
  }

  const duplicate = async () => {
    const copy = await duplicateTemplate(template.id)
    if (copy) onOpenTemplate(copy.id)
  }

  const toggleDeploy = (client: Client) => {
    void (client.templateIds.includes(template.id)
      ? undeployTemplate(client.id, template.id)
      : deployTemplate(client.id, template.id))
  }

  // Náhled: co šablona vygeneruje v příštích 14 dnech (u jednoho klienta).
  const preview = useMemo(() => {
    const horizon = toISODate(addDays(fromISODate(today), 14))
    const byDate = new Map<string, string[]>()
    for (const item of template.items) {
      let dates: string[] = []
      try {
        dates = occurrencesBetween(item.recurrenceRule, RULE_EPOCH, today, horizon)
      } catch {
        continue
      }
      for (const d of dates) byDate.set(d, [...(byDate.get(d) ?? []), item.title])
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [template.items, today])

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-medium text-accent">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Šablony
      </button>

      <header className="rise">
        <h1 className="display text-[2.1rem] font-semibold leading-tight">{template.name}</h1>
        <p className="text-sm text-ink-soft">
          Úpravy se propíší do budoucích úkolů u všech klientů.
        </p>
      </header>

      {/* přirozené přidání položky — chipy ukážou, jak tomu appka rozumí */}
      <form onSubmit={addQuick} className="rise space-y-2">
        {quickParsed && (
          <div className="flex flex-wrap gap-1.5 px-1 text-[11px]">
            {quickParsed.recurrenceRule ? (
              <span className={`${chip} pop-soft inline-block bg-accent-wash text-accent-deep`}>
                ↻ {humanizeRule(quickParsed.recurrenceRule)}
              </span>
            ) : (
              <span className={`${chip} inline-block bg-note text-note-ink`}>
                chybí opakování — napiš třeba „každé pondělí…“
              </span>
            )}
            {quickParsed.priority !== 'normal' && (
              <span className={`${chip} pop-soft inline-block bg-well text-ink-soft`}>
                {PRIORITY_LABELS[quickParsed.priority]}
              </span>
            )}
            {quickParsed.projectName && (
              <span className={`${chip} pop-soft inline-block bg-well text-ink-soft`}>
                ▸ {quickParsed.projectName}
              </span>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            placeholder="Např. „každé pondělí kontrola kampaní !vysoká #PPC“"
            className={`${field} min-w-0 flex-1`}
          />
          <button
            type="submit"
            disabled={!quickParsed?.title || !quickParsed.recurrenceRule}
            className="rounded-lg bg-accent px-3 text-sm font-medium text-card transition-transform duration-150 active:scale-95 disabled:opacity-30"
          >
            Přidat
          </button>
        </div>
      </form>

      {template.items.length > 0 && (
        <ul className="rise divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
          {template.items.map((item) => {
            const next = nextOccurrence(item.recurrenceRule, today)
            return (
              <li key={item.id} className="bg-card px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setEditingItem(item)}>
                    <div className="text-[15px]">{item.title}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-soft">
                      <span>↻ {humanizeRule(item.recurrenceRule)}</span>
                      {next && (
                        <span className="text-ink-faint">
                          další {formatDayLabel(next).toLowerCase()}
                        </span>
                      )}
                      {item.priority !== 'normal' && <span>{PRIORITY_LABELS[item.priority]}</span>}
                      {item.defaultProjectName && <span className="text-ink-faint">→ {item.defaultProjectName}</span>}
                    </div>
                  </button>
                  <button className="px-1 text-xs text-ink-faint/70" onClick={() => void deleteItem(item.id)}>
                    Smazat
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editingItem && (
        <ItemForm initial={editingItem} onSave={saveItem} onCancel={() => setEditingItem(null)} />
      )}

      {clients.length > 0 && (
        <section className="rise">
          <h2 className="section-label mb-2">nasazeno u</h2>
          <div className="flex flex-wrap gap-2">
            {clients.map((c) => {
              const on = c.templateIds.includes(template.id)
              return (
                <button
                  key={c.id}
                  onClick={() => toggleDeploy(c)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-transform duration-150 active:scale-95 ${
                    on ? 'bg-accent text-card' : 'border border-line bg-card text-ink-soft'
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                  {on ? '✓ ' : ''}
                  {c.name}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {preview.length > 0 && (
        <section className="rise">
          <h2 className="section-label mb-2">co vygeneruje příštích 14 dní</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
            {preview.slice(0, 8).map(([date, titles]) => (
              <li key={date} className="flex gap-3 px-4 py-2.5">
                <span className="w-24 shrink-0 text-[13px] text-ink-soft first-letter:uppercase">
                  {formatDayLabel(date)}
                </span>
                <span className="min-w-0 flex-1 text-[14px]">{titles.join(' · ')}</span>
              </li>
            ))}
          </ul>
          {preview.length > 8 && (
            <p className="mt-1.5 px-1 text-xs text-ink-faint">…a {preview.length - 8} dalších dní</p>
          )}
        </section>
      )}

      <footer className="flex gap-4 border-t border-line pt-4">
        <button onClick={() => void duplicate()} className="text-sm font-medium text-ink-soft">
          Duplikovat
        </button>
        <button onClick={() => void del()} className="text-sm font-medium text-danger">
          Smazat šablonu
        </button>
      </footer>
    </div>
  )
}

function ItemForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: TemplateItem | null
  onSave: (item: TemplateItem) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [rule, setRule] = useState(initial?.recurrenceRule ?? buildRule('weekly', 'MO', 1, 1))
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'normal')
  const [projectName, setProjectName] = useState(initial?.defaultProjectName ?? '')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    const base = { title: title.trim(), recurrenceRule: rule, priority, defaultProjectName: projectName.trim() || undefined }
    onSave(initial ? { ...initial, ...base } : newTemplateItem(base))
  }

  return (
    <form onSubmit={submit} className="rise space-y-3 rounded-2xl bg-card p-3 shadow-card">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Název úkolu, např. „Kontrola kampaní“"
        className={field}
      />
      <RecurrencePicker value={rule} onChange={setRule} />
      <div className="grid grid-cols-2 gap-3">
        <select className={field} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="Projekt (volitelné)"
          className={field}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-soft">
          Zrušit
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-card disabled:opacity-30"
        >
          Uložit
        </button>
      </div>
    </form>
  )
}
