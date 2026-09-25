-- Adds the 'manager' role requested in the platform brief. This is its own
-- migration file, separate from the one that seeds/uses it
-- (20260914000001_manager_role_rbac.sql), because PostgreSQL will not let a
-- newly added enum value be referenced inside the same transaction that adds
-- it. Splitting into two files is the safe way to do this with the Supabase
-- CLI, which runs each migration file as its own transaction.

alter type public.app_role add value if not exists 'manager';
