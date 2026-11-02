import { adminClient, enforceRateLimitByKey, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { authorizeCaller, forbiddenResponse, generateTempPassword } from '../_shared/auth.ts'

/**
 * Main-Admin-only account management for workers, managers and client logins.
 *
 *   { action: 'details',        user_id }  → sign-in facts only auth.users knows (email, last sign-in, …)
 *   { action: 'reset_password', user_id }  → new temporary password, shown once, forced change at next sign-in
 *   { action: 'delete',         user_id }  → permanently removes the account and everything that blocked it
 *
 * The service-role key bypasses RLS, so every rule below is enforced here, not assumed from the database.
 */

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const admin = adminClient()

  const caller = await authorizeCaller(admin, request)
  if (!caller || caller.role !== 'superadmin') return forbiddenResponse(cors)
  if (!(await enforceRateLimitByKey(admin, `manage-account:${caller.userId}`, { maxEvents: 40, windowSeconds: 600 }))) return rateLimitedResponse(cors)

  let body: { action?: string; user_id?: string }
  try { body = await request.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const action = body.action
  const userId = String(body.user_id ?? '')
  if (!UUID.test(userId)) return json({ error: 'A valid user is required.' }, 400)

  const { data: target } = await admin.from('profiles').select('id, role, display_name').eq('id', userId).maybeSingle()
  if (!target) return json({ error: 'That account no longer exists.' }, 404)

  // Never operate on a Main Admin through this endpoint (that includes yourself): losing the last one locks everyone out.
  if (target.role === 'superadmin') return json({ error: 'A Main Admin account cannot be changed here.' }, 403)

  try {
    if (action === 'details') {
      const { data, error } = await admin.auth.admin.getUserById(userId)
      if (error || !data.user) return json({ error: 'Could not load that account.' }, 404)
      const u = data.user
      return json({ email: u.email ?? null, last_sign_in_at: u.last_sign_in_at ?? null, created_at: u.created_at, email_confirmed: Boolean(u.email_confirmed_at) })
    }

    if (action === 'reset_password') {
      const tempPassword = generateTempPassword()
      const { error } = await admin.auth.admin.updateUserById(userId, { password: tempPassword })
      if (error) throw error
      // Make them choose their own at the next sign-in, and end any session that used the old password.
      await Promise.all([
        admin.from('worker_profiles').update({ must_change_password: true }).eq('user_id', userId),
        admin.from('client_users').update({ must_change_password: true }).eq('user_id', userId),
      ])
      await admin.auth.admin.signOut(userId, 'global').catch(() => undefined)
      await admin.from('audit_logs').insert({ actor_user_id: caller.userId, action: 'account.password_reset', resource_type: 'profiles', resource_id: userId, severity: 'warning', metadata: { role: target.role } })
      // Returned once, never logged or stored.
      return json({ temp_password: tempPassword })
    }

    if (action === 'delete') {
      // Write the audit entry FIRST, naming who was removed: after this the profile row (and so the name) is gone for good.
      await admin.from('audit_logs').insert({
        actor_user_id: caller.userId, action: 'account.deleted', resource_type: 'profiles', resource_id: userId, severity: 'warning',
        metadata: { role: target.role, display_name: target.display_name },
      })

      // Staff hand shared work (meetings they organised, records they authored) to the admin doing this; a client's own
      // requests are theirs alone, so for clients nothing is reassigned.
      const reassign = target.role === 'client' ? null : caller.userId
      for (const table of ['public.profiles', 'auth.users', 'public.worker_profiles', 'public.client_users']) {
        const { error } = await admin.rpc('detach_references', { p_table: table, p_id: userId, p_reassign_to: reassign })
        if (error) throw new Error(`Clearing references on ${table}: ${error.message}`)
      }

      // Revoke every session first so a signed-in browser can't keep acting while the account is being removed.
      await admin.auth.admin.signOut(userId, 'global').catch(() => undefined)
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
      if (deleteError) throw deleteError
      return json({ ok: true })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (err) {
    console.error('manage-account failed:', err instanceof Error ? err.message : err)
    return json({ error: 'That did not work. Nothing was lost — please try again, and check the function logs if it keeps failing.' }, 500)
  }
})
