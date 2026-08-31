// Brána do Todoistu (Fáze 8). Klient s ní mluví přes POST {action, ...}:
//   projects  {}                              → projekty, spolupracovníci, úkoly v nespárovaných projektech
//   comments  {taskId, projectId}              → komentáře u úkolu (i se jmény autorů)
//   comment   {taskId, content}                → přidá komentář
//   pull      {projectIds, completedSince}     → sekce, aktivní i hotové úkoly
//                                                (a navíc všechno, co je přiřazené mně,
//                                                 i z projektů mimo `projectIds`)
//   create    {projectId, sectionId, ...}      → založí úkol v Todoistu
//   update    {taskId, ...}                    → přepíše název, popis, termín, prioritu
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

// Todoist nesnáší undefined v těle požadavku — vyhodit prázdné klíče.
const clean = (o: Rec): Rec => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

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
        // Týmový projekt (workspace) se nemusí tvářit jako „sdílený" —
        // přístup k němu dává členství v týmu, ne sdílení. Bez tohohle
        // by projekty klientů na Todoist Business zůstaly neviditelné.
        const workspaceId = s(p.workspace_id)
        const shared = Boolean(p.is_shared) || Boolean(workspaceId)
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
          workspaceId,
          isArchived: Boolean(p.is_archived),
          isFavorite: Boolean(p.is_favorite),
          parentId: s(p.parent_id),
          collaborators,
        })
      }

      // Kolik úkolů na mě čeká v projektech, které v appce nemám —
      // ať mi nic neproklouzne jen proto, že jsem je nespároval.
      const assigned: Record<string, number> = {}
      try {
        const mine = await tdList(token, '/tasks/filter', { query: 'assigned to: me' })
        for (const t of mine) {
          const pid = s(t.project_id)
          if (pid) assigned[pid] = (assigned[pid] ?? 0) + 1
        }
      } catch {
        // filtr je pohodlí navíc; když ho Todoist nepřijme, nic se neděje
      }

      return json({
        user: { id: String(me.id ?? ''), email: (me.email as string) ?? '', name: (me.full_name as string) ?? '' },
        projects: out,
        assigned,
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
      const since = (body.completedSince as string) ?? new Date(Date.now() - 30 * 86400_000).toISOString()
      const until = new Date(Date.now() + 86400_000).toISOString()

      const sections: Rec[] = []
      const tasks: Rec[] = []
      const completed: Rec[] = []
      // Projekt, ke kterému jsem přišel o přístup, nesmí shodit celé
      // stažení — jinak by jeden odebraný klient zmrazil úplně všechno.
      const pulled: string[] = []
      const failed: Rec[] = []
      for (const projectId of projectIds) {
        try {
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
          pulled.push(projectId)
        } catch (e) {
          failed.push({ projectId, error: e instanceof Error ? e.message : String(e) })
        }
      }
      // Úkoly přiřazené mně napříč Todoistem — i z projektů, které v appce
      // nejsou napojené na klienta. Bez tohohle se úkol, který mi někdo
      // zadal v cizím projektu, do appky nikdy nedostal: stahovaly se jen
      // spárované projekty. Takové úkoly přijdou bez klienta (do inboxu).
      //
      // `assignedProjects` říká, ze kterých projektů jde jen tenhle výběr.
      // Úklid „co v Todoistu zmizelo" se o ně smí opřít jen tehdy, když
      // vyšel i dotaz na hotové — jinak by odškrtnutí v Todoistu vypadalo
      // jako smazání a úkol by z appky tiše zmizel místo do hotových.
      const znameId = new Set(tasks.map((t) => String(t.id)))
      const zPrirazenych = new Set<string>()
      let assignedProjects: string[] = []
      try {
        for (const t of await tdList(token, '/tasks/filter', { query: 'assigned to: me' })) {
          if (t.is_deleted) continue
          const pid = s(t.project_id)
          if (pid && !projectIds.includes(pid)) zPrirazenych.add(pid)
          if (!znameId.has(String(t.id))) {
            znameId.add(String(t.id))
            tasks.push(slimTask(t))
          }
        }
        const doneMine = await td(
          token,
          `/tasks/completed/by_completion_date?${new URLSearchParams({
            since,
            until,
            filter_query: 'assigned to: me',
            limit: '200',
          })}`,
        )
        for (const t of ((doneMine.items ?? doneMine.results ?? []) as Rec[])) {
          completed.push(slimTask({ ...t, checked: true }))
        }
        // Až když prošlo obojí, smí se na tyhle projekty pouštět úklid.
        assignedProjects = [...zPrirazenych]
      } catch {
        // Filtr Todoist odmítl (starší plán, jiný jazyk dotazu). Co se
        // stihlo natáhnout, platí; úklid se o to opírat nebude.
      }

      return json({ myUid, sections, tasks, completed, pulled, failed, assignedProjects })
    }

    // Založení úkolu v Todoistu. Na drátě jsou klíče snake_case a datum
    // se posílá buď jako due_date (celý den), nebo due_datetime (s časem).
    if (action === 'create') {
      // U podúkolu určuje zařazení rodič — posílat k tomu ještě projekt
      // a sekci by si Todoist mohl vyložit jako spor.
      const parentId = body.parentId ? String(body.parentId) : undefined
      const body2: Rec = {
        content: String(body.title ?? '').trim(),
        description: body.notes ? String(body.notes) : undefined,
        parent_id: parentId,
        project_id: parentId ? undefined : body.projectId ? String(body.projectId) : undefined,
        section_id: parentId ? undefined : body.sectionId ? String(body.sectionId) : undefined,
        priority: body.priority ? Number(body.priority) : undefined,
      }
      if (body.dueDate && body.dueTime) body2.due_datetime = `${body.dueDate}T${body.dueTime}:00`
      else if (body.dueDate) body2.due_date = String(body.dueDate)
      if (body.deadline) body2.deadline_date = String(body.deadline)
      if (!body2.content) return json({ error: 'úkol bez názvu' }, 400)
      const created = await td(token, '/tasks', {
        method: 'POST',
        body: JSON.stringify(clean(body2)),
      })
      return json({ task: slimTask(created) })
    }

    if (action === 'update') {
      const taskId = String(body.taskId ?? '')
      if (!taskId) return json({ error: 'chybí taskId' }, 400)
      const patch: Rec = {}
      if (typeof body.title === 'string') patch.content = body.title.trim()
      if (typeof body.notes === 'string') patch.description = body.notes
      if (body.priority) patch.priority = Number(body.priority)
      // Vymazání termínu má v Todoistu vlastní zaklínadlo.
      if ('dueDate' in body) {
        if (!body.dueDate) patch.due_string = 'no date'
        else if (body.dueTime) patch.due_datetime = `${body.dueDate}T${body.dueTime}:00`
        else patch.due_date = String(body.dueDate)
      }
      if ('deadline' in body) patch.deadline_date = body.deadline ? String(body.deadline) : null
      const updated = await td(token, `/tasks/${taskId}`, {
        method: 'POST',
        body: JSON.stringify(patch),
      })
      return json({ task: slimTask(updated) })
    }

    // Komentáře u úkolu. Jména autorů se dotahují ze spolupracovníků
    // projektu — samotný komentář nese jen uid, a „napsal 49020" nikomu nepomůže.
    if (action === 'comments') {
      const taskId = String(body.taskId ?? '')
      if (!taskId) return json({ error: 'chybí taskId' }, 400)
      const raw = await tdList(token, '/comments', { task_id: taskId })
      const names = new Map<string, string>()
      const projectId = s(body.projectId)
      if (projectId) {
        try {
          for (const c of await tdList(token, `/projects/${projectId}/collaborators`)) {
            names.set(String(c.id), (c.name as string) ?? '')
          }
        } catch {
          // bez jmen to pořád dává smysl
        }
      }
      const comments = raw
        .filter((c) => !c.is_deleted)
        .map((c) => {
          const att = c.file_attachment as Rec | null
          return {
            id: String(c.id),
            text: (c.content as string) ?? '',
            at: s(c.posted_at),
            authorId: s(c.posted_uid),
            author: names.get(String(c.posted_uid ?? '')) ?? '',
            attachment: att?.file_name ? String(att.file_name) : undefined,
          }
        })
      return json({ comments })
    }

    if (action === 'comment') {
      const taskId = String(body.taskId ?? '')
      const content = String(body.content ?? '').trim()
      if (!taskId || !content) return json({ error: 'prázdný komentář' }, 400)
      await td(token, '/comments', {
        method: 'POST',
        body: JSON.stringify({ task_id: taskId, content }),
      })
      return json({ ok: true })
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
