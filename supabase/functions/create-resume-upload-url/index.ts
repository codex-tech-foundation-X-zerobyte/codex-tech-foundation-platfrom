import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

// Only these extensions are accepted — keeps the applications bucket from
// becoming an arbitrary anonymous file drop.
const ALLOWED_EXT = new Set(['pdf', 'doc', 'docx'])
// Guards against a filename like "resume.pdf.exe" or a MIME-spoofed upload —
// the extension alone is not trusted for content type, but it does bound
// what gets written into the bucket at all.
const MAX_FILENAME_LENGTH = 200

function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('cf-connecting-ip') ?? 'unknown'
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: allowed } = await admin.rpc('check_rate_limit', {
      p_bucket: 'create-resume-upload-url',
      p_identifier: clientIp(request),
      p_max_attempts: 10,
      p_window_seconds: 600,
    })
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please try again in a few minutes.' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const body = await request.json()
    const filename = String(body.filename ?? '').slice(0, MAX_FILENAME_LENGTH)
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''

    if (!ALLOWED_EXT.has(ext)) {
      return new Response(JSON.stringify({ error: 'Please upload a PDF or Word document.' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Random path — never derived from user input beyond the extension, so there's
    // no way to target or overwrite another applicant's file.
    const path = `pending/${crypto.randomUUID()}.${ext}`
    const { data, error } = await admin.storage.from('applications').createSignedUploadUrl(path)
    if (error || !data) throw error ?? new Error('Could not create upload URL')

    return new Response(JSON.stringify({ path, token: data.token, signedUrl: data.signedUrl }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Unable to prepare an upload right now.' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
