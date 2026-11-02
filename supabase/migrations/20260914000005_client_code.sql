alter table public.client_users add column if not exists client_code text unique;
create index if not exists client_users_client_code_idx on public.client_users(client_code);
