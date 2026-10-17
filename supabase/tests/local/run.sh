#!/bin/bash
# Rebuild a throwaway local PostgreSQL from every migration, then run every SQL test file.
# Needs PostgreSQL 16 (apt-get install -y postgresql) and root/postgres access. Stubs the parts of Supabase the migrations lean on
# (auth.users/uid(), storage tables, roles, the realtime publication) and mimics Supabase's default table grants.
set -u
cd "$(dirname "$0")/../../.."
pg_ctlcluster 16 main start 2>/dev/null; sleep 2
P="su postgres -c"
$P "psql -q -c 'drop database if exists ctf' -c 'create database ctf'" 2>/dev/null
$P "psql -q -d ctf -f $PWD/supabase/tests/local/pgstub.sql" >/dev/null 2>&1
$P "psql -q -d ctf -c 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role' -c 'alter default privileges in schema public grant all on sequences to anon, authenticated, service_role' -c 'alter default privileges in schema public grant execute on functions to anon, authenticated, service_role'" >/dev/null 2>&1
for f in supabase/migrations/*.sql; do
  $P "psql -q -d ctf -v ON_ERROR_STOP=1 -f $PWD/$f" >/tmp/mig.out 2>&1 || { echo "MIGRATION FAIL $f"; grep -iE "error" /tmp/mig.out | head -3; exit 1; }
done
$P "psql -q -d ctf -c 'grant execute on all functions in schema public to anon, authenticated, service_role'" >/dev/null 2>&1
tp=0; tf=0
for t in supabase/tests/*.test.sql; do
  $P "psql -d ctf -v ON_ERROR_STOP=1 -f $PWD/$t" >/tmp/t.out 2>&1; rc=$?
  p=$(grep -c PASS /tmp/t.out); tp=$((tp + p)); echo "$(basename "$t"): rc=$rc pass=$p"
  if [ $rc -ne 0 ]; then tf=$((tf + 1)); grep -E "ERROR|FAIL" /tmp/t.out | head -2 | cut -c1-260; fi
done
echo "TOTAL SQL PASS: $tp  FAILED FILES: $tf"
[ $tf -eq 0 ]
