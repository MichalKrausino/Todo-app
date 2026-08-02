import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Priority, Template, TemplateItem } from '../db/types'
import { allClients } from '../db/repo'
import { activeTemplates, addTemplate, newTemplateItem, removeTemplate, updateTemplate } from '../db/templates'
import { PRIORITY_LABELS } from '../lib/labels'
import { humanizeRule } from '../lib/rrule'
import { RecurrencePicker, buildRule } from '../components/RecurrencePicker'

const field = 'w-full rounded-lg border border-line bg-card px-3 py-2 text-[15px] outline-none focus:border-accent/60'

export function TemplatesView({ onBack }: { onBack: () => void }) {
  const templates = useLiveQuery(activeTemplates, []) ?? []
  const clients = useLiveQuery(allClients, []) ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const selected = selectedId ? templates.find((t) => t.id === selectedId) : null

  const deployedCount = (templateId: string) =>
    clients.filter((c) => !c.deletedAt && c.status !== 'archived' && c.templateIds.includes(templateId)).length

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    const t = await addTemplate(newName.trim())
    setNewName('')
    setSelectedId(t.id)
  }

  if (selected) {
    return <TemplateDetail template={selected} onBack={() => setSelectedId(null)} />
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-medium text-accent">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Klienti
      </button>

      <header>
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

      {templates.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-card/60 px-4 py-8 text-center text-sm text-ink-faint">
          Zatím žádné šablony. Typický start: „Správa PPC“ s týdenní kontrolou
          kampaní a měsíčním reportem.
        </div>
      )}

      <ul className="space-y-2">
        {templates.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => setSelectedId(t.id)}
              className="flex w-full items-center gap-3 rounded-2xl bg-card px-3 py-3 text-left shadow-card"
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
    </div>
  )
}

function TemplateDetail({ template, onBack }: { template: Template; onBack: () => void }) {
  const [editingItem, setEditingItem] = useState<TemplateItem | 'new' | null>(null)

  const saveItem = async (item: TemplateItem) => {
    const items = template.items.some((i) => i.id === item.id)
      ? template.items.map((i) => (i.id === item.id ? item : i))
      : [...template.items, item]
    await updateTemplate(template.id, { items })
    setEditingItem(null)
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

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-medium text-accent">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Šablony
      </button>

      <header>
        <h1 className="display text-[2.1rem] font-semibold leading-tight">{template.name}</h1>
        <p className="text-sm text-ink-soft">
          Nasazuje se klientům v jejich detailu. Úpravy se propíší všem.
        </p>
      </header>

      <ul className="space-y-2">
        {template.items.map((item) => (
          <li key={item.id} className="rounded-2xl bg-card px-3 py-2.5 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditingItem(item)}>
                <div className="text-[15px]">{item.title}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-soft">
                  <span>↻ {humanizeRule(item.recurrenceRule)}</span>
                  {item.priority !== 'normal' && <span>{PRIORITY_LABELS[item.priority]}</span>}
                  {item.defaultProjectName && <span className="text-ink-faint">→ {item.defaultProjectName}</span>}
                </div>
              </button>
              <button className="px-1 text-xs text-ink-faint/70" onClick={() => void deleteItem(item.id)}>
                Smazat
              </button>
            </div>
          </li>
        ))}
      </ul>

      {editingItem ? (
        <ItemForm
          initial={editingItem === 'new' ? null : editingItem}
          onSave={saveItem}
          onCancel={() => setEditingItem(null)}
        />
      ) : (
        <button onClick={() => setEditingItem('new')} className="text-sm font-medium text-accent">
          + Nová položka
        </button>
      )}

      <footer className="border-t border-line pt-4">
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
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-3 shadow-card">
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
