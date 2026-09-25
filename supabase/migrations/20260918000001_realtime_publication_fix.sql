-- CRITICAL FIX: Supabase Realtime only broadcasts postgres_changes for
-- tables explicitly added to the `supabase_realtime` publication — RLS
-- correctness and client subscription code are irrelevant if the table
-- was never added here at all. Only `messages` was ever added (Pass 5's
-- migration). `calls` was used with postgres_changes starting in Pass 6
-- (subscribeToChannelCalls, and the global IncomingCallListener built
-- later) and has been silently unable to fire a single event this whole
-- time — this is very likely the real, underlying reason incoming calls
-- were never actually alerting anyone, independent of the UI-level fix
-- (the global listener) that was built believing the subscription itself
-- already worked. `notifications` needs the same fix for the new live
-- unread-badge feed (subscribeToMyNotifications).
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.notifications;
