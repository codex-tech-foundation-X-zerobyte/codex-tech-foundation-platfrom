const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

// Deliberately does nothing but respond — no DB call, no rate limiting, no
// auth check. Its only job is to prove the edge functions runtime itself is
// reachable and responding, for the admin health dashboard. A DB-touching
// health signal comes from the dashboard's own profiles count query instead
// (see AdminDashboard.tsx) — this function answering doesn't imply the
// database is healthy, only that this specific function is.
Deno.serve((request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  return new Response(JSON.stringify({ ok: true, checked_at: new Date().toISOString() }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
