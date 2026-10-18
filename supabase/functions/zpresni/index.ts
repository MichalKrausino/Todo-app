// Zpřesnění zadání přes placené API — VYPNUTO.
//
// Model teď běží jako rutina Claude Code na předplatném (viz
// supabase/rutina-zpresneni.md a supabase/zpresneni.sql), žádný API klíč
// nikde neleží. Tahle funkce zůstává jen kvůli starým verzím appky
// v mezipaměti telefonu: odpoví 503 a appka se do restartu přestane ptát.
// Až žádná stará verze neběží, jde funkce smazat (Supabase → Edge
// Functions → zpresni → Delete).
//
// Nasazeno na Supabase jako funkce `zpresni` (verify_jwt: true).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve((req) =>
  req.method === 'OPTIONS'
    ? new Response(null, { status: 204, headers: CORS })
    : Response.json({ error: 'nenastaveno' }, { status: 503, headers: CORS }),
)
