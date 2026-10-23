import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

// Only these extensions are accepted — keeps the applications bucket from
// becoming an arbitrary anonymous file drop.
const ALLOWED_EXT = new Set(['pdf', 'doc', 'docx'])

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = adminClient()
  if (!(await enforceRateLimit(admin, request, 'create-resume-upload-url', { maxEvents: 8, windowSeconds: 600 }))) {
    return rateLimitedResponse(cors)
  }
  try {
    const body = await request.json()
    const filename = String(body.filename ?? '')
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
