-- Fix: starting a presentation failed with 403 (42501) in the app.
-- The app inserts a row and asks for it back (INSERT ... RETURNING). The row-visibility policy called can_see_presentation(id), which LOOKS UP
-- the row by id in the table. A function like that cannot see a row that the same statement is still inserting, so the policy refused the
-- returned row and the whole insert failed. The policy now reads the row's own columns, so it works for new rows too.
-- (can_see_presentation stays: file access in storage uses it, and there the session row already exists.)

drop policy if exists "presentations readable by their audience" on public.presentation_sessions;
create policy "presentations readable by their audience" on public.presentation_sessions for select to authenticated using (
     presenter_id = auth.uid()
  or public."current_role"() = 'superadmin'
  or (public."current_role"() in ('worker', 'manager') and (
        visibility = 'company'
     or (department_id is not null and department_id = any (public.current_department_ids()))
  ))
);
