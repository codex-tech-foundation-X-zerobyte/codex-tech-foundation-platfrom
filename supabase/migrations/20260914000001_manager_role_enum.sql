-- Standalone on purpose: ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction as a statement that references the new value, so nothing else
-- goes in this file. The next migration (20260914000002) is where 'manager'
-- actually gets used in policies and seed data.
alter type public.app_role add value if not exists 'manager';
