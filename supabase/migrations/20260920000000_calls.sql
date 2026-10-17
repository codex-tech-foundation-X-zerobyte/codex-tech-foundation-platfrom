-- Voice/video calls, 1:1 only for this pass (no group/conference — the
-- ~8-10 person target from the original spec is future SFU work, out of
-- scope here). Internal only: worker/manager/superadmin, matching chat's
-- client-exclusion pattern — clients don't get a calling surface in this
-- pass either.
--
-- This table holds call SESSION STATE (who called whom, status, timing) —
-- needed for missed-call detection, call history, and notifications. The
-- actual WebRTC signaling (SDP offer/answer, ICE candidates) is NOT stored
-- here or anywhere in the database — it's exchanged directly between the
-- two peers via an ephemeral Supabase Realtime broadcast channel scoped to
-- one call (see src/lib/services/calls.ts), which matches "do not store
-- audio or video streams in database tables" and, more specifically, avoids
-- persisting the signaling payloads at all.

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references auth.users(id),
  callee_id uuid not null references auth.users(id),
  type text not null check (type in ('voice', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'declined', 'missed', 'ended', 'cancelled')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create index if not exists calls_callee_idx on public.calls(callee_id, started_at desc);
create index if not exists calls_caller_idx on public.calls(caller_id, started_at desc);

alter table public.calls enable row level security;

-- Only the two participants ever see a call row — not project members, not
-- "any worker" the way chat/tasks/etc. are scoped. A call is inherently
-- between two specific people.
create policy "participants read own calls" on public.calls for select using (
  auth.uid() = caller_id or auth.uid() = callee_id
);
create policy "internal users start calls" on public.calls for insert with check (
  auth.uid() = caller_id and public.current_role() in ('worker', 'manager', 'superadmin')
  and exists (select 1 from public.profiles where id = callee_id and role in ('worker', 'manager', 'superadmin'))
);
-- Either participant can update status (callee accepts/declines, caller
-- cancels, either side ends) — but only status/timing fields matter here,
-- and only for their own call.
create policy "participants update own calls" on public.calls for update using (
  auth.uid() = caller_id or auth.uid() = callee_id
) with check (
  auth.uid() = caller_id or auth.uid() = callee_id
);

create trigger audit_call_created after insert on public.calls
  for each row execute procedure public.audit_row_change('call.started');
create trigger audit_call_status_changed after update on public.calls
  for each row when (old.status is distinct from new.status)
  execute procedure public.audit_row_change('call.status_changed');
