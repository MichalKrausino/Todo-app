// Seznam klientů a přehled projektů — první poloha záložky Klienti.
//
// Bydlelo to v jednom souboru s detailem klienta, dohromady přes osm set
// řádků. Jsou to dvě samostatné obrazovky, které spolu nesdílejí nic než
// data z repa — z jednoho souboru tak nekoukala jediná výhoda, jen délka.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { sharedClientIds } from '../sync/shares'
import type { Client, ClientKind, Task } from '../db/types'
import {
  activeClients,
  addClient,
  addProject,
  allProjects,
  allTasks,
  archivedClients,
  ensureAreaClient,
  openTasks,
} from '../db/repo'
import { CHECK_FREQUENCY_LABELS, setClientCheck, type CheckFrequency } from '../db/clientCheck'
import { COLOR_NAMES, KIND_LABELS, firstFreeColor } from '../lib/labels'
import { stavKlienta } from '../lib/clientStatus'
import { formatDayLabel, todayISO } from '../lib/dates'
import { ColorPicker } from '../components/ColorPicker'
import { TextEffect } from '../components/ui/TextEffect'
import { Button } from '../components/ui/Button'

export function ClientList({
  onSelect,
  onTemplates,
}: {
  onSelect: (id: string) => void
  onTemplates: () => void
}) {
  // Dokud první dotaz nedoběhne, není to „žádní klienti" — jen se ještě
  // neví. Výzva k založení by na chvíli přebila plný seznam.
  const clientsRaw = useLiveQuery(activeClients, [])
  const clients = clientsRaw ?? []
  const archived = useLiveQuery(archivedClients, []) ?? []
  const open = useLiveQuery(openTasks, []) ?? []
  // Které klienty vidí i někdo další. Bez toho se od pohledu nepozná, co je
  // společná práce a co jen moje — a to je u sdílení ta nejdůležitější věc.
  const sdilene = useLiveQuery(sharedClientIds, [], new Set<string>())
  const [adding, setAdding] = useState(false)

  const counts = new Map<string, number>()
  for (const t of open) {
    if (t.clientId) counts.set(t.clientId, (counts.get(t.clientId) ?? 0) + 1)
  }

  // Stavová řádka klienta (`stavKlienta`): kolik hoří → ticho → kdy je
  // další práce → druh, sdíleno. Pořadí je pořadí důležitosti, protože
  // na úzkém displeji se ořezává zprava.
  const today = todayISO()
  const podleKlienta = new Map<string, Task[]>()
  for (const t of open) {
    if (!t.clientId) continue
    const uz = podleKlienta.get(t.clientId)
    if (uz) uz.push(t)
    else podleKlienta.set(t.clientId, [t])
  }
  const podtitul = (c: Client): React.ReactNode =>
    stavKlienta(c, podleKlienta.get(c.id) ?? [], { sdileno: sdilene.has(c.id) }, today).map((cast, i) => (
      <span
        key={cast.text}
        className={cast.tone === 'danger' ? 'font-medium text-danger' : cast.tone === 'note' ? 'font-medium text-note-ink' : undefined}
      >
        {i > 0 && <span className="text-ink-faint"> · </span>}
        {cast.text}
      </span>
    ))

  const item = (c: Client) => (
    <li key={c.id}>
      <button
        onClick={() => onSelect(c.id)}
        className="flex w-full items-center gap-3 bg-card px-4 py-3 text-left transition-colors duration-150 active:bg-well/60"
      >
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{c.name}</span>
          <span className="block truncate text-xs text-ink-faint">{podtitul(c)}</span>
        </span>
        {(counts.get(c.id) ?? 0) > 0 && (
          <span className="rounded-full bg-well px-2 py-0.5 text-xs font-medium text-ink-soft">
            {counts.get(c.id)}
          </span>
        )}
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-faint/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </li>
  )

  return (
    <div className="space-y-5">
      {/* Titulek přes celou šířku jako na Dnes a v Plánu. Dřív stál vedle
          sloupce dvou tlačítek, takže se podtitulek mačkal do dvou řádků
          a lámal se pod „+ Nový" — vypadalo to jako popisek tlačítka.
          Akce teď stojí na vlastním řádku pod ním. */}
      <header>
        <TextEffect as="h1" per="char" preset="blur" className="display text-[2.1rem] font-semibold leading-tight">Klienti</TextEffect>
        <p className="text-sm text-ink-soft">Klienti i oblasti jako „Interní“ nebo „Osobní“</p>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Zavřít' : '+ Nový'}
          </Button>
          <Button variant="secondary" size="sm" className="text-ink-soft" onClick={onTemplates}>
            Šablony
          </Button>
        </div>
      </header>

      {adding && (
        <NewClientForm
          usedColors={clients.map((c) => c.color)}
          onDone={() => setAdding(false)}
        />
      )}

      {clientsRaw !== undefined && clients.length === 0 && !adding && (
        <p className="px-1 py-6 text-sm text-ink-faint">Zatím žádní klienti. Začni tlačítkem „+ Nový“.</p>
      )}

      {/* Celá sekce až od prvního klienta: prázdný <ul> má pořád bg-card
          a shadow-card, a ten nese 1px prstenec — na prázdné obrazovce
          z toho byla osamocená čárka pod výzvou k založení. */}
      {clients.length > 0 && (
        <>
          <h2 className="section-label mb-2">klienti a oblasti</h2>
          <ul className="rise divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">{clients.map(item)}</ul>
        </>
      )}

      {/* Přehled projektů je druhý pohled na tytéž věci, takže patří AŽ za
          seznam klientů. Projekt se navíc zakládá pod klienta, takže když
          žádný projekt není, nemá se tu co nabízet — dřív nad seznamem
          viselo osamocené „+ Nový projekt" bez vysvětlení, k čemu patří. */}
      {clients.length > 0 && <ProjectsOverview clients={clients} open={open} onSelect={onSelect} />}

      {archived.length > 0 && (
        <section>
          <h2 className="mb-2 section-label">
            Archivované · {archived.length}
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card opacity-60 shadow-card">{archived.map(item)}</ul>
        </section>
      )}
    </div>
  )
}

// Přehled rozjetých projektů napříč klienty i oblastmi — projekty jsou
// vidět bez proklikávání do detailů. Odsud jde založit projekt „bez
// klienta": vybere se oblast Interní/Osobní a ta se případně tiše založí.
function ProjectsOverview({
  clients,
  open,
  onSelect,
}: {
  clients: Client[]
  open: Task[]
  onSelect: (clientId: string) => void
}) {
  const projects = useLiveQuery(allProjects, []) ?? []
  // i hotové úkoly — postup projektu bez nich nedává smysl
  const every = useLiveQuery(allTasks, []) ?? []
  const [adding, setAdding] = useState(false)

  const clientById = new Map(clients.map((c) => [c.id, c]))
  const active = projects
    .filter((p) => p.status === 'active' && clientById.has(p.clientId))
    .sort(
      (a, b) =>
        clientById.get(a.clientId)!.name.localeCompare(clientById.get(b.clientId)!.name, 'cs') ||
        a.order - b.order,
    )

  const openByProject = new Map<string, number>()
  for (const t of open) {
    if (t.projectId) openByProject.set(t.projectId, (openByProject.get(t.projectId) ?? 0) + 1)
  }
  const doneByProject = new Map<string, number>()
  const totalByProject = new Map<string, number>()
  for (const t of every) {
    if (!t.projectId) continue
    totalByProject.set(t.projectId, (totalByProject.get(t.projectId) ?? 0) + 1)
    if (t.status === 'done') doneByProject.set(t.projectId, (doneByProject.get(t.projectId) ?? 0) + 1)
  }
  const today = todayISO()

  // Bez jediného projektu se blok neukáže vůbec: projekt vzniká v detailu
  // klienta, kde je jasné, komu patří, a samotný odkaz nad seznamem klientů
  // jen mátl.
  if (active.length === 0 && !adding) return null

  return (
    <section className="rise">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="section-label">rozjeté projekty · {active.length}</h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="-my-1.5 px-1 py-1.5 text-sm font-medium text-accent-deep"
        >
          {adding ? 'Zavřít' : '+ Nový'}
        </button>
      </div>

      {adding && <NewProjectForm clients={clients} onDone={() => setAdding(false)} />}

      {active.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
          {active.map((p) => {
            const client = clientById.get(p.clientId)!
            const openCount = openByProject.get(p.id) ?? 0
            const done = doneByProject.get(p.id) ?? 0
            const total = totalByProject.get(p.id) ?? 0
            const late = Boolean(p.dueDate && p.dueDate < today && done < total)
            return (
              <li key={p.id}>
                <button
                  onClick={() => onSelect(p.clientId)}
                  className="flex w-full items-center gap-3 bg-card px-4 py-3 text-left transition-colors duration-150 active:bg-well/60"
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: client.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{p.name}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs">
                      <span className="text-ink-faint">{client.name}</span>
                      {p.dueDate && (
                        <span className={late ? 'font-medium text-danger' : 'text-ink-soft'}>
                          do {formatDayLabel(p.dueDate)}
                        </span>
                      )}
                      {total > 0 && (
                        <span className="text-ink-faint">
                          {done} z {total}
                        </span>
                      )}
                    </span>
                    {total > 0 && (
                      <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-well">
                        <span
                          className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-glide"
                          style={{ width: `${Math.round((done / total) * 100)}%` }}
                        />
                      </span>
                    )}
                  </span>
                  {openCount > 0 ? (
                    <span className="rounded-full bg-well px-2 py-0.5 text-xs font-medium text-ink-soft">
                      {openCount}
                    </span>
                  ) : (
                    <span className="rounded-full bg-note px-2 py-0.5 text-xs font-semibold text-note-ink">
                      chybí další krok
                    </span>
                  )}
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// Založení projektu odkudkoli: cílem je klient, nebo oblast Interní/Osobní
// (když oblast neexistuje, ensureAreaClient ji tiše vytvoří).
function NewProjectForm({ clients, onDone }: { clients: Client[]; onDone: () => void }) {
  const [name, setName] = useState('')
  const hasInternal = clients.some((c) => c.kind === 'internal')
  const hasPersonal = clients.some((c) => c.kind === 'personal')
  const [target, setTarget] = useState(clients[0]?.id ?? '__internal')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    let clientId = target
    if (target === '__internal' || target === '__personal') {
      clientId = (await ensureAreaClient(target === '__internal' ? 'internal' : 'personal')).id
    }
    await addProject({ clientId, name: name.trim() })
    setName('')
    onDone()
  }

  return (
    <form onSubmit={submit} className="rise mb-3 space-y-2 rounded-2xl bg-card p-3 shadow-card">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Název projektu"
        className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[15px] outline-none focus:border-accent/60"
      />
      <div className="flex gap-2">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-2 text-[15px] outline-none focus:border-accent/60"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.kind !== 'client' ? ` (${KIND_LABELS[c.kind].toLowerCase()})` : ''}
            </option>
          ))}
          {!hasInternal && <option value="__internal">Interní (oblast se založí)</option>}
          {!hasPersonal && <option value="__personal">Osobní (oblast se založí)</option>}
        </select>
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-lg bg-accent px-4 text-sm font-medium text-card transition-transform duration-150 active:scale-95 disabled:opacity-30"
        >
          OK
        </button>
      </div>
    </form>
  )
}

function NewClientForm({ usedColors, onDone }: { usedColors: Array<string | undefined>; onDone: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ClientKind>('client')
  const [color, setColor] = useState(() => firstFreeColor(usedColors))
  const [pickingColor, setPickingColor] = useState(false)
  const [checkOn, setCheckOn] = useState(false)
  const [checkFreq, setCheckFreq] = useState<CheckFrequency>('weekly')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const client = await addClient({ name: name.trim(), kind, color })
    if (checkOn) await setClientCheck(client, checkFreq)
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-3 shadow-card">
      {/* Barva sedí u jména, protože v seznamu je to jedna věc: tečka
          a text vedle ní. Ťuknutím se rozbalí paleta — do formuláře se
          nevejde jako trvalá dvouřádková mřížka, a hlavně tam nepatří:
          appka barvu přidělí sama a měnit se hodí až mezi ostatními. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPickingColor((v) => !v)}
          aria-label={`Barva klienta: ${COLOR_NAMES[color] ?? color}`}
          aria-expanded={pickingColor}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full transition-transform duration-150 active:scale-90"
        >
          <span className="h-5 w-5 rounded-full" style={{ background: color }} />
        </button>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jméno klienta"
          aria-label="Jméno klienta nebo oblasti"
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-[15px] outline-none focus:border-accent/60"
        />
      </div>
      {pickingColor && (
        <ColorPicker
          value={color}
          onPick={(c) => {
            setColor(c)
            setPickingColor(false)
          }}
        />
      )}
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as ClientKind)}
        className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[15px] outline-none focus:border-accent/60"
      >
        {(Object.keys(KIND_LABELS) as ClientKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <div className="overflow-hidden rounded-lg border border-line">
        <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5">
          <span className="text-[15px]">
            Pravidelná připomínka kontroly
            <span className="block text-xs text-ink-soft">
              Úkol „Zkontrolovat klienta“ se sám vrací na Dnes
            </span>
          </span>
          <input
            type="checkbox"
            checked={checkOn}
            onChange={(e) => setCheckOn(e.target.checked)}
            className="h-5 w-5 shrink-0"
          />
        </label>
        {checkOn && (
          <div className="border-t border-line px-3 py-2.5">
            <select
              value={checkFreq}
              onChange={(e) => setCheckFreq(e.target.value as CheckFrequency)}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[15px] outline-none focus:border-accent/60"
            >
              {(Object.keys(CHECK_FREQUENCY_LABELS) as CheckFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {CHECK_FREQUENCY_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <Button type="submit" disabled={!name.trim()} className="w-full">
        Vytvořit
      </Button>
    </form>
  )
}
