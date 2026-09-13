import 'package:combat_equipment/core/database/app_database.dart';
import 'package:combat_equipment/features/workouts/data/offline_repository.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late AppDatabase database;
  late OfflineRepository repository;
  var sequence = 0;
  final now = DateTime.utc(2026, 9, 13, 12);

  setUp(() {
    database = AppDatabase.forTesting(NativeDatabase.memory());
    repository = OfflineRepository(
      database,
      idFactory: () => 'id-${sequence++}',
      clock: () => now,
    );
  });

  tearDown(() => database.close());

  test('offline workout write also creates an outbox mutation', () async {
    final workspaceId = await repository.createWorkspace(
      ownerUserId: 'coach-1',
      name: 'Coach one',
    );

    final workoutId = await repository.createWorkout(
      workspaceId: workspaceId,
      title: 'Monday',
      startsAt: now,
    );

    final workout = await (database.select(
      database.workouts,
    )..where((row) => row.id.equals(workoutId))).getSingle();
    final queue = await database.select(database.syncQueueItems).get();

    expect(workout.title, 'Monday');
    expect(queue, hasLength(2));
    expect(queue.last.entityTable, 'workouts');
    expect(queue.last.entityId, workoutId);
  });

  test('deleting a workout keeps a tombstone and queues deletion', () async {
    final workspaceId = await repository.createWorkspace(
      ownerUserId: 'coach-1',
      name: 'Coach one',
    );
    final workoutId = await repository.createWorkout(
      workspaceId: workspaceId,
      title: 'Deleted workout',
      startsAt: now,
    );

    await repository.deleteWorkout(workoutId);

    final workout = await (database.select(
      database.workouts,
    )..where((row) => row.id.equals(workoutId))).getSingle();
    final deleteMutation =
        await (database.select(database.syncQueueItems)
              ..where((row) => row.entityId.equals(workoutId))
              ..where((row) => row.operation.equals('delete')))
            .getSingle();

    expect(workout.deletedAt, now);
    expect(deleteMutation.baseVersion, 0);
  });
}
