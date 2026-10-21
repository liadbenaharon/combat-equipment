-- A harmless query for the daily keep-alive workflow, so the free project is not paused for inactivity.
-- Reads no tables and returns no data. Safe to run more than once.
create or replace function public.keepalive()
returns text
language sql
stable
security invoker
set search_path = ''
as $$ select 'ok'::text $$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
