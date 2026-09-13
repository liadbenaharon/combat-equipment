import 'package:drift/drift.dart';

import '../database/app_database.dart';
import 'sync_engine.dart';
import 'sync_models.dart';

class DatabaseRemoteChangeApplier implements RemoteChangeApplier {
  DatabaseRemoteChangeApplier(this._database);

  final AppDatabase _database;

  @override
  Future<void> apply(RemoteChange change) async {
    final payload = change.payload;
    final deletedAt = _optionalDate(payload['deleted_at']);

    switch (change.entityTable) {
      case 'workspaces':
        await _database
            .into(_database.workspaces)
            .insertOnConflictUpdate(
              WorkspacesCompanion.insert(
                id: change.entityId,
                ownerUserId: payload['owner_user_id']! as String,
                name: payload['name']! as String,
                createdAt: _date(payload['created_at']),
                updatedAt: _date(payload['updated_at']),
                version: Value(change.version),
                deletedAt: Value(deletedAt),
              ),
            );
        return;
      case 'workouts':
        await _database
            .into(_database.workouts)
            .insertOnConflictUpdate(
              WorkoutsCompanion.insert(
                id: change.entityId,
                workspaceId: change.workspaceId,
                title: payload['title']! as String,
                startsAt: _date(payload['starts_at']),
                status: Value(payload['status'] as String? ?? 'draft'),
                createdAt: _date(payload['created_at']),
                updatedAt: _date(payload['updated_at']),
                version: Value(change.version),
                deletedAt: Value(deletedAt),
              ),
            );
        return;
      case 'trainees':
        await _database
            .into(_database.trainees)
            .insertOnConflictUpdate(
              TraineesCompanion.insert(
                id: change.entityId,
                workspaceId: change.workspaceId,
                name: payload['name']! as String,
                createdAt: _date(payload['created_at']),
                updatedAt: _date(payload['updated_at']),
                version: Value(change.version),
                deletedAt: Value(deletedAt),
              ),
            );
        return;
      case 'equipment_items':
        await _database
            .into(_database.equipmentItems)
            .insertOnConflictUpdate(
              EquipmentItemsCompanion.insert(
                id: change.entityId,
                workspaceId: change.workspaceId,
                name: payload['name']! as String,
                totalQuantity: payload['total_quantity']! as int,
                createdAt: _date(payload['created_at']),
                updatedAt: _date(payload['updated_at']),
                version: Value(change.version),
                deletedAt: Value(deletedAt),
              ),
            );
        return;
      case 'assignments':
        await _database
            .into(_database.assignments)
            .insertOnConflictUpdate(
              AssignmentsCompanion.insert(
                id: change.entityId,
                workspaceId: change.workspaceId,
                workoutId: payload['workout_id']! as String,
                traineeId: payload['trainee_id']! as String,
                equipmentId: payload['equipment_id']! as String,
                quantity: payload['quantity']! as int,
                createdAt: _date(payload['created_at']),
                updatedAt: _date(payload['updated_at']),
                version: Value(change.version),
                deletedAt: Value(deletedAt),
              ),
            );
        return;
      case 'equipment_returns':
        await _database
            .into(_database.equipmentReturns)
            .insertOnConflictUpdate(
              EquipmentReturnsCompanion.insert(
                id: change.entityId,
                workspaceId: change.workspaceId,
                assignmentId: payload['assignment_id']! as String,
                returnedQuantity: payload['returned_quantity']! as int,
                createdAt: _date(payload['created_at']),
                updatedAt: _date(payload['updated_at']),
                version: Value(change.version),
                deletedAt: Value(deletedAt),
              ),
            );
        return;
      default:
        throw UnsupportedError('Unknown sync table: ${change.entityTable}');
    }
  }
}

DateTime _date(Object? value) => DateTime.parse(value! as String).toUtc();

DateTime? _optionalDate(Object? value) {
  return value == null ? null : _date(value);
}
