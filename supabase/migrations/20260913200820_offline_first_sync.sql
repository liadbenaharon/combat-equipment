-- Additive offline-first sync backend. The legacy coach_states snapshot remains
-- untouched so the current web application keeps working during migration.

create table public.workspaces (
  id uuid primary key,
  owner_user_id uuid not null unique references public.profiles(id) on delete cascade,
  name text not null default '',
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.offline_records (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_table text not null check (
    entity_table in (
      'workspaces',
      'workouts',
      'trainees',
      'equipment_items',
      'assignments',
      'equipment_returns'
    )
  ),
  entity_id uuid not null,
  version bigint not null check (version > 0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (workspace_id, entity_table, entity_id)
);

create table public.sync_mutations (
  mutation_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_table text not null,
  entity_id uuid not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.sync_changes (
  sequence bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_table text not null,
  entity_id uuid not null,
  version bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index offline_records_workspace_updated_idx
  on public.offline_records (workspace_id, updated_at desc);
create index sync_changes_workspace_sequence_idx
  on public.sync_changes (workspace_id, sequence);
create index sync_mutations_workspace_created_idx
  on public.sync_mutations (workspace_id, created_at desc);

alter table public.workspaces enable row level security;
alter table public.offline_records enable row level security;
alter table public.sync_mutations enable row level security;
alter table public.sync_changes enable row level security;

create or replace function private.can_access_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.role = 'admin'
          and p.disabled_at is null
      )
      or exists (
        select 1
        from public.workspaces w
        join public.profiles p on p.id = w.owner_user_id
        where w.id = p_workspace_id
          and w.owner_user_id = (select auth.uid())
          and w.deleted_at is null
          and p.disabled_at is null
      )
    );
$$;

revoke all on function private.can_access_workspace(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.can_access_workspace(uuid) to authenticated;

create policy workspaces_select_accessible
on public.workspaces for select
to authenticated
using ((select private.can_access_workspace(id)));

create policy workspaces_insert_own_or_admin
on public.workspaces for insert
to authenticated
with check (
  owner_user_id = (select auth.uid())
  or (select private.is_admin())
);

create policy workspaces_update_own_or_admin
on public.workspaces for update
to authenticated
using ((select private.can_access_workspace(id)))
with check (
  owner_user_id = (select auth.uid())
  or (select private.is_admin())
);

create policy offline_records_select_accessible
on public.offline_records for select
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy sync_changes_select_accessible
on public.sync_changes for select
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy sync_mutations_select_accessible
on public.sync_mutations for select
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create or replace function private.ensure_profile_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspaces (id, owner_user_id, name)
  values (
    new.id,
    new.id,
    coalesce(nullif(new.display_name, ''), new.email)
  )
  on conflict (id) do update
  set name = excluded.name,
      updated_at = now();
  return new;
end;
$$;

revoke all on function private.ensure_profile_workspace() from public;

create trigger profiles_ensure_workspace
after insert or update of email, display_name on public.profiles
for each row execute function private.ensure_profile_workspace();

insert into public.workspaces (id, owner_user_id, name)
select
  p.id,
  p.id,
  coalesce(nullif(p.display_name, ''), p.email)
from public.profiles p
on conflict (id) do nothing;

create or replace function private.capture_offline_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sync_changes (
    workspace_id,
    entity_table,
    entity_id,
    version,
    payload
  ) values (
    new.workspace_id,
    new.entity_table,
    new.entity_id,
    new.version,
    new.payload
  );
  return new;
end;
$$;

revoke all on function private.capture_offline_change() from public;

create trigger offline_records_capture_change
after insert or update on public.offline_records
for each row execute function private.capture_offline_change();

create or replace function private.push_offline_changes_impl(p_mutations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_mutation_id uuid;
  v_workspace_id uuid;
  v_entity_table text;
  v_entity_id uuid;
  v_operation text;
  v_payload jsonb;
  v_base_version bigint;
  v_current_version bigint;
  v_current_payload jsonb;
  v_current_sequence bigint;
  v_next_version bigint;
  v_now timestamptz;
  v_deleted_at timestamptz;
  v_normalized_payload jsonb;
  v_acknowledged jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'p_mutations must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_mutations) > 100 then
    raise exception 'A maximum of 100 mutations is allowed' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_mutations)
  loop
    v_mutation_id := (v_item ->> 'mutation_id')::uuid;
    v_workspace_id := (v_item ->> 'workspace_id')::uuid;
    v_entity_table := v_item ->> 'entity_table';
    v_entity_id := (v_item ->> 'entity_id')::uuid;
    v_operation := v_item ->> 'operation';
    v_payload := coalesce(v_item -> 'payload', '{}'::jsonb);
    v_base_version := coalesce((v_item ->> 'base_version')::bigint, 0);

    if v_entity_table not in (
      'workspaces',
      'workouts',
      'trainees',
      'equipment_items',
      'assignments',
      'equipment_returns'
    ) then
      raise exception 'Unsupported entity table: %', v_entity_table using errcode = '22023';
    end if;

    if v_operation not in ('upsert', 'delete') then
      raise exception 'Unsupported operation: %', v_operation using errcode = '22023';
    end if;

    if not (select private.can_access_workspace(v_workspace_id)) then
      raise exception 'Workspace access denied' using errcode = '42501';
    end if;

    if exists (
      select 1 from public.sync_mutations m
      where m.mutation_id = v_mutation_id
        and m.workspace_id = v_workspace_id
    ) then
      v_acknowledged := v_acknowledged || jsonb_build_array(v_mutation_id::text);
      continue;
    end if;

    select r.version, r.payload
    into v_current_version, v_current_payload
    from public.offline_records r
    where r.workspace_id = v_workspace_id
      and r.entity_table = v_entity_table
      and r.entity_id = v_entity_id;

    if (v_current_version is null and v_base_version <> 0)
      or (v_current_version is not null and v_current_version <> v_base_version) then
      select max(c.sequence)
      into v_current_sequence
      from public.sync_changes c
      where c.workspace_id = v_workspace_id
        and c.entity_table = v_entity_table
        and c.entity_id = v_entity_id;

      v_conflicts := v_conflicts || jsonb_build_array(
        jsonb_build_object(
          'sequence', coalesce(v_current_sequence, 0),
          'workspace_id', v_workspace_id,
          'entity_table', v_entity_table,
          'entity_id', v_entity_id,
          'version', coalesce(v_current_version, 0),
          'payload', coalesce(v_current_payload, '{}'::jsonb)
        )
      );
      continue;
    end if;

    v_now := now();
    v_next_version := coalesce(v_current_version, 0) + 1;
    v_deleted_at := case
      when v_operation = 'delete'
        then coalesce((v_payload ->> 'deleted_at')::timestamptz, v_now)
      else null
    end;
    v_normalized_payload := v_payload || jsonb_build_object(
      'id', v_entity_id,
      'workspace_id', v_workspace_id,
      'version', v_next_version,
      'updated_at', v_now,
      'deleted_at', v_deleted_at
    );

    insert into public.offline_records (
      workspace_id,
      entity_table,
      entity_id,
      version,
      payload,
      updated_at,
      deleted_at
    ) values (
      v_workspace_id,
      v_entity_table,
      v_entity_id,
      v_next_version,
      v_normalized_payload,
      v_now,
      v_deleted_at
    )
    on conflict (workspace_id, entity_table, entity_id) do update
    set version = excluded.version,
        payload = excluded.payload,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at;

    insert into public.sync_mutations (
      mutation_id,
      workspace_id,
      entity_table,
      entity_id,
      result
    ) values (
      v_mutation_id,
      v_workspace_id,
      v_entity_table,
      v_entity_id,
      jsonb_build_object('version', v_next_version)
    );

    v_acknowledged := v_acknowledged || jsonb_build_array(v_mutation_id::text);
  end loop;

  return jsonb_build_object(
    'acknowledged', v_acknowledged,
    'conflicts', v_conflicts
  );
end;
$$;

revoke all on function private.push_offline_changes_impl(jsonb) from public;
grant execute on function private.push_offline_changes_impl(jsonb) to authenticated;

create or replace function public.push_offline_changes(p_mutations jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.push_offline_changes_impl(p_mutations);
$$;

revoke all on function public.push_offline_changes(jsonb) from public;
revoke all on function public.push_offline_changes(jsonb) from anon;
grant execute on function public.push_offline_changes(jsonb) to authenticated;

create or replace function public.pull_offline_changes(
  p_workspace_id uuid,
  p_after_sequence bigint default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_changes jsonb;
  v_next_cursor bigint;
begin
  if not (select private.can_access_workspace(p_workspace_id)) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;

  with page as (
    select
      c.sequence,
      c.workspace_id,
      c.entity_table,
      c.entity_id,
      c.version,
      c.payload
    from public.sync_changes c
    where c.workspace_id = p_workspace_id
      and c.sequence > greatest(p_after_sequence, 0)
    order by c.sequence
    limit 500
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'sequence', page.sequence,
          'workspace_id', page.workspace_id,
          'entity_table', page.entity_table,
          'entity_id', page.entity_id,
          'version', page.version,
          'payload', page.payload
        ) order by page.sequence
      ),
      '[]'::jsonb
    ),
    coalesce(max(page.sequence), greatest(p_after_sequence, 0))
  into v_changes, v_next_cursor
  from page;

  return jsonb_build_object(
    'changes', v_changes,
    'next_cursor', v_next_cursor
  );
end;
$$;

revoke all on function public.pull_offline_changes(uuid, bigint) from public;
revoke all on function public.pull_offline_changes(uuid, bigint) from anon;
grant execute on function public.pull_offline_changes(uuid, bigint) to authenticated;

grant select on public.workspaces to authenticated;
grant select on public.offline_records to authenticated;
grant select on public.sync_changes to authenticated;

comment on table public.offline_records is
  'Versioned remote record store for the native offline-first client.';
comment on function public.push_offline_changes(jsonb) is
  'Idempotently applies up to 100 authorized offline mutations.';
comment on function public.pull_offline_changes(uuid, bigint) is
  'Returns up to 500 authorized changes after a workspace cursor.';
