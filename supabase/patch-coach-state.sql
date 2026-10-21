-- Lets the app send only the data keys that changed instead of the whole workspace.
-- Safe to run more than once. Runs with the caller's rights, so the coach_states RLS policies still apply.
create or replace function public.patch_coach_state(
  p_owner uuid,
  p_revision bigint,
  p_set jsonb default '{}'::jsonb,
  p_remove text[] default '{}'::text[]
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  update public.coach_states
  set data = (data || coalesce(p_set, '{}'::jsonb)) - coalesce(p_remove, '{}'::text[])
  where owner_id = p_owner
    and revision = p_revision
    and jsonb_typeof(coalesce(p_set, '{}'::jsonb)) = 'object'
  returning revision;
$$;

revoke all on function public.patch_coach_state(uuid, bigint, jsonb, text[]) from public, anon;
grant execute on function public.patch_coach_state(uuid, bigint, jsonb, text[]) to authenticated;
