# Offline-first foundation

The native Android client treats local SQLite as the source of truth for the UI.
Every user edit writes the business record and an outbox entry in one database
transaction. Network availability never blocks creating or editing a workout.

## Identity and tenancy

- Every coach has a Supabase Auth account and a workspace.
- The cached local profile stores whether the signed-in user is a coach or admin.
- Every business row contains `workspace_id`.
- A coach can sync only workspaces granted to that coach.
- An admin can read and edit every workspace.
- Authorization is enforced by Supabase RLS/RPC checks, not by Flutter UI alone.
- A first Google sign-in needs internet. An already cached session can reopen the
  locally stored workspace offline.

## Sync contract

1. Save locally and append a UUID mutation to `sync_queue` atomically.
2. When internet is usable, push mutations in creation order.
3. Supabase applies each mutation idempotently using `mutation_id`.
4. Pull changes after the workspace cursor.
5. If the same row has an unpushed local mutation, store a `sync_conflicts` row
   instead of silently losing either version.
6. Realtime may wake the sync engine, but correctness depends on push/pull.

The initial Flutter foundation does not call the new RPCs yet. The production
`coach_states` JSON snapshot remains unchanged until the normalized migration,
RLS policies, and compatibility import have been reviewed and tested.

## Next implementation slice

- Generate Drift code and run local repository tests.
- Add repositories for workouts, trainees, equipment, assignments, and returns.
- Implement `SyncEngine` retries with exponential backoff.
- Add the normalized Supabase migration and two RPCs.
- Import existing `coach_states` snapshots without deleting the originals.
