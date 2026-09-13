import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uuid/uuid.dart';

import '../../../core/database/app_database.dart';

typedef IdFactory = String Function();
typedef Clock = DateTime Function();

/// All UI writes go through this repository.
///
/// Each business change and its outbox mutation are committed in one SQLite
/// transaction. A network call is deliberately never part of this path.
class OfflineRepository {
  OfflineRepository(this._database, {IdFactory? idFactory, Clock? clock})
    : _idFactory = idFactory ?? const Uuid().v7,
      _clock = clock ?? DateTime.now;

  final AppDatabase _database;
  final IdFactory _idFactory;
  final Clock _clock;

  Stream<List<Workout>> watchWorkouts(String workspaceId) {
    final query = _database.select(_database.workouts)
      ..where(
        (row) => row.workspaceId.equals(workspaceId) & row.deletedAt.isNull(),
      )
      ..orderBy([(row) => OrderingTerm.desc(row.startsAt)]);
    return query.watch();
  }

  Future<String> createWorkspace({
    required String ownerUserId,
    required String name,
  }) async {
    final id = _idFactory();
    final now = _clock().toUtc();
    final payload = <String, Object?>{
      'id': id,
      'owner_user_id': ownerUserId,
      'name': name,
      'created_at': now.toIso8601String(),
      'updated_at': now.toIso8601String(),
      'version': 0,
      'deleted_at': null,
    };

    await _database.transaction(() async {
      await _database
          .into(_database.workspaces)
          .insert(
            WorkspacesCompanion.insert(
              id: id,
              ownerUserId: ownerUserId,
              name: name,
              createdAt: now,
              updatedAt: now,
            ),
          );
      await _enqueue(
        workspaceId: id,
        entityTable: 'workspaces',
        entityId: id,
        operation: 'upsert',
        payload: payload,
        baseVersion: 0,
        createdAt: now,
      );
    });
    return id;
  }

  Future<String> createWorkout({
    required String workspaceId,
    required String title,
    required DateTime startsAt,
  }) async {
    final id = _idFactory();
    final now = _clock().toUtc();
    final startsAtUtc = startsAt.toUtc();
    final payload = <String, Object?>{
      'id': id,
      'workspace_id': workspaceId,
      'title': title,
      'starts_at': startsAtUtc.toIso8601String(),
      'status': 'draft',
      'created_at': now.toIso8601String(),
      'updated_at': now.toIso8601String(),
      'version': 0,
      'deleted_at': null,
    };

    await _database.transaction(() async {
      await _database
          .into(_database.workouts)
          .insert(
            WorkoutsCompanion.insert(
              id: id,
              workspaceId: workspaceId,
              title: title,
              startsAt: startsAtUtc,
              createdAt: now,
              updatedAt: now,
            ),
          );
      await _enqueue(
        workspaceId: workspaceId,
        entityTable: 'workouts',
        entityId: id,
        operation: 'upsert',
        payload: payload,
        baseVersion: 0,
        createdAt: now,
      );
    });
    return id;
  }

  Future<String> saveAssignment({
    required String workspaceId,
    required String workoutId,
    required String traineeId,
    required String equipmentId,
    required int quantity,
  }) async {
    if (quantity <= 0) {
      throw ArgumentError.value(quantity, 'quantity', 'must be positive');
    }

    final id = _idFactory();
    final now = _clock().toUtc();
    final payload = <String, Object?>{
      'id': id,
      'workspace_id': workspaceId,
      'workout_id': workoutId,
      'trainee_id': traineeId,
      'equipment_id': equipmentId,
      'quantity': quantity,
      'created_at': now.toIso8601String(),
      'updated_at': now.toIso8601String(),
      'version': 0,
      'deleted_at': null,
    };

    await _database.transaction(() async {
      await _database
          .into(_database.assignments)
          .insert(
            AssignmentsCompanion.insert(
              id: id,
              workspaceId: workspaceId,
              workoutId: workoutId,
              traineeId: traineeId,
              equipmentId: equipmentId,
              quantity: quantity,
              createdAt: now,
              updatedAt: now,
            ),
          );
      await _enqueue(
        workspaceId: workspaceId,
        entityTable: 'assignments',
        entityId: id,
        operation: 'upsert',
        payload: payload,
        baseVersion: 0,
        createdAt: now,
      );
    });
    return id;
  }

  Future<void> deleteWorkout(String workoutId) async {
    final workout = await (_database.select(
      _database.workouts,
    )..where((row) => row.id.equals(workoutId))).getSingle();
    final now = _clock().toUtc();

    await _database.transaction(() async {
      final childAssignments =
          await (_database.select(_database.assignments)..where(
                (row) =>
                    row.workoutId.equals(workoutId) & row.deletedAt.isNull(),
              ))
              .get();

      for (final assignment in childAssignments) {
        final nextVersion = assignment.version + 1;
        await (_database.update(
          _database.assignments,
        )..where((row) => row.id.equals(assignment.id))).write(
          AssignmentsCompanion(
            deletedAt: Value(now),
            updatedAt: Value(now),
            version: Value(nextVersion),
          ),
        );
        await _enqueue(
          workspaceId: assignment.workspaceId,
          entityTable: 'assignments',
          entityId: assignment.id,
          operation: 'delete',
          payload: {
            'id': assignment.id,
            'workspace_id': assignment.workspaceId,
            'deleted_at': now.toIso8601String(),
          },
          baseVersion: assignment.version,
          createdAt: now,
        );
      }

      final nextVersion = workout.version + 1;
      await (_database.update(
        _database.workouts,
      )..where((row) => row.id.equals(workoutId))).write(
        WorkoutsCompanion(
          deletedAt: Value(now),
          updatedAt: Value(now),
          version: Value(nextVersion),
        ),
      );
      await _enqueue(
        workspaceId: workout.workspaceId,
        entityTable: 'workouts',
        entityId: workout.id,
        operation: 'delete',
        payload: {
          'id': workout.id,
          'workspace_id': workout.workspaceId,
          'deleted_at': now.toIso8601String(),
        },
        baseVersion: workout.version,
        createdAt: now,
      );
    });
  }

  Future<void> _enqueue({
    required String workspaceId,
    required String entityTable,
    required String entityId,
    required String operation,
    required Map<String, Object?> payload,
    required int baseVersion,
    required DateTime createdAt,
  }) {
    return _database
        .into(_database.syncQueueItems)
        .insert(
          SyncQueueItemsCompanion.insert(
            id: _idFactory(),
            workspaceId: workspaceId,
            entityTable: entityTable,
            entityId: entityId,
            operation: operation,
            payloadJson: jsonEncode(payload),
            baseVersion: baseVersion,
            createdAt: createdAt,
          ),
        );
  }
}
