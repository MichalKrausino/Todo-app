// Brána do Todoistu (Fáze 8). Klient s ní mluví přes POST {action, ...}:
//   projects  {}                              → projekty + spolupracovníci (párování s klienty)
//   pull      {projectIds, completedSince}     → sekce, aktivní i hotové úkoly
//   close     {taskId}                         → odškrtne úkol v Todoistu
//   reopen    {taskId}                         → vrátí úkol mezi nehotové
//
// Osobní API token má plný přístup k účtu, proto žije jen tady
// (public.todoist_tokens — RLS bez policies, čte ho pouze service role).
// Klient ho ukládá write-only RPC store_todoist_token a nikdy ho nevidí zpět.

import { createClient } from 'npm:@supabase/supabase-js@2'

type Rec = Record<string, unknown>

const API = 'https://api.todoist.com/api/v1'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// CORS: appka běží na github.io a volá supabase.co — bez těchhle hlaviček
// prohlížeč preflight zařízne. Autorizaci řeší JWT, origin může být *.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: Rec, status = 200) => Response.json(body, { status, headers: CORS })

async function tokenFor(userId: string): Promise<string> {
  const { data } = await admin
    .from('todoist_tokens')
    .select('api_token')
    .eq('user_id', userId)
    .maybeSingle()
  if (!data?.api_token) throw new Error('Todoist není propojený')
  return data.api_token as string
}

async function td(token: string, path: string, init?: RequestInit): Promise<Rec> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  if (res.status === 204) return {}
  const text = await res.text()
  const data = (text ? JSON.parse(text) : {}) as Rec
  if (!res.ok) {
    if (res.status === 401) throw new Error('Todoist token neplatí — vlož ho znovu')
    if (res.status === 429) throw new Error('Todoist teď odmítá požadavky (limit) — zkusím to za chvíli')
    throw new Error(`Todoist ${path}: ${(data.error as string) ?? res.status}`)
  }
  return data
}

// Všechny stránky jednoho seznamu. Odpověď je {results, next_cursor};
// strop stránek je pojistka proti nekonečné smyčce.
async function tdList(token: string, path: string, params: Record<string, string> = {}): Promise<Rec[]> {
  const out: Rec[] = []
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ ...params, limit: '200' })
    if (cursor) q.set('cursor', cursor)
    const data = await td(token, `${path}?${q}`)
    out.push(...((data.results ?? []) as Rec[]))
    cursor = (data.next_cursor as string | null) ?? undefined
    if (!cursor) break
  }
  return out
}

const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

// Todoist vrací u úkolu jen to, co appka opravdu potřebuje — zbytek
// (pořadí, kdo přidal, komentáře) zahazujeme už na serveru.
function slimTask(t: Rec): Rec {
  const due = t.due as Rec | null
  return {
    id: String(t.id),
    projectId: s(t.project_id),
    sectionId: s(t.section_id),
    parentId: s(t.parent_id),
    content: (t.content as string) ?? '',
    description: (t.description as string) ?? '',
    priority: Number(t.priority ?? 1),
    labels: (t.labels ?? []) as string[],
    responsibleUid: s(t.responsible_uid),
    checked: Boolean(t.checked),
    completedAt: s(t.completed_at),
    updatedAt: s(t.updated_at),
    due: due ? { date: s(due.date), datetime: s(due.datetime), isRecurring: Boolean(due.is_recurring) } : null,
    deadline: t.deadline ? { date: s((t.deadline as Rec).date) } : null,
    duration: t.duration ? { amount: Number((t.duration as Rec).amount), unit: s((t.duration as Rec).unit) } : null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'chybí autorizace' }, 401)
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !userData.user) return json({ error: 'neplatné přihlášení' }, 401)
    const userId = userData.user.id

    const body = (await req.json().catch(() => ({}))) as Rec
    const action = body.action as string
    const token = await tokenFor(userId)

    // Projekty pro párovací obrazovku. Spolupracovníky tahá jen u sdílených
    // — u vlastních projektů by to bylo N zbytečných volání.
    if (action === 'projects') {
      const me = await td(token, '/user')
      const projects = (await tdList(token, '/projects')).filter((p) => !p.is_deleted)
      const out: Rec[] = []
      for (const p of projects) {
        const shared = Boolean(p.is_shared)
        let collaborators: Rec[] = []
        if (shared) {
          collaborators = (await tdList(token, `/projects/${p.id}/collaborators`)).map((c) => ({
            id: String(c.id),
            name: (c.name as string) ?? '',
            email: (c.email as string) ?? '',
          }))
        }
        out.push({
          id: String(p.id),
          name: (p.name as string) ?? '',
          color: (p.color as string) ?? 'charcoal',
          isShared: shared,
          isArchived: Boolean(p.is_archived),
          isFavorite: Boolean(p.is_favorite),
          parentId: s(p.parent_id),
          collaborators,
        })
      }
      return json({
        user: { id: String(me.id ?? ''), email: (me.email as string) ?? '', name: (me.full_name as string) ?? '' },
        projects: out,
      })
    }

    // Stažení namapovaných projektů. Aktivní úkoly říkají, co existuje;
    // hotové (od completedSince) rozliší „odškrtnuto" od „smazáno".
    if (action === 'pull') {
      const projectIds = ((body.projectIds ?? []) as unknown[]).map(String).filter(Boolean).slice(0, 40)
      // `me` posíláme s každým stažením: filtr „přiřazeno mně" musí fungovat
      // i na druhém zařízení, které párování nedělalo.
      const me = await td(token, '/user')
      const myUid = String(me.id ?? '')
      if (projectIds.length === 0) return json({ myUid, sections: [], tasks: [], completed: [] })
      const since = (body.completedSince as string) ?? new Date(Date.now() - 30 * 86400_000).toISOString()
      const until = new Date(Date.now() + 86400_000).toISOString()

      const sections: Rec[] = []
      const tasks: Rec[] = []
      const completed: Rec[] = []
      for (const projectId of projectIds) {
        for (const sec of await tdList(token, '/sections', { project_id: projectId })) {
          if (sec.is_deleted) continue
          sections.push({ id: String(sec.id), projectId, name: (sec.name as string) ?? '' })
        }
        for (const t of await tdList(token, '/tasks', { project_id: projectId })) {
          if (!t.is_deleted) tasks.push(slimTask(t))
        }
        const done = await td(
          token,
          `/tasks/completed/by_completion_date?${new URLSearchParams({
            since,
            until,
            project_id: projectId,
            limit: '200',
          })}`,
        )
        for (const t of ((done.items ?? done.results ?? []) as Rec[])) {
          completed.push(slimTask({ ...t, checked: true }))
        }
      }
      return json({ myUid, sections, tasks, completed })
    }

    if (action === 'close') {
      const taskId = String(body.taskId ?? '')
      if (!taskId) return json({ error: 'chybí taskId' }, 400)
      await td(token, `/tasks/${taskId}/close`, { method: 'POST' })
      return json({ ok: true })
    }

    if (action === 'reopen') {
      const taskId = String(body.taskId ?? '')
      if (!taskId) return json({ error: 'chybí taskId' }, 400)
      await td(token, `/tasks/${taskId}/reopen`, { method: 'POST' })
      return json({ ok: true })
    }

    return json({ error: `neznámá akce: ${action}` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
