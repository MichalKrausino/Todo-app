// Ranní návrh dne (Fáze 6). Budí ho pg_cron v 5:00 UTC (7:00 léto / 6:00 zima).
//
// Chytrou verzi plánu připravuje před 5:00 UTC naplánovaná Claude úloha
// (předplatné, žádné API) — zapisuje day_plans se stejným deterministickým id.
// Tahle funkce čerstvý existující plán jen odešle jako push; když chybí,
// spočítá záložní plán čistou logikou (Fáze 6 bez modelu).
//
// Nasazeno na Supabase jako funkce `morning-plan` (verify_jwt: true).

import { createClient } from 'npm:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.3'
// Skórování a výběr jsou čistá logika ve vlastním souboru — testuje je
// pick.test.ts vitestem, sem se jen zavolají.
import { eff, pickSuggestions, scoreAndReason } from './pick.ts'

type Rec = Record<string, unknown>

const APP_URL = 'https://michalkrausino.github.io/Todo-app/'

const pragueToday = (): string =>
  new Date().toLocaleDateString('sv', { timeZone: 'Europe/Prague' })

// Deterministické UUID (stejný algoritmus jako v appce) — opakované spuštění
// téhož dne přepíše tentýž záznam, nevzniknou duplikáty.
async function deterministicUuid(...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join(' '))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data))
  const b = digest.slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

Deno.serve(async () => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: jwk, error: vapidErr } = await admin.rpc('get_vapid_keys')
  if (vapidErr || !jwk) {
    return Response.json({ error: `vapid: ${vapidErr?.message}` }, { status: 500 })
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
  // Neděle: místo ranního návrhu vede push na týdenní ohlédnutí (Fáze 7) —
  // návrh dne se přesto spočítá a uloží, v appce je vidět jako blok.
  const isSunday = new Date(`${today}T12:00:00Z`).getUTCDay() === 0
  const now = new Date().toISOString()
  const users = [...new Set((subs ?? []).map((s) => s.user_id as string))]
  let sent = 0

  for (const userId of users) {
    const [tasksRes, clientsRes] = await Promise.all([
      admin.from('tasks').select('data').eq('user_id', userId).is('deleted_at', null),
      admin.from('clients').select('data').eq('user_id', userId).is('deleted_at', null),
    ])
    const tasks = (tasksRes.data ?? []).map((r) => r.data as Rec)
    const clients = (clientsRes.data ?? []).map((r) => r.data as Rec)
    const clientsById = new Map(clients.map((c) => [c.id as string, c]))

    const taskById = new Map(tasks.map((t) => [t.id as string, t]))
    const planId = await deterministicUuid('dayplan', userId, today)

    // Dnešní plán už mohl připravit Claude (naplánovaná úloha) — nepřepisovat.
    const { data: existingRow } = await admin
      .from('day_plans')
      .select('data, updated_at, deleted_at')
      .eq('id', planId)
      .maybeSingle()
    const existing = existingRow?.data as Rec | undefined
    const existingSuggestions = (existing?.suggestions ?? []) as Rec[]
    const existingFresh =
      existing?.date === today &&
      existingSuggestions.length > 0 &&
      !existingRow?.deleted_at &&
      String(existingRow?.updated_at ?? '') >= `${today}T00:00:00`

    let suggestions: Array<{ taskId: string; reason: string; title: string }>

    if (existingFresh) {
      suggestions = existingSuggestions
        .filter((s) => taskById.has(s.taskId as string))
        .map((s) => ({
          taskId: s.taskId as string,
          reason: s.reason as string,
          title: (taskById.get(s.taskId as string)?.title as string) ?? 'Úkol',
        }))
    } else {
      const candidates = tasks
        .filter((t) => t.status === 'active' || t.status === 'inbox')
        .map((t) => ({ t, ...scoreAndReason(t, clientsById, today) }))
        .filter((x) => x.score > 0)

      // Pestrost, rezerva pro úkoly bez termínu a jejich vážení prioritou
      // řeší pickSuggestions — viz pick.ts.
      const picked = pickSuggestions(candidates)
      if (picked.length === 0 && !isSunday) continue

      if (picked.length > 0) {
        const plan = {
          id: planId,
          date: today,
          suggestions: picked.map((p) => ({
            taskId: p.t.id as string,
            reason: p.reason,
            decision: 'ignored',
          })),
          createdAt: now,
          updatedAt: now,
        }
        const { error: upsertErr } = await admin.from('day_plans').upsert({
          id: planId,
          user_id: userId,
          data: plan,
          updated_at: now,
          deleted_at: null,
        })
        if (upsertErr) {
          console.error('day_plans upsert', upsertErr.message)
          continue
        }
      }
      suggestions = picked.map((p) => ({
        taskId: p.t.id as string,
        reason: p.reason,
        title: p.t.title as string,
      }))
    }

    // Odznak na ikoně (iOS 16.4+): úkoly na dnes + po termínu — stejná
    // logika jako v appce (src/lib/badge.ts), aby ikona a UI souhlasily.
    const badge = tasks.filter((t) => {
      if (t.status !== 'active' && t.status !== 'inbox') return false
      const d = eff(t)
      return d !== undefined && d <= today
    }).length

    let payload: string
    if (isSunday) {
      payload = JSON.stringify({
        title: 'Týdenní ohlédnutí',
        body: 'Jak šel týden — hotové úkoly, plán vs. realita a výhled na ten další.',
        url: `${APP_URL}#review`,
        tag: 'week-review',
        badge,
      })
    } else {
      if (suggestions.length === 0) continue
      const first = suggestions[0]
      payload = JSON.stringify({
        title: 'Ranní návrh dne',
        body: `${suggestions.length} ${suggestions.length === 1 ? 'návrh' : suggestions.length < 5 ? 'návrhy' : 'návrhů'} · ${first.title} — ${first.reason}`,
        url: APP_URL,
        tag: 'morning-plan',
        badge,
      })
    }

    for (const sub of (subs ?? []).filter((s) => s.user_id === userId)) {
      try {
        const subscriber = appServer.subscribe(sub.subscription as webpush.PushSubscription)
        await subscriber.pushTextMessage(payload, {})
        sent++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('push failed', sub.id, msg)
        if (/404|410|gone|expired/i.test(msg)) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id)
        }
      }
    }
  }

  return Response.json({ users: users.length, sent, date: today })
})
