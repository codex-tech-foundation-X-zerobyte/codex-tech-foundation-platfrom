-- Root cause of the reported "call doesn't alert the other person" bug:
-- postgres_changes Realtime subscriptions only fire for tables explicitly
-- added to the supabase_realtime publication — it is NOT automatic just
-- because RLS/a table exists. 20260916000001_team_chat.sql did this for
-- chat_messages; `calls` was never added, so CallProvider's
-- listenForCalls() subscription was listening for events that Postgres
-- was never configured to send. The row was created successfully (the
-- caller correctly saw "ringing"), it just never reached the callee.

alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.group_calls;
alter publication supabase_realtime add table public.group_call_participants;
