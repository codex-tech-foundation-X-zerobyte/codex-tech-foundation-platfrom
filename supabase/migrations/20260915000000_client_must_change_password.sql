alter table public.client_users add column if not exists must_change_password boolean not null default true;
