-- project_status was ('planning','active','review','complete'). Postgres
-- enums can only have values ADDED in place, not removed — and this needs
-- 'review'/'complete' gone, replaced by the spec's fuller vocabulary. So:
-- new type, new column, remap data, swap, drop the old type. Mapping chosen
-- to preserve meaning for any existing rows:
--   planning -> planning   (unchanged)
--   active   -> active     (unchanged)
--   review   -> in_development  (still being worked on/reviewed, not yet live)
--   complete -> completed  (unchanged meaning, renamed for consistency)

create type public.project_status_v2 as enum (
  'planning', 'in_development', 'active', 'maintenance', 'paused', 'completed', 'archived'
);

alter table public.projects add column status_v2 public.project_status_v2;

update public.projects set status_v2 = case status
  when 'planning' then 'planning'
  when 'active' then 'active'
  when 'review' then 'in_development'
  when 'complete' then 'completed'
end::public.project_status_v2;

alter table public.projects alter column status_v2 set not null;
alter table public.projects alter column status_v2 set default 'planning';

alter table public.projects drop column status;
alter table public.projects rename column status_v2 to status;

drop type public.project_status;
alter type public.project_status_v2 rename to project_status;
