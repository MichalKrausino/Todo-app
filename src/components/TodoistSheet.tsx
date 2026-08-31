import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addClient, allClients, updateClient } from '../db/repo'
import { unlinkTodoistProject } from '../db/todoistImport'
import { firstFreeColor } from '../lib/labels'
import {
  checkTodoistLinked,
  fetchTodoistProjects,
  getTodoistStatus,
  linkTodoist,
  refreshTodoist,
  subscribeTodoistStatus,
  unlinkTodoist,
  type TodoistProject,
} from '../sync/todoist'
import { Sheet } from './Sheet'

const timeFmt = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })

// Vložení tokenu a párování sdílených projektů s klienty. Token jde rovnou
// do Supabase (write-only RPC) a nikdy se sem nevrací — políčko slouží jen
// k vložení, ne k zobrazení.
export function TodoistSheet({ onClose }: { onClose: () => void }) {
  const status = useSyncExternalStore(subscribeTodoistStatus, getTodoistStatus)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<TodoistProject[] | null>(null)
  const [assigned, setAssigned] = useState<Record<string, number>>({})
  const clients = useLiveQuery(allClients, []) ?? []
  // Po spárování se stahuje samo — ale až se přestane klikat, ať tři
  // projekty za sebou neznamenají tři stažení.
  const pullTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(pullTimer.current), [])

  useEffect(() => {
    void checkTodoistLinked().then((linked) => {
      if (linked) void loadProjects()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadProjects = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetchTodoistProjects()
      setProjects(res.projects.filter((p) => !p.isArchived))
      setAssigned(res.assigned)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nepodařilo se načíst projekty.')
    } finally {
      setBusy(false)
    }
  }

  const link = async () => {
    if (!token.trim()) return
    setBusy(true)
    setError(null)
    try {
      await linkTodoist(token)
      setToken('')
      await loadProjects()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Token se nepodařilo uložit.')
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    setBusy(true)
    try {
      await unlinkTodoist()
      setProjects(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Odpojení selhalo.')
    } finally {
      setBusy(false)
    }
  }

  // Párování žije na klientovi (Client.todoistProjectIds), takže se
  // synchronizuje na druhé zařízení spolu se vším ostatním.
  const assign = async (projectId: string, clientId: string, projectName: string) => {
    for (const c of clients) {
      const has = c.todoistProjectIds?.includes(projectId)
      if (has && c.id !== clientId) {
        await updateClient(c.id, {
          todoistProjectIds: (c.todoistProjectIds ?? []).filter((p) => p !== projectId),
        })
      }
    }
    // „netahat" = úkoly zůstanou, jen přestanou být todoistí a dají se
    // zase normálně upravovat.
    if (clientId === '') {
      await unlinkTodoistProject(projectId)
      return
    }
    if (clientId === '__new__') {
      const created = await addClient({
        name: projectName,
        color: firstFreeColor(clients.map((c) => c.color)),
        kind: 'client',
      })
      await updateClient(created.id, { todoistProjectIds: [projectId] })
      return
    }
    const target = clients.find((c) => c.id === clientId)
    if (!target) return
    const next = [...new Set([...(target.todoistProjectIds ?? []), projectId])]
    await updateClient(clientId, { todoistProjectIds: next })
  }

  const assignAndPull = async (projectId: string, clientId: string, projectName: string) => {
    await assign(projectId, clientId, projectName)
    clearTimeout(pullTimer.current)
    pullTimer.current = setTimeout(() => void refreshTodoist(true), 1500)
  }

  const mapped = (projectId: string) =>
    clients.find((c) => c.todoistProjectIds?.includes(projectId))
  const clientOf = (projectId: string) => mapped(projectId)?.id ?? ''

  // Týmový projekt se nemusí tvářit jako sdílený — přístup k němu dává
  // členství v týmu. Kdyby se bral jen `isShared`, projekty klientů na
  // Todoist Business by tu vůbec nešly spárovat.
  const shared = (projects ?? []).filter((p) => p.isShared || p.workspaceId)
  const own = (projects ?? []).filter((p) => !p.isShared && !p.workspaceId)
  // Nespárované projekty, ve kterých na mě něco čeká. Ty úkoly se stáhnou
  // i bez spárování (přijdou bez klienta) — párování je navíc zařadí
  // a přitáhne i zbytek projektu.
  const missed = shared.filter((p) => !mapped(p.id) && (assigned[p.id] ?? 0) > 0)

  return (
    <Sheet onClose={onClose} className="space-y-4">
      {() => (
        <>
          <header>
            <h2 className="text-lg font-bold">Todoist</h2>
            <p className="text-sm text-ink-soft">
              {status.linked ? 'Propojeno' : 'Nepropojeno'}
              {status.lastSuccessAt && ` · staženo v ${timeFmt.format(new Date(status.lastSuccessAt))}`}
              {typeof status.taskCount === 'number' && ` · ${status.taskCount} úkolů`}
            </p>
          </header>

          {!status.linked && (
            <section className="space-y-2">
              <p className="rounded-2xl bg-well px-3 py-3 text-[13px] leading-relaxed text-ink-soft">
                V Todoistu otevři <strong>Nastavení → Integrace → Vývojář</strong> a zkopíruj
                API token. Uloží se na server appky, do telefonu se nikdy nevrátí.
              </p>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="API token z Todoistu"
                autoComplete="off"
                className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-base outline-none focus:border-accent"
              />
              <button
                onClick={() => void link()}
                disabled={busy || !token.trim()}
                className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-transform duration-150 active:scale-[0.98] disabled:opacity-40"
              >
                {busy ? 'Ověřuji…' : 'Propojit'}
              </button>
            </section>
          )}

          {error && <p className="rounded-2xl bg-danger-wash px-3 py-2 text-xs text-danger">{error}</p>}
          {status.lastError && !error && (
            <p className="rounded-2xl bg-danger-wash px-3 py-2 text-xs text-danger">{status.lastError}</p>
          )}
          {/* Odebraný přístup k jednomu projektu nesmí zmrazit zbytek —
              stažení proběhne a jen se to tady řekne. */}
          {status.unreachable?.length ? (
            <p className="rounded-2xl bg-note px-3 py-2 text-xs text-note-ink">
              K {status.unreachable.length === 1 ? 'jednomu projektu' : `${status.unreachable.length} projektům`} už
              nemám přístup — nejspíš mě z nich klient odebral. Ostatní se stáhly normálně;
              nastav u nich „netahat do appky".
            </p>
          ) : null}

          {status.linked && (
            <>
              {missed.length > 0 && (
                <p className="rounded-2xl bg-note px-3 py-2 text-xs leading-relaxed text-note-ink">
                  Úkoly přiřazené tobě chodí i z {missed.length === 1 ? 'projektu' : 'projektů'},
                  {' '}které tu nemáš spárované ({missed.map((p) => p.name).join(', ')}) — jsou
                  v inboxu bez klienta. Když u nich klienta vybereš, přijde i zbytek projektu
                  a úkoly se zařadí.
                </p>
              )}

              <section className="space-y-2">
                <h3 className="section-label">sdílené a týmové projekty</h3>
                {shared.length === 0 && (
                  <p className="rounded-2xl bg-well px-3 py-3 text-[13px] text-ink-soft">
                    {busy ? 'Načítám…' : 'Zatím tě nikdo nepřidal do sdíleného projektu.'}
                  </p>
                )}
                {shared.length > 0 && (
                  <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-well">
                    {shared.map((p) => (
                      <li key={p.id} className="space-y-1.5 px-3 py-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{p.name}</span>
                          <span className="shrink-0 text-[11px] text-ink-faint">
                            {p.workspaceId ? 'tým · ' : ''}
                            {p.collaborators.length} lidí
                            {assigned[p.id] ? ` · ${assigned[p.id]} na mě` : ''}
                          </span>
                        </div>
                        <select
                          value={clientOf(p.id)}
                          onChange={(e) => void assignAndPull(p.id, e.target.value, p.name)}
                          className="w-full rounded-lg border border-line bg-card px-2 py-1.5 text-base"
                        >
                          <option value="">— netahat do appky —</option>
                          <option value="__new__">+ založit klienta „{p.name}"</option>
                          {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        {/* Psaní ven je vypnuté, dokud ho nezapnu — do
                            klientova projektu nemá nic uniknout omylem. */}
                        {mapped(p.id) && (
                          <label className="flex items-start gap-2 text-[12px] leading-snug text-ink-soft">
                            <input
                              type="checkbox"
                              checked={Boolean(mapped(p.id)?.todoistPushSince)}
                              onChange={(e) =>
                                void updateClient(mapped(p.id)!.id, {
                                  todoistPushSince: e.target.checked ? new Date().toISOString() : undefined,
                                })
                              }
                              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                            />
                            <span>
                              Nové úkoly tohohle klienta zakládat i v Todoistu
                              <span className="block text-ink-faint">
                                Týká se jen úkolů napsaných od zapnutí; kontroly klienta
                                a úkoly ze šablon zůstávají doma.
                              </span>
                            </span>
                          </label>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {own.length > 0 && (
                <section className="space-y-2">
                  <h3 className="section-label">moje projekty</h3>
                  <p className="rounded-2xl bg-well px-3 py-2 text-[12px] leading-relaxed text-ink-faint">
                    Vlastní todoistí projekty se netahají — to, co si vedeš sám, patří
                    rovnou sem. ({own.length} projektů)
                  </p>
                </section>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => void refreshTodoist(true)}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-transform duration-150 active:scale-[0.98] disabled:opacity-40"
                >
                  Stáhnout teď
                </button>
                <button
                  onClick={() => void unlink()}
                  disabled={busy}
                  className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-transform duration-150 active:scale-[0.98]"
                >
                  Odpojit
                </button>
              </div>
            </>
          )}

          <p className="px-1 text-[11px] leading-relaxed text-ink-faint">
            Z Todoistu chodí jen úkoly, na kterých jsi označený ty — nepřiřazené
            ani cizí ne. Když ti někdo úkol přebere, zmizí i odsud. Název, termín
            a priorita patří Todoistu — tady je neměň, další stažení by to přepsalo.
            Odškrtnutí letí zpátky, takže klient vidí, co je hotové.
          </p>
        </>
      )}
    </Sheet>
  )
}
