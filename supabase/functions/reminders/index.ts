// Průběžná upozornění (nad rámec ranního návrhu, Fáze 6).
//
// Jedna funkce, tři druhy — vybírá je pg_cron parametrem `kind`:
//   due      — každých 10 minut v pracovní době; hlásí úkol s časem
//              deadlineu, který začne za ~15 minut
//   shutdown — podvečer ve všední den; připomene zbylé úkoly a uzávěrku
//   review   — v neděli večer; pozvánka na týdenní ohlédnutí
//
// Proč server: iOS webovým appkám nedovolí naplánovat notifikaci lokálně,
// takže všechno časované musí přijít pushem zvenčí.
//
// Bez tabulky odeslaných: okno pro `due` je přesně jeden krok cronu
// (deterministický slot), takže tentýž úkol nepadne do dvou běhů. Ostatní
// druhy běží jednou denně/týdně. Tag v payloadu navíc stejný druh
// notifikace na telefonu nahrazuje, takže se nehromadí.
//
// Nasazeno na Supabase jako funkce `reminders` (verify_jwt: false — budí
// ji pg_cron se service role klíčem v hlavičce).

import { createClient } from 'npm:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.3'

type Rec = Record<string, unknown>

const APP_URL = 'https://michalkrausino.github.io/Todo-app/'

// Krok cronu pro `due` v minutách a předstih upozornění.
const SLOT_MIN = 10
const LEAD_MIN = 15

const pragueToday = (): string =>
  new Date().toLocaleDateString('sv', { timeZone: 'Europe/Prague' })

// Minuty od půlnoci v pražském čase.
const pragueMinutes = (): number => {
  const hm = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    minute: '2-digit',
  })
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

const toMin = (hm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h <= 23 && min <= 59 ? h * 60 + min : null
}

const eff = (t: Rec): string | undefined => {
  const dates = [t.scheduledFor, t.dueDate].filter(Boolean) as string[]
  return dates.sort()[0]
}

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n < 5 ? few : many

interface Payload {
  title: string
  body: string
  url: string
  tag: string
  badge: number
}

Deno.serve(async (req) => {
  const kind = new URL(req.url).searchParams.get('kind') ?? 'due'
  if (!['due', 'shutdown', 'review'].includes(kind)) {
    return Response.json({ error: 'neznámý kind' }, { status: 400 })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: jwk, error: vapidErr } = await admin.rpc('get_vapid_keys')
  if (vapidErr || !jwk) {
    return Response.json({ error: vapidErr?.message ?? 'chybí VAPID klíče' }, { status: 500 })
  }
  const vapidKeys = await webpush.importVapidKeys(jwk, { extractable: false })
  const appServer = await webpush.ApplicationServer.new({
    contactInformation: 'mailto:michal2004cz@gmail.com',
    vapidKeys,
  })

  const { data: subs, error: subsErr } = await admin
    .from('push_subscriptions')
    .select('id, user_id, subscription')
  if (subsErr) return Response.json({ error: subsErr.message }, { status: 500 })

  const today = pragueToday()
  const nowMin = pragueMinutes()
  // Slot je zarovnaný na krok cronu, takže drobné zpoždění spuštění
  // neposune okno a žádný úkol nespadne do dvou běhů ani nevypadne.
  const slotStart = Math.floor(nowMin / SLOT_MIN) * SLOT_MIN
  const windowFrom = slotStart + LEAD_MIN - SLOT_MIN / 2
  const windowTo = windowFrom + SLOT_MIN

  const users = [...new Set((subs ?? []).map((s) => s.user_id as string))]
  let sent = 0

  for (const userId of users) {
    const { data: taskRows } = await admin
      .from('tasks')
      .select('data')
      .eq('user_id', userId)
      .is('deleted_at', null)
    const tasks = (taskRows ?? []).map((r) => r.data as Rec)

    // Odznak na ikoně — stejná logika jako v appce (src/lib/badge.ts).
    const badge = tasks.filter((t) => {
      if (t.status !== 'active' && t.status !== 'inbox') return false
      const d = eff(t)
      return d !== undefined && d <= today
    }).length

    const payloads: Payload[] = []

    if (kind === 'due') {
      const { data: clientRows } = await admin
        .from('clients')
        .select('data')
        .eq('user_id', userId)
        .is('deleted_at', null)
      const clientName = new Map(
        (clientRows ?? [])
          .map((r) => r.data as Rec)
          .map((c) => [c.id as string, c.name as string]),
      )

      for (const t of tasks) {
        if (t.status !== 'active' && t.status !== 'inbox') continue
        if (t.dueDate !== today || typeof t.dueTime !== 'string') continue
        const at = toMin(t.dueTime)
        if (at === null || at < windowFrom || at >= windowTo) continue
        const who = t.clientId ? clientName.get(t.clientId as string) : undefined
        payloads.push({
          title: `Za chvíli: ${t.title as string}`,
          body: `Termín ${t.dueTime}${who ? ` · ${who}` : ''}`,
          url: `${APP_URL}#task-${t.id as string}`,
          tag: `due-${t.id as string}`,
          badge,
        })
      }
    }

    if (kind === 'shutdown') {
      // Zbývá = dnešní i propadlé nedokončené úkoly. Když je čisto,
      // neposílá se nic — pochvala do notifikace nepatří.
      const left = tasks.filter((t) => {
        if (t.status !== 'active' && t.status !== 'inbox') return false
        const d = eff(t)
        return d !== undefined && d <= today
      })
      if (left.length > 0) {
        const first = left[0].title as string
        payloads.push({
          title: 'Uzávěrka dne',
          body:
            left.length === 1
              ? `Zbývá „${first}" — dej mu nový termín a zavři den.`
              : `Zbývá ${left.length} ${plural(left.length, 'úkol', 'úkoly', 'úkolů')} — dej jim nový termín a zavři den.`,
          url: `${APP_URL}#shutdown`,
          tag: 'shutdown',
          badge,
        })
      }
    }

    if (kind === 'review') {
      payloads.push({
        title: 'Týdenní ohlédnutí',
        body: 'Jak šel týden — hotové úkoly, plán vs. realita a výhled na ten další.',
        url: `${APP_URL}#review`,
        tag: 'week-review',
        badge,
      })
    }

    if (payloads.length === 0) continue

    for (const sub of (subs ?? []).filter((s) => s.user_id === userId)) {
      for (const payload of payloads) {
        try {
          const subscriber = appServer.subscribe(sub.subscription as webpush.PushSubscription)
          await subscriber.pushTextMessage(JSON.stringify(payload), {})
          sent++
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error('push failed', sub.id, msg)
          if (/404|410|gone|expired/i.test(msg)) {
            await admin.from('push_subscriptions').delete().eq('id', sub.id)
            break
          }
        }
      }
    }
  }

  return Response.json({ kind, users: users.length, sent, slot: `${windowFrom}-${windowTo}` })
})
