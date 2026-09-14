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

    expect(workout.deletedAt?.toUtc(), now);
    expect(deleteMutation.baseVersion, 0);
  });

  test('assignment and partial return are stored offline', () async {
    final workspaceId = await repository.createWorkspace(
      ownerUserId: 'coach-1',
      name: 'Coach one',
    );
    final workoutId = await repository.createWorkout(
      workspaceId: workspaceId,
      title: 'Training',
      startsAt: now,
    );
    final traineeId = await repository.addTrainee(
      workspaceId: workspaceId,
      name: 'Trainee',
    );
    final equipmentId = await repository.addEquipment(
      workspaceId: workspaceId,
      name: 'Stretcher',
      totalQuantity: 5,
    );
    final assignmentId = await repository.saveAssignment(
      workspaceId: workspaceId,
      workoutId: workoutId,
      traineeId: traineeId,
      equipmentId: equipmentId,
      quantity: 3,
    );

    await repository.setReturnedQuantity(
      assignmentId: assignmentId,
      returnedQuantity: 2,
    );

    final rows = await repository.watchAssignments(workoutId).first;
    expect(rows, hasLength(1));
    expect(rows.single.quantity, 3);
    expect(rows.single.returnedQuantity, 2);
    expect(await repository.assignedQuantity(
      workoutId: workoutId,
      equipmentId: equipmentId,
    ), 3);
  });

  test('deleting a workout tombstones its assignments and returns', () async {
    final workspaceId = await repository.createWorkspace(
      ownerUserId: 'coach-1',
      name: 'Coach one',
    );
    final workoutId = await repository.createWorkout(
      workspaceId: workspaceId,
      title: 'Training',
      startsAt: now,
    );
    final traineeId = await repository.addTrainee(
      workspaceId: workspaceId,
      name: 'Trainee',
    );
    final equipmentId = await repository.addEquipment(
      workspaceId: workspaceId,
      name: 'Jerrycan',
      totalQuantity: 4,
    );
    final assignmentId = await repository.saveAssignment(
      workspaceId: workspaceId,
      workoutId: workoutId,
      traineeId: traineeId,
      equipmentId: equipmentId,
      quantity: 1,
    );
    await repository.setReturnedQuantity(
      assignmentId: assignmentId,
      returnedQuantity: 1,
    );

    await repository.deleteWorkout(workoutId);

    final assignment = await (database.select(database.assignments)..where(
          (row) => row.id.equals(assignmentId),
        ))
        .getSingle();
    final equipmentReturn =
        await database.select(database.equipmentReturns).getSingle();
    expect(assignment.deletedAt, isNotNull);
    expect(equipmentReturn.deletedAt, isNotNull);
  });

  test('import replacement atomically replaces assignments and returns', () async {
    final workspaceId = await repository.createWorkspace(
      ownerUserId: 'coach-1',
      name: 'Coach one',
    );
    final workoutId = await repository.createWorkout(
      workspaceId: workspaceId,
      title: 'Training',
      startsAt: now,
    );
    final traineeId = await repository.addTrainee(
      workspaceId: workspaceId,
      name: 'Trainee',
    );
    final equipmentId = await repository.addEquipment(
      workspaceId: workspaceId,
      name: 'Jerrycan',
      totalQuantity: 4,
    );
    await repository.saveAssignment(
      workspaceId: workspaceId,
      workoutId: workoutId,
      traineeId: traineeId,
      equipmentId: equipmentId,
      quantity: 1,
    );

    await repository.replaceWorkoutAssignments(
      workspaceId: workspaceId,
      workoutId: workoutId,
      replacements: [
        AssignmentReplacement(
          traineeId: traineeId,
          equipmentId: equipmentId,
          quantity: 3,
          returnedQuantity: 2,
        ),
      ],
    );

    final visible = await repository.getAssignments(workoutId);
    final allAssignments = await database.select(database.assignments).get();
    expect(visible, hasLength(1));
    expect(visible.single.quantity, 3);
    expect(visible.single.returnedQuantity, 2);
    expect(allAssignments, hasLength(2));
    expect(allAssignments.where((row) => row.deletedAt != null), hasLength(1));
  });
}
