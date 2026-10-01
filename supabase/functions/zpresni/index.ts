// Zpřesnění zadání úkolu modelem (Fáze 5).
//
// Appka sem posílá text, který člověk napsal, co z něj vytáhl parser
// v telefonu, a jména klientů / projektů / lidí, mezi kterými se smí
// vybírat. Funkce vrátí NÁVRH — appka ho nikdy nepoužije sama, jen ho
// nabídne. Zadávání úkolu na tohle nikdy nečeká: úkol už dávno leží
// v telefonu, tohle přijde, až bude síť.
//
// Tři pojistky:
// 1. Mezipaměť (`zpresneni`, klíč = otisk celého vstupu). Druhé zařízení
//    téhož člověka i opakovaný pokus po výpadku dostanou hotovou odpověď
//    a model se neplatí dvakrát.
// 2. Denní strop na člověka (`DENNI_STROP`). Chyba v appce, která by se
//    zacyklila, stojí nejvýš tolik — ne účet za celou noc.
// 3. Odpověď se čistí (`ocisti` v navrh.ts): co neodkazuje do poslaného
//    seznamu nebo není platné datum, se zahodí.
//
// API klíč modelu je tajemství funkce (`ANTHROPIC_API_KEY` v Supabase →
// Edge Functions → Secrets), do prohlížeče se nedostane. Bez něj funkce
// odpoví 503 `nenastaveno` a appka se do restartu přestane ptát.
//
// Nasazeno na Supabase jako funkce `zpresni` (verify_jwt: true).

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { klic, LIMITY, ocisti, SCHEMA, SYSTEM, zprava, type Kontext, type Parser } from './navrh.ts'

type Rec = Record<string, unknown>

const DENNI_STROP = 150
const MODEL = 'claude-opus-5-5'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: Rec, status = 200) => Response.json(body, { status, headers: CORS })

const pragueToday = (): string => new Date().toLocaleDateString('sv', { timeZone: 'Europe/Prague' })

async function otisk(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const s = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max) : ''

// Vstup z appky se bere jako nedůvěryhodný: ořízne se na limity a co
// nemá správný tvar, vypadne. Velikost dotazu (a tím cena) je tak shora
// omezená bez ohledu na to, co appka pošle.
function vstup(body: Rec): { zadani: string; parser: Parser; kontext: Kontext } | null {
  const zadani = s(body.zadani, LIMITY.zadani).trim()
  if (!zadani) return null
  const p = (body.parser ?? {}) as Rec
  const parser: Parser = {
    nazev: s(p.nazev, LIMITY.nazev),
    klientId: s(p.klientId, 64) || undefined,
    projektId: s(p.projektId, 64) || undefined,
    termin: s(p.termin, 10) || undefined,
    cas: s(p.cas, 5) || undefined,
    priorita: (['low', 'normal', 'high', 'critical'] as const).find((x) => x === p.priorita),
  }
  const k = (body.kontext ?? {}) as Rec
  const pole = (v: unknown, max: number) => (Array.isArray(v) ? (v as Rec[]).slice(0, max) : [])
  const kontext: Kontext = {
    dnes: pragueToday(),
    klienti: pole(k.klienti, LIMITY.klientu)
      .map((c) => ({ id: s(c.id, 64), jmeno: s(c.jmeno, LIMITY.jmeno) }))
      .filter((c) => c.id && c.jmeno),
    projekty: pole(k.projekty, LIMITY.projektu)
      .map((c) => ({ id: s(c.id, 64), jmeno: s(c.jmeno, LIMITY.jmeno), klientId: s(c.klientId, 64) }))
      .filter((c) => c.id && c.jmeno && c.klientId),
    lide: pole(k.lide, LIMITY.lidi)
      .map((c) => ({ id: s(c.id, 64), jmeno: s(c.jmeno, LIMITY.jmeno) }))
      .filter((c) => c.id && c.jmeno),
  }
  return { zadani, parser, kontext }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'chybí autorizace' }, 401)
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !userData.user) return json({ error: 'neplatné přihlášení' }, 401)
    const userId = userData.user.id

    const v = vstup((await req.json().catch(() => ({}))) as Rec)
    if (!v) return json({ error: 'prázdné zadání' }, 400)

    const id = await otisk(klic(v.zadani, v.parser, v.kontext))
    const { data: hotovo } = await admin
      .from('zpresneni')
      .select('navrh')
      .eq('user_id', userId)
      .eq('klic', id)
      .maybeSingle()
    if (hotovo) return json({ navrh: hotovo.navrh, mezipamet: true })

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ error: 'nenastaveno' }, 503)

    // Den podle UTC — strop je pojistka proti zacyklení, ne účetnictví,
    // takže na posunu o hodinu dvě nezáleží.
    const odPulnoci = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`
    const { count } = await admin
      .from('zpresneni')
      .select('klic', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', odPulnoci)
    if ((count ?? 0) >= DENNI_STROP) return json({ error: 'limit' }, 429)

    const client = new Anthropic({ apiKey })
    // Extrakce z jedné věty: nízké úsilí stačí a drží cenu i čekání dole.
    // Fallback „default": když bezpečnostní filtr dotaz odmítne, server
    // ho sám zkusí na jiném modelu — místo prázdné odpovědi.
    const params = {
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: zprava(v.zadani, v.parser, v.kontext) }],
    }
    // deno-lint-ignore no-explicit-any
    const res = await client.beta.messages.create(params as any)

    let navrh = {}
    if (res.stop_reason === 'end_turn') {
      const blok = res.content.find((b) => b.type === 'text')
      if (blok && blok.type === 'text') {
        try {
          navrh = ocisti(JSON.parse(blok.text), v.parser, v.kontext)
        } catch {
          navrh = {}
        }
      }
    }
    // Ukládá se i prázdný návrh: „model k tomu nic nemá" je taky odpověď
    // a druhé zařízení se na ni nemá ptát znovu.
    await admin.from('zpresneni').upsert({ user_id: userId, klic: id, navrh })
    return json({ navrh })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'limit' }, 429)
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'nenastaveno' }, 503)
    if (e instanceof Anthropic.APIError) return json({ error: `model ${e.status ?? ''}`.trim() }, 502)
    return json({ error: (e as Error).message }, 500)
  }
})
