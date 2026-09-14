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
      'equipment_returns',
      'attendance_records'
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
