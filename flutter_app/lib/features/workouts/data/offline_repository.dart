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

  Stream<List<Trainee>> watchTrainees(String workspaceId) {
    final query = _database.select(_database.trainees)
      ..where(
        (row) => row.workspaceId.equals(workspaceId) & row.deletedAt.isNull(),
      )
      ..orderBy([(row) => OrderingTerm.asc(row.name)]);
    return query.watch();
  }

  Stream<List<EquipmentItem>> watchEquipment(String workspaceId) {
    final query = _database.select(_database.equipmentItems)
      ..where(
        (row) => row.workspaceId.equals(workspaceId) & row.deletedAt.isNull(),
      )
      ..orderBy([(row) => OrderingTerm.asc(row.name)]);
    return query.watch();
  }

  Future<List<Workout>> getWorkouts(String workspaceId) {
    final query = _database.select(_database.workouts)
      ..where(
        (row) => row.workspaceId.equals(workspaceId) & row.deletedAt.isNull(),
      )
      ..orderBy([(row) => OrderingTerm.desc(row.startsAt)]);
    return query.get();
  }

  Future<List<Trainee>> getTrainees(String workspaceId) {
    final query = _database.select(_database.trainees)
      ..where(
        (row) => row.workspaceId.equals(workspaceId) & row.deletedAt.isNull(),
      );
    return query.get();
  }

  Future<List<EquipmentItem>> getEquipment(String workspaceId) {
    final query = _database.select(_database.equipmentItems)
      ..where(
        (row) => row.workspaceId.equals(workspaceId) & row.deletedAt.isNull(),
      );
    return query.get();
  }

  Future<List<AssignmentOverview>> getAssignments(String workoutId) {
    return watchAssignments(workoutId).first;
  }

  Stream<List<AssignmentOverview>> watchAssignments(String workoutId) {
    return _database
        .customSelect(
          '''
          SELECT a.id,
                 a.equipment_id,
                 a.trainee_id,
                 a.quantity,
                 t.name AS trainee_name,
                 e.name AS equipment_name,
                 COALESCE(r.returned_quantity, 0) AS returned_quantity
          FROM assignments a
          JOIN trainees t ON t.id = a.trainee_id
          JOIN equipment_items e ON e.id = a.equipment_id
          LEFT JOIN equipment_returns r
            ON r.assignment_id = a.id AND r.deleted_at IS NULL
          WHERE a.workout_id = ?
            AND a.deleted_at IS NULL
            AND t.deleted_at IS NULL
            AND e.deleted_at IS NULL
          ORDER BY t.name, e.name
          ''',
          variables: [Variable.withString(workoutId)],
          readsFrom: {
            _database.assignments,
            _database.trainees,
            _database.equipmentItems,
            _database.equipmentReturns,
          },
        )
        .watch()
        .map(
          (rows) => rows
              .map(
                (row) => AssignmentOverview(
                  id: row.read<String>('id'),
                  equipmentId: row.read<String>('equipment_id'),
                  traineeId: row.read<String>('trainee_id'),
                  traineeName: row.read<String>('trainee_name'),
                  equipmentName: row.read<String>('equipment_name'),
                  quantity: row.read<int>('quantity'),
                  returnedQuantity: row.read<int>('returned_quantity'),
                ),
              )
              .toList(),
        );
  }

  Stream<List<AttendanceOverview>> watchAttendance({
    required String workspaceId,
    required String workoutId,
  }) {
    return _database
        .customSelect(
          '''
          SELECT t.id AS trainee_id,
                 t.name AS trainee_name,
                 ar.id AS record_id,
                 COALESCE(ar.status, 'unknown') AS status
          FROM trainees t
          LEFT JOIN attendance_records ar
            ON ar.trainee_id = t.id
           AND ar.workout_id = ?
           AND ar.deleted_at IS NULL
          WHERE t.workspace_id = ?
            AND t.deleted_at IS NULL
          ORDER BY t.name
          ''',
          variables: [
            Variable.withString(workoutId),
            Variable.withString(workspaceId),
          ],
          readsFrom: {_database.trainees, _database.attendanceRecords},
        )
        .watch()
        .map(
          (rows) => rows
              .map(
                (row) => AttendanceOverview(
                  traineeId: row.read<String>('trainee_id'),
                  traineeName: row.read<String>('trainee_name'),
                  status: row.read<String>('status'),
                ),
              )
              .toList(),
        );
  }

  Future<int> assignedQuantity({
    required String workoutId,
    required String equipmentId,
  }) async {
    final rows = await (_database.select(_database.assignments)..where(
          (row) =>
              row.workoutId.equals(workoutId) &
              row.equipmentId.equals(equipmentId) &
              row.deletedAt.isNull(),
        ))
        .get();
    return rows.fold<int>(0, (sum, row) => sum + row.quantity);
  }

  Future<String> addTrainee({
    required String workspaceId,
    required String name,
  }) async {
    final normalizedName = name.trim();
    if (normalizedName.isEmpty) throw ArgumentError('name cannot be empty');
    final id = _idFactory();
    final now = _clock().toUtc();
    final payload = <String, Object?>{
      'id': id,
      'workspace_id': workspaceId,
      'name': normalizedName,
      'created_at': now.toIso8601String(),
      'updated_at': now.toIso8601String(),
      'version': 0,
      'deleted_at': null,
    };
    await _database.transaction(() async {
      await _database.into(_database.trainees).insert(
        TraineesCompanion.insert(
          id: id,
          workspaceId: workspaceId,
          name: normalizedName,
          createdAt: now,
          updatedAt: now,
        ),
      );
      await _enqueue(
        workspaceId: workspaceId,
        entityTable: 'trainees',
        entityId: id,
        operation: 'upsert',
        payload: payload,
        baseVersion: 0,
        createdAt: now,
      );
    });
    return id;
  }

  Future<String> addEquipment({
    required String workspaceId,
    required String name,
    required int totalQuantity,
  }) async {
    final normalizedName = name.trim();
    if (normalizedName.isEmpty) throw ArgumentError('name cannot be empty');
    if (totalQuantity <= 0) {
      throw ArgumentError.value(totalQuantity, 'totalQuantity');
    }
    final id = _idFactory();
    final now = _clock().toUtc();
    final payload = <String, Object?>{
      'id': id,
      'workspace_id': workspaceId,
      'name': normalizedName,
      'total_quantity': totalQuantity,
      'created_at': now.toIso8601String(),
      'updated_at': now.toIso8601String(),
      'version': 0,
      'deleted_at': null,
    };
    await _database.transaction(() async {
      await _database.into(_database.equipmentItems).insert(
        EquipmentItemsCompanion.insert(
          id: id,
          workspaceId: workspaceId,
          name: normalizedName,
          totalQuantity: totalQuantity,
          createdAt: now,
          updatedAt: now,
        ),
      );
      await _enqueue(
        workspaceId: workspaceId,
        entityTable: 'equipment_items',
        entityId: id,
        operation: 'upsert',
        payload: payload,
        baseVersion: 0,
        createdAt: now,
      );
    });
    return id;
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

  Future<void> setReturnedQuantity({
    required String assignmentId,
    required int returnedQuantity,
  }) async {
    final assignment = await (_database.select(_database.assignments)..where(
          (row) => row.id.equals(assignmentId) & row.deletedAt.isNull(),
        ))
        .getSingle();
    if (returnedQuantity < 0 || returnedQuantity > assignment.quantity) {
      throw ArgumentError.value(returnedQuantity, 'returnedQuantity');
    }
    final existing = await (_database.select(_database.equipmentReturns)
          ..where(
            (row) => row.assignmentId.equals(assignmentId) & row.deletedAt.isNull(),
          ))
        .getSingleOrNull();
    final id = existing?.id ?? _idFactory();
    final now = _clock().toUtc();
    final createdAt = existing?.createdAt ?? now;
    final baseVersion = existing?.version ?? 0;
    final nextVersion = existing == null ? 0 : baseVersion + 1;
    final payload = <String, Object?>{
      'id': id,
      'workspace_id': assignment.workspaceId,
      'assignment_id': assignmentId,
      'returned_quantity': returnedQuantity,
      'created_at': createdAt.toIso8601String(),
      'updated_at': now.toIso8601String(),
      'version': nextVersion,
      'deleted_at': null,
    };
    await _database.transaction(() async {
      await _database.into(_database.equipmentReturns).insertOnConflictUpdate(
        EquipmentReturnsCompanion.insert(
          id: id,
          workspaceId: assignment.workspaceId,
          assignmentId: assignmentId,
          returnedQuantity: returnedQuantity,
          createdAt: createdAt,
          updatedAt: now,
          version: Value(nextVersion),
        ),
      );
      await _enqueue(
        workspaceId: assignment.workspaceId,
        entityTable: 'equipment_returns',
        entityId: id,
        operation: 'upsert',
        payload: payload,
        baseVersion: baseVersion,
        createdAt: now,
      );
    });
  }

  Future<void> setAttendance({
    required String workspaceId,
    required String workoutId,
    required String traineeId,
    required String status,
  }) async {
    if (!{'unknown', 'attending', 'absent'}.contains(status)) {
      throw ArgumentError.value(status, 'status');
    }
    final existing = await (_database.select(_database.attendanceRecords)
          ..where(
            (row) =>
                row.workoutId.equals(workoutId) &
                row.traineeId.equals(traineeId) &
                row.deletedAt.isNull(),
          ))
        .getSingleOrNull();
    final id = existing?.id ?? _idFactory();
    final now = _clock().toUtc();
    final createdAt = existing?.createdAt ?? now;
    final baseVersion = existing?.version ?? 0;
    final nextVersion = existing == null ? 0 : baseVersion + 1;
    final payload = <String, Object?>{
      'id': id,
      'workspace_id': workspaceId,
      'workout_id': workoutId,
      'trainee_id': traineeId,
      'status': status,
      'created_at': createdAt.toIso8601String(),
      'updated_at': now.toIso8601String(),
      'version': nextVersion,
      'deleted_at': null,
    };
    await _database.transaction(() async {
      await _database.into(_database.attendanceRecords).insertOnConflictUpdate(
        AttendanceRecordsCompanion.insert(
          id: id,
          workspaceId: workspaceId,
          workoutId: workoutId,
          traineeId: traineeId,
          status: Value(status),
          createdAt: createdAt,
          updatedAt: now,
          version: Value(nextVersion),
        ),
      );
      await _enqueue(
        workspaceId: workspaceId,
        entityTable: 'attendance_records',
        entityId: id,
        operation: 'upsert',
        payload: payload,
        baseVersion: baseVersion,
        createdAt: now,
      );
    });
  }

  Future<void> replaceWorkoutAssignments({
    required String workspaceId,
    required String workoutId,
    required List<AssignmentReplacement> replacements,
  }) async {
    final now = _clock().toUtc();
    await _database.transaction(() async {
      final existing = await (_database.select(_database.assignments)..where(
            (row) =>
                row.workoutId.equals(workoutId) & row.deletedAt.isNull(),
          ))
          .get();
      for (final assignment in existing) {
        final returns = await (_database.select(_database.equipmentReturns)
              ..where(
                (row) =>
                    row.assignmentId.equals(assignment.id) &
                    row.deletedAt.isNull(),
              ))
            .get();
        for (final equipmentReturn in returns) {
          await (_database.update(_database.equipmentReturns)..where(
                (row) => row.id.equals(equipmentReturn.id),
              ))
              .write(
                EquipmentReturnsCompanion(
                  deletedAt: Value(now),
                  updatedAt: Value(now),
                  version: Value(equipmentReturn.version + 1),
                ),
              );
          await _enqueue(
            workspaceId: workspaceId,
            entityTable: 'equipment_returns',
            entityId: equipmentReturn.id,
            operation: 'delete',
            payload: {
              'id': equipmentReturn.id,
              'workspace_id': workspaceId,
              'deleted_at': now.toIso8601String(),
            },
            baseVersion: equipmentReturn.version,
            createdAt: now,
          );
        }
        await (_database.update(_database.assignments)..where(
              (row) => row.id.equals(assignment.id),
            ))
            .write(
              AssignmentsCompanion(
                deletedAt: Value(now),
                updatedAt: Value(now),
                version: Value(assignment.version + 1),
              ),
            );
        await _enqueue(
          workspaceId: workspaceId,
          entityTable: 'assignments',
          entityId: assignment.id,
          operation: 'delete',
          payload: {
            'id': assignment.id,
            'workspace_id': workspaceId,
            'deleted_at': now.toIso8601String(),
          },
          baseVersion: assignment.version,
          createdAt: now,
        );
      }

      for (final replacement in replacements) {
        final assignmentId = _idFactory();
        final assignmentPayload = <String, Object?>{
          'id': assignmentId,
          'workspace_id': workspaceId,
          'workout_id': workoutId,
          'trainee_id': replacement.traineeId,
          'equipment_id': replacement.equipmentId,
          'quantity': replacement.quantity,
          'created_at': now.toIso8601String(),
          'updated_at': now.toIso8601String(),
          'version': 0,
          'deleted_at': null,
        };
        await _database.into(_database.assignments).insert(
          AssignmentsCompanion.insert(
            id: assignmentId,
            workspaceId: workspaceId,
            workoutId: workoutId,
            traineeId: replacement.traineeId,
            equipmentId: replacement.equipmentId,
            quantity: replacement.quantity,
            createdAt: now,
            updatedAt: now,
          ),
        );
        await _enqueue(
          workspaceId: workspaceId,
          entityTable: 'assignments',
          entityId: assignmentId,
          operation: 'upsert',
          payload: assignmentPayload,
          baseVersion: 0,
          createdAt: now,
        );
        if (replacement.returnedQuantity > 0) {
          final returnId = _idFactory();
          final returnPayload = <String, Object?>{
            'id': returnId,
            'workspace_id': workspaceId,
            'assignment_id': assignmentId,
            'returned_quantity': replacement.returnedQuantity,
            'created_at': now.toIso8601String(),
            'updated_at': now.toIso8601String(),
            'version': 0,
            'deleted_at': null,
          };
          await _database.into(_database.equipmentReturns).insert(
            EquipmentReturnsCompanion.insert(
              id: returnId,
              workspaceId: workspaceId,
              assignmentId: assignmentId,
              returnedQuantity: replacement.returnedQuantity,
              createdAt: now,
              updatedAt: now,
            ),
          );
          await _enqueue(
            workspaceId: workspaceId,
            entityTable: 'equipment_returns',
            entityId: returnId,
            operation: 'upsert',
            payload: returnPayload,
            baseVersion: 0,
            createdAt: now,
          );
        }
      }
    });
  }

  Future<void> deleteWorkout(String workoutId) async {
    final workout = await (_database.select(
      _database.workouts,
    )..where((row) => row.id.equals(workoutId))).getSingle();
    final now = _clock().toUtc();

    await _database.transaction(() async {
      final attendance =
          await (_database.select(_database.attendanceRecords)..where(
                (row) =>
                    row.workoutId.equals(workoutId) & row.deletedAt.isNull(),
              ))
              .get();
      for (final record in attendance) {
        final nextVersion = record.version + 1;
        await (_database.update(_database.attendanceRecords)..where(
              (row) => row.id.equals(record.id),
            ))
            .write(
              AttendanceRecordsCompanion(
                deletedAt: Value(now),
                updatedAt: Value(now),
                version: Value(nextVersion),
              ),
            );
        await _enqueue(
          workspaceId: record.workspaceId,
          entityTable: 'attendance_records',
          entityId: record.id,
          operation: 'delete',
          payload: {
            'id': record.id,
            'workspace_id': record.workspaceId,
            'deleted_at': now.toIso8601String(),
          },
          baseVersion: record.version,
          createdAt: now,
        );
      }
      final childAssignments =
          await (_database.select(_database.assignments)..where(
                (row) =>
                    row.workoutId.equals(workoutId) & row.deletedAt.isNull(),
              ))
              .get();

      for (final assignment in childAssignments) {
        final childReturns =
            await (_database.select(_database.equipmentReturns)..where(
                  (row) =>
                      row.assignmentId.equals(assignment.id) &
                      row.deletedAt.isNull(),
                ))
                .get();
        for (final equipmentReturn in childReturns) {
          final returnVersion = equipmentReturn.version + 1;
          await (_database.update(_database.equipmentReturns)..where(
                (row) => row.id.equals(equipmentReturn.id),
              ))
              .write(
                EquipmentReturnsCompanion(
                  deletedAt: Value(now),
                  updatedAt: Value(now),
                  version: Value(returnVersion),
                ),
              );
          await _enqueue(
            workspaceId: equipmentReturn.workspaceId,
            entityTable: 'equipment_returns',
            entityId: equipmentReturn.id,
            operation: 'delete',
            payload: {
              'id': equipmentReturn.id,
              'workspace_id': equipmentReturn.workspaceId,
              'deleted_at': now.toIso8601String(),
            },
            baseVersion: equipmentReturn.version,
            createdAt: now,
          );
        }
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

class AssignmentOverview {
  const AssignmentOverview({
    required this.id,
    required this.equipmentId,
    required this.traineeId,
    required this.traineeName,
    required this.equipmentName,
    required this.quantity,
    required this.returnedQuantity,
  });

  final String id;
  final String equipmentId;
  final String traineeId;
  final String traineeName;
  final String equipmentName;
  final int quantity;
  final int returnedQuantity;
}

class AttendanceOverview {
  const AttendanceOverview({
    required this.traineeId,
    required this.traineeName,
    required this.status,
  });

  final String traineeId;
  final String traineeName;
  final String status;
}

class AssignmentReplacement {
  const AssignmentReplacement({
    required this.traineeId,
    required this.equipmentId,
    required this.quantity,
    required this.returnedQuantity,
  });

  final String traineeId;
  final String equipmentId;
  final int quantity;
  final int returnedQuantity;
}
