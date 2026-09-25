-- Leads had RLS and public-submission Edge Functions since early passes,
-- but no admin UI ever existed to actually work a lead — every enquiry
-- from the public site's contact/start-project forms has been landing
-- here with nobody able to see, assign, or act on it. Adding the two
-- columns real lead management needs; everything else (view/manage
-- policies) already exists from the Pass 3 RLS fix.

alter table public.leads add column if not exists notes text not null default '';
alter table public.leads add column if not exists assigned_to uuid references public.profiles(id);
create index if not exists leads_assigned_to_idx on public.leads(assigned_to);
