-- Combat Equipment cloud schema. Run once in the Supabase SQL editor.
-- Admin account: liadpro12345@gmail.com

create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null default 'coach' check (role in ('coach', 'admin')),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_lower_key
  on public.profiles (lower(email));
create index if not exists profiles_role_idx on public.profiles (role);

create table if not exists public.coach_states (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists coach_states_updated_at_idx
  on public.coach_states (updated_at desc);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('insert', 'update', 'delete')),
  revision bigint,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_owner_created_idx
  on public.audit_events (owner_id, created_at desc);
create index if not exists audit_events_actor_created_idx
  on public.audit_events (actor_id, created_at desc);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and disabled_at is null
  );
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    lower(coalesce(new.email, new.id::text || '@no-email.invalid')),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    case when lower(coalesce(new.email, '')) = 'liadpro12345@gmail.com' then 'admin' else 'coach' end
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    role = case when excluded.email = 'liadpro12345@gmail.com' then 'admin' else 'coach' end,
    updated_at = now();

  insert into public.coach_states (owner_id, data, updated_by)
  values (new.id, '{}'::jsonb, new.id)
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function private.handle_new_user();

insert into public.profiles (id, email, display_name, role)
select
  id,
  lower(coalesce(email, '')),
  coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', ''),
  case when lower(coalesce(email, '')) = 'liadpro12345@gmail.com' then 'admin' else 'coach' end
from auth.users
where email is not null
on conflict (id) do update set
  email = excluded.email,
  display_name = excluded.display_name,
  role = case when excluded.email = 'liadpro12345@gmail.com' then 'admin' else public.profiles.role end,
  updated_at = now();

insert into public.coach_states (owner_id, data, updated_by)
select id, '{}'::jsonb, id from public.profiles
on conflict (owner_id) do nothing;

create or replace function private.prepare_state_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists prepare_coach_state_write on public.coach_states;
create trigger prepare_coach_state_write
  before insert or update on public.coach_states
  for each row execute function private.prepare_state_write();

create or replace function private.log_state_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (actor_id, owner_id, action, revision)
  values (
    (select auth.uid()),
    coalesce(new.owner_id, old.owner_id),
    lower(tg_op),
    coalesce(new.revision, old.revision)
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_coach_state_write on public.coach_states;
create trigger audit_coach_state_write
  after insert or update or delete on public.coach_states
  for each row execute function private.log_state_write();

alter table public.profiles enable row level security;
alter table public.coach_states enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists states_select_own_or_admin on public.coach_states;
create policy states_select_own_or_admin
on public.coach_states for select to authenticated
using (owner_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists states_insert_own_or_admin on public.coach_states;
create policy states_insert_own_or_admin
on public.coach_states for insert to authenticated
with check (owner_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists states_update_own_or_admin on public.coach_states;
create policy states_update_own_or_admin
on public.coach_states for update to authenticated
using (owner_id = (select auth.uid()) or (select private.is_admin()))
with check (owner_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists audit_select_own_or_admin on public.audit_events;
create policy audit_select_own_or_admin
on public.audit_events for select to authenticated
using (owner_id = (select auth.uid()) or actor_id = (select auth.uid()) or (select private.is_admin()));

revoke all on table public.profiles, public.coach_states, public.audit_events from anon;
grant usage on schema public to authenticated;
grant select on table public.profiles to authenticated;
grant select, insert, update on table public.coach_states to authenticated;
grant select on table public.audit_events to authenticated;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.prepare_state_write() from public, anon, authenticated;
revoke all on function private.log_state_write() from public, anon, authenticated;

-- Final verification queries (all three tables must show rowsecurity = true):
select relname, relrowsecurity
from pg_class
where oid in ('public.profiles'::regclass, 'public.coach_states'::regclass, 'public.audit_events'::regclass)
order by relname;
