// Ověření napojení na Todoist bez nasazeného serveru a bez pravého tokenu.
//
// Pouští SKUTEČNÝ kód edge funkce (supabase/functions/todoist/index.ts)
// i SKUTEČNOU klientskou vrstvu (src/sync/todoist.ts) proti falešnému
// Todoistu; podvržený je jen Todoist a Supabase. Ověřuje tedy přesně to,
// co jinak jde vyzkoušet až v provozu: že se stáhnou správné úkoly,
// správně se namapují a odškrtnutí letí zpátky.
//
//   node scripts/overit-todoist.mjs      (nebo npm run overit:todoist)

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import fs from 'node:fs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(`${ROOT}package.json`)
const esbuild = require('esbuild')
await import(`${ROOT}node_modules/fake-indexeddb/auto/index.js`)

// Port mimo seznam „bad ports" prohlížečového fetch (4190 = sieve, blokuje se).
const PORT = 4200
const API_BASE = `http://localhost:${PORT}`
const SUPA = 'http://falesne-supabase'

// ---------------------------------------------------------------------------
// Falešný Todoist — tvary odpovědí podle oficiálních schémat (snake_case,
// stránkování {results, next_cursor}).
// ---------------------------------------------------------------------------

const calls = []

const PROJECTS_PAGE1 = [
  { id: '220', name: 'Alza — web 2026', color: 'berry_red', is_shared: true, is_archived: false,
    is_favorite: false, is_deleted: false, parent_id: null, child_order: 1 },
]
const PROJECTS_PAGE2 = [
  { id: '221', name: 'Osobní', color: 'charcoal', is_shared: false, is_archived: false,
    is_favorite: false, is_deleted: false, parent_id: null, child_order: 2 },
  { id: '222', name: 'Starý projekt', color: 'grey', is_shared: true, is_archived: true,
    is_favorite: false, is_deleted: false, parent_id: null, child_order: 3 },
  { id: '223', name: 'Projekt bez přístupu', color: 'grey', is_shared: true, is_archived: false,
    is_favorite: false, is_deleted: false, parent_id: null, child_order: 4 },
]

const TASKS = [
  { id: '7001', project_id: '220', section_id: '55', parent_id: null, content: 'Připravit report kampaní',
    description: 'Za duben, včetně PNO.', priority: 3, labels: ['klient'], responsible_uid: '49020',
    checked: false, is_deleted: false, updated_at: '2026-08-30T10:00:00Z',
    due: { date: '2026-09-02', datetime: null, string: '2. září', is_recurring: false },
    deadline: { date: '2026-09-04', lang: 'cs' }, duration: { amount: 90, unit: 'minute' } },
  { id: '7002', project_id: '220', section_id: null, parent_id: null, content: 'Zavolat na fakturaci',
    description: '', priority: 1, labels: [], responsible_uid: null, checked: false, is_deleted: false,
    updated_at: '2026-08-30T10:00:00Z',
    due: { date: '2026-09-01', datetime: '2026-09-01T14:00:00', string: 'zítra 14:00', is_recurring: false },
    deadline: null, duration: null },
  { id: '7003', project_id: '220', section_id: null, parent_id: null, content: 'Grafika bannerů',
    description: '', priority: 1, labels: [], responsible_uid: 'nekdo-jiny', checked: false,
    is_deleted: false, updated_at: '2026-08-30T10:00:00Z', due: null, deadline: null, duration: null },
  { id: '7004', project_id: '220', section_id: '55', parent_id: '7001', content: 'Stáhnout data z Skliku',
    description: '', priority: 1, labels: [], responsible_uid: '49020', checked: false, is_deleted: false,
    updated_at: '2026-08-30T10:00:00Z', due: null, deadline: null, duration: null },
]

const CREATED = []
const UPDATES = []

const COMPLETED = [
  { id: '7005', project_id: '220', section_id: '55', parent_id: '7001', content: 'Domluvit přístupy',
    description: '', priority: 1, labels: [], responsible_uid: '49020', checked: true, is_deleted: false,
    completed_at: '2026-08-29T08:30:00Z', updated_at: '2026-08-29T08:30:00Z',
    due: null, deadline: null, duration: null },
]

function startFakeTodoist() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    calls.push(`${req.method} ${url.pathname}`)
    const send = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== 'Bearer TAJNY-TOKEN') return send({ error: 'unauthorized' }, 401)
    const p = url.pathname
    if (p === '/api/v1/user') return send({ id: '49020', email: 'michal@example.com', full_name: 'Michal' })
    if (p === '/api/v1/projects') {
      return url.searchParams.get('cursor') === 'p2'
        ? send({ results: PROJECTS_PAGE2, next_cursor: null })
        : send({ results: PROJECTS_PAGE1, next_cursor: 'p2' })
    }
    if (p === '/api/v1/projects/220/collaborators') {
      return send({ results: [
        { id: '49020', name: 'Michal', email: 'michal@example.com' },
        { id: 'nekdo-jiny', name: 'Petra z Alzy', email: 'petra@alza.cz' },
      ], next_cursor: null })
    }
    if (p === '/api/v1/projects/222/collaborators') return send({ results: [], next_cursor: null })
    if (p === '/api/v1/projects/223/collaborators') return send({ results: [], next_cursor: null })
    if (p === '/api/v1/sections') {
      const pid = url.searchParams.get('project_id')
      if (pid === '223') return send({ error: 'project not found' }, 404)
      return send({
        results: pid === '220' ? [{ id: '55', project_id: '220', name: 'Kampaně', is_deleted: false }] : [],
        next_cursor: null,
      })
    }
    if (p === '/api/v1/tasks' && req.method === 'POST') {
      let raw = ''
      req.on('data', (c) => { raw += c })
      return req.on('end', () => {
        const body = JSON.parse(raw || '{}')
        const created = {
          id: `9${CREATED.length + 1}`, project_id: body.project_id, section_id: body.section_id ?? null,
          parent_id: null, content: body.content, description: body.description ?? '',
          priority: body.priority ?? 1, labels: [], responsible_uid: '49020', checked: false,
          is_deleted: false, updated_at: '2026-08-30T12:00:00Z',
          due: body.due_date ? { date: body.due_date, datetime: null, string: '', is_recurring: false }
             : body.due_datetime ? { date: body.due_datetime.slice(0, 10), datetime: body.due_datetime, string: '', is_recurring: false }
             : null,
          deadline: body.deadline_date ? { date: body.deadline_date, lang: 'cs' } : null, duration: null,
        }
        CREATED.push({ body, created })
        TASKS.push(created)
        send(created)
      })
    }
    if (p === '/api/v1/tasks') {
      const pid = url.searchParams.get('project_id')
      if (pid === '223') return send({ error: 'project not found' }, 404)
      return send({ results: TASKS.filter((t) => t.project_id === pid), next_cursor: null })
    }
    if (/^\/api\/v1\/tasks\/\d+$/.test(p) && req.method === 'POST') {
      let raw = ''
      req.on('data', (c) => { raw += c })
      return req.on('end', () => {
        const body = JSON.parse(raw || '{}')
        const id = p.split('/').pop()
        const task = TASKS.find((t) => t.id === id)
        UPDATES.push({ id, body })
        if (task) {
          if (body.content !== undefined) task.content = body.content
          if (body.description !== undefined) task.description = body.description
          if (body.priority !== undefined) task.priority = body.priority
          if (body.deadline_date !== undefined) task.deadline = body.deadline_date ? { date: body.deadline_date, lang: 'cs' } : null
          if (body.due_date) task.due = { date: body.due_date, datetime: null, string: '', is_recurring: false }
          task.updated_at = '2026-08-30T13:00:00Z'
        }
        send(task ?? {})
      })
    }
    if (p === '/api/v1/tasks/completed/by_completion_date') {
      const pid = url.searchParams.get('project_id')
      if (pid === '223') return send({ error: 'project not found' }, 404)
      return send({ items: pid === '220' ? COMPLETED : [] })
    }
    if (/^\/api\/v1\/tasks\/\d+\/(close|reopen)$/.test(p)) { res.writeHead(204); return res.end() }
    return send({ error: `neznámý endpoint ${p}` }, 404)
  })
  return new Promise((r) => server.listen(PORT, () => r(server)))
}

// ---------------------------------------------------------------------------
// Edge funkce ze zdroje: zamění se jen Deno runtime a Supabase klient.
// ---------------------------------------------------------------------------

async function buildEdgeHandler() {
  let src = fs.readFileSync(`${ROOT}supabase/functions/todoist/index.ts`, 'utf8')
  src = src.replace(
    "import { createClient } from 'npm:@supabase/supabase-js@2'",
    `const createClient = () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { api_token: 'TAJNY-TOKEN' } }) }) }) }),
      auth: { getUser: async () => ({ data: { user: { id: 'uzivatel-1' } }, error: null }) },
    })`,
  )
  src = src.replace("const API = 'https://api.todoist.com/api/v1'", `const API = '${API_BASE}/api/v1'`)
  const { code } = await esbuild.transform(src, { loader: 'ts', format: 'esm', target: 'node22' })
  const file = '/tmp/edge-todoist.mjs'
  fs.writeFileSync(file, code)
  let handler
  globalThis.Deno = { serve: (h) => { handler = h }, env: { get: () => 'stub' } }
  await import(`file://${file}?t=${Date.now()}`)
  if (!handler) throw new Error('Deno.serve se nezavolal — edge funkce se nenačetla')
  return handler
}

// ---------------------------------------------------------------------------
// Klientská vrstva ze zdroje: podstrčí se jen přihlášená relace.
// ---------------------------------------------------------------------------

async function buildClient() {
  fs.writeFileSync('/tmp/engine-stub.js', `
export const getSupabase = () => ({
  auth: { getSession: async () => ({ data: { session: { access_token: 'JWT' } } }) },
  rpc: async () => ({ data: true, error: null }),
})`)
  const entry = '/tmp/klient-entry.ts'
  fs.writeFileSync(entry, `
export { db } from '${ROOT}src/db/db'
export { addClient, updateClient, addTask } from '${ROOT}src/db/repo'
export { refreshTodoist, fetchTodoistProjects, getTodoistStatus, sendTaskToTodoist,
         pushTodoistEdits, addTodoistSubtask, setTodoistSubtaskDone } from '${ROOT}src/sync/todoist'
`)
  const out = '/tmp/klient-bundle.mjs'
  await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', target: 'node22', outfile: out,
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(SUPA),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('anon-key'),
    },
    plugins: [{ name: 'stub-engine', setup(b) {
      b.onResolve({ filter: /(^|\/)engine$/ }, () => ({ path: '/tmp/engine-stub.js' }))
    } }],
  })
  return import(`file://${out}?t=${Date.now()}`)
}

// ---------------------------------------------------------------------------

const fails = []
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) fails.push(name)
}

const server = await startFakeTodoist()
const edge = await buildEdgeHandler()

Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.startsWith(`${SUPA}/functions/v1/todoist`)) {
    return edge(new Request(url, { ...init, method: init?.method ?? 'POST' }))
  }
  return realFetch(input, init)
}

const { db, addClient, updateClient, addTask, refreshTodoist, fetchTodoistProjects,
        getTodoistStatus, sendTaskToTodoist, pushTodoistEdits, addTodoistSubtask,
        setTodoistSubtaskDone } = await buildClient()

console.log('\n— párovací obrazovka —')
const { projects, user } = await fetchTodoistProjects()
ok('edge funkce vrátila přihlášeného uživatele', user.id === '49020', user.email)
ok('stránkování projektů funguje (2 stránky)', projects.length === 4, `${projects.length} projektů`)
const shared = projects.filter((p) => p.isShared)
ok('sdílené projekty se poznají', shared.length === 3, shared.map((p) => p.name).join(', '))
const alza = projects.find((p) => p.id === '220')
ok('u sdíleného projektu jsou spolupracovníci', alza.collaborators.length === 2,
   alza.collaborators.map((c) => c.email).join(', '))
ok('u vlastního projektu se spolupracovníci netahají', projects.find((p) => p.id === '221').collaborators.length === 0)

console.log('\n— „+ založit klienta" a spárování —')
const created = await addClient({ name: alza.name, color: '#FF3B30', kind: 'client' })
await updateClient(created.id, { todoistProjectIds: [alza.id] })
const client = await db.clients.get(created.id)
ok('klient vznikl z názvu projektu', client.name === 'Alza — web 2026', client.name)
ok('párování drží na klientovi (a syncuje se na druhé zařízení)',
   client.todoistProjectIds?.[0] === '220')

console.log('\n— stažení —')
await refreshTodoist(true)
ok('stahování skončilo bez chyby', !getTodoistStatus().lastError, getTodoistStatus().lastError ?? 'ok')

const tasks = (await db.tasks.toArray()).filter((x) => !x.deletedAt)
const byTitle = Object.fromEntries(tasks.map((x) => [x.title, x]))
console.log('  úkoly v databázi:', tasks.map((x) => x.title).join(' | ') || '(žádné)')

ok('stáhly se moje a nepřiřazené úkoly', tasks.length === 2, `${tasks.length}`)
ok('cizí přiřazený úkol se netáhl', !byTitle['Grafika bannerů'])

const report = byTitle['Připravit report kampaní']
ok('úkol visí pod klientem', report?.clientId === created.id)
ok('deadline → termín', report?.dueDate === '2026-09-04', report?.dueDate)
ok('due → naplánováno na', report?.scheduledFor === '2026-09-02', report?.scheduledFor)
ok('priorita p2 → vysoká', report?.priority === 'high', report?.priority)
ok('popis → poznámka', report?.notes === 'Za duben, včetně PNO.')
ok('délka 90 min → tichý odhad času', report?.estimateMinutes === 90, String(report?.estimateMinutes))
ok('podúkoly → checklist včetně hotového', report?.subtasks?.length === 2,
   report?.subtasks?.map((s) => `${s.title}${s.done ? ' ✓' : ''}`).join(', '))

const call = byTitle['Zavolat na fakturaci']
ok('nepřiřazený úkol se bere taky', Boolean(call))
ok('čas z due datetime', call?.dueTime === '14:00', call?.dueTime)
ok('den z due datetime', call?.dueDate === '2026-09-01', call?.dueDate)

const projs = (await db.projects.toArray()).filter((p) => !p.deletedAt)
ok('sekce se stala projektem pod klientem', projs.length === 1 && projs[0].name === 'Kampaně',
   projs.map((p) => p.name).join(', '))
ok('úkol ze sekce spadl do toho projektu', report?.projectId === projs[0]?.id)

console.log('\n— opakování a zpětný zápis —')
const before = (await db.tasks.toArray()).map((x) => `${x.id}:${x.updatedAt}`).sort().join()
await refreshTodoist(true)
const after = (await db.tasks.toArray()).map((x) => `${x.id}:${x.updatedAt}`).sort().join()
ok('druhé stažení nic nepřepisuje ani nezdvojuje', before === after)

calls.length = 0
await db.tasks.update(report.id, { status: 'done', completedAt: new Date().toISOString() })
await refreshTodoist(true)
ok('odškrtnutí v appce zavře úkol i v Todoistu', calls.includes('POST /api/v1/tasks/7001/close'),
   calls.filter((c) => c.includes('close')).join(', ') || 'nic')

console.log('\n— úprava úkolu z appky letí do Todoistu —')
await db.tasks.update(report.id, { status: 'active', completedAt: undefined, todoistDoneAt: undefined })
await db.tasks.update(report.id, { title: 'Report kampaní — do pondělí', todoistDirty: true })
await pushTodoistEdits()
const edit = UPDATES.find((u) => u.id === '7001')
ok('úprava dorazila do Todoistu', edit?.body.content === 'Report kampaní — do pondělí', edit?.body.content)
ok('termín se vrátil do pole, ze kterého přišel (deadline)', 'deadline_date' in (edit?.body ?? {}),
   JSON.stringify(edit?.body ?? {}).slice(0, 120))
ok('po odeslání už úkol nečeká', !(await db.tasks.get(report.id))?.todoistDirty)

console.log('\n— založení úkolu z appky —')
const local = await addTask({ title: 'Poslat návrh rozpočtu', clientId: created.id, dueDate: '2026-09-10' })
const sendErr = await sendTaskToTodoist(local.id)
ok('odeslání proběhlo bez chyby', sendErr === null, sendErr ?? 'ok')
const madeIn = CREATED.at(-1)
ok('úkol vznikl ve správném projektu', madeIn?.body.project_id === '220', madeIn?.body.project_id)
ok('poslal se název i termín', madeIn?.body.content === 'Poslat návrh rozpočtu' && madeIn?.body.due_date === '2026-09-10',
   `${madeIn?.body.content} / ${madeIn?.body.due_date}`)
const adopted = (await db.tasks.toArray()).find((x) => x.todoistId === madeIn.created.id && !x.deletedAt)
ok('úkol v appce dostal značku Todoistu', Boolean(adopted), adopted?.todoistId)
await refreshTodoist(true)
const dupes = (await db.tasks.toArray()).filter((x) => !x.deletedAt && x.title === 'Poslat návrh rozpočtu')
ok('další stažení ho nezdvojilo', dupes.length === 1, `${dupes.length}×`)

console.log('\n— checklist a podúkoly v Todoistu —')
const novyKrok = await addTodoistSubtask('7001', 'Ověřit čísla s klientem')
ok('nový krok vznikl i v Todoistu', Boolean(novyKrok), novyKrok ?? 'nic')
const sub = CREATED.at(-1)
ok('poslal se jako podúkol pod rodičem', sub?.body.parent_id === '7001', sub?.body.parent_id)
ok('podúkol neposílá projekt ani sekci (určuje je rodič)',
   !('project_id' in sub.body) && !('section_id' in sub.body))

calls.length = 0
await setTodoistSubtaskDone('td-7004', true)
ok('odškrtnutí kroku zavře podúkol v Todoistu', calls.includes('POST /api/v1/tasks/7004/close'),
   calls.join(', ') || 'nic')
calls.length = 0
await setTodoistSubtaskDone('td-7004', false)
ok('vrácení kroku ho v Todoistu otevře', calls.includes('POST /api/v1/tasks/7004/reopen'),
   calls.join(', ') || 'nic')
calls.length = 0
await setTodoistSubtaskDone('muj-vlastni-krok', true)
ok('vlastní krok nikam nevolá', calls.length === 0, calls.join(', '))

console.log('\n— ztracený přístup k jednomu projektu —')
await updateClient(created.id, { todoistProjectIds: ['220', '223'] })
const pocetPred = (await db.tasks.toArray()).filter((x) => !x.deletedAt).length
await refreshTodoist(true)
const st = getTodoistStatus()
ok('stažení kvůli jednomu projektu nespadlo', !st.lastError, st.lastError ?? 'ok')
ok('nedostupný projekt se ohlásil', st.unreachable?.includes('223'), (st.unreachable ?? []).join(', '))
ok('úkoly ostatních projektů zůstaly', (await db.tasks.toArray()).filter((x) => !x.deletedAt).length === pocetPred)

server.close()
console.log(fails.length ? `\nSELHALO: ${fails.join(' | ')}` : '\nCelý řetěz prošel')
process.exit(fails.length ? 1 : 0)
