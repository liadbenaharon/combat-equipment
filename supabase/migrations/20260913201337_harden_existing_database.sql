-- The function is used internally by Supabase's RLS automation and must not be
-- callable through the public Data API.
revoke all on function public.rls_auto_enable() from public;
revoke all on function public.rls_auto_enable() from anon;
revoke all on function public.rls_auto_enable() from authenticated;

create index if not exists coach_states_updated_by_idx
  on public.coach_states (updated_by)
  where updated_by is not null;
