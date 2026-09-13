import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uuid/uuid.dart';

import '../database/app_database.dart';
import 'sync_gateway.dart';
import 'sync_models.dart';

abstract interface class RemoteChangeApplier {
  Future<void> apply(RemoteChange change);
}

class SyncEngine {
  SyncEngine(
    this._database,
    this._gateway,
    this._applier, {
    DateTime Function()? clock,
    String Function()? idFactory,
  }) : _clock = clock ?? DateTime.now,
       _idFactory = idFactory ?? const Uuid().v7;

  final AppDatabase _database;
  final SyncGateway _gateway;
  final RemoteChangeApplier _applier;
  final DateTime Function() _clock;
  final String Function() _idFactory;

  Future<void> syncWorkspace(String workspaceId) async {
    final now = _clock().toUtc();
    final pending =
        await (_database.select(_database.syncQueueItems)
              ..where(
                (row) =>
                    row.workspaceId.equals(workspaceId) &
                    (row.nextAttemptAt.isNull() |
                        row.nextAttemptAt.isSmallerOrEqualValue(now)),
              )
              ..orderBy([(row) => OrderingTerm.asc(row.createdAt)])
              ..limit(100))
            .get();

    if (pending.isNotEmpty) {
      try {
        final result = await _gateway.push(pending.map(_toMutation).toList());
        await _database.transaction(() async {
          if (result.acknowledgedIds.isNotEmpty) {
            await (_database.delete(
              _database.syncQueueItems,
            )..where((row) => row.id.isIn(result.acknowledgedIds))).go();
          }
          for (final conflict in result.conflicts) {
            await _recordConflict(conflict);
          }
        });
      } catch (error) {
        await _scheduleRetry(pending, error, now);
        return;
      }
    }

    final cursor = await (_database.select(
      _database.syncCursors,
    )..where((row) => row.workspaceId.equals(workspaceId))).getSingleOrNull();
    final pulled = await _gateway.pull(
      workspaceId: workspaceId,
      afterSequence: cursor?.lastServerSequence ?? 0,
    );

    await _database.transaction(() async {
      for (final change in pulled.changes) {
        final hasLocalMutation =
            await (_database.select(_database.syncQueueItems)..where(
                  (row) =>
                      row.entityTable.equals(change.entityTable) &
                      row.entityId.equals(change.entityId),
                ))
                .getSingleOrNull();
        if (hasLocalMutation != null) {
          await _recordConflict(
            change,
            localPayload: hasLocalMutation.payloadJson,
          );
        } else {
          await _applier.apply(change);
        }
      }

      await _database
          .into(_database.syncCursors)
          .insertOnConflictUpdate(
            SyncCursorsCompanion.insert(
              workspaceId: workspaceId,
              lastServerSequence: Value(pulled.nextCursor),
              lastSyncedAt: Value(now),
            ),
          );
    });
  }

  SyncMutation _toMutation(SyncQueueItem row) {
    return SyncMutation(
      id: row.id,
      workspaceId: row.workspaceId,
      entityTable: row.entityTable,
      entityId: row.entityId,
      operation: row.operation == 'delete'
          ? SyncOperation.delete
          : SyncOperation.upsert,
      payload: (jsonDecode(row.payloadJson) as Map).cast<String, Object?>(),
      baseVersion: row.baseVersion,
    );
  }

  Future<void> _recordConflict(RemoteChange remote, {String? localPayload}) {
    return _database
        .into(_database.syncConflicts)
        .insert(
          SyncConflictsCompanion.insert(
            id: _idFactory(),
            workspaceId: remote.workspaceId,
            entityTable: remote.entityTable,
            entityId: remote.entityId,
            localPayloadJson: localPayload ?? '{}',
            remotePayloadJson: jsonEncode(remote.payload),
            createdAt: _clock().toUtc(),
          ),
        );
  }

  Future<void> _scheduleRetry(
    List<SyncQueueItem> pending,
    Object error,
    DateTime now,
  ) async {
    await _database.transaction(() async {
      for (final row in pending) {
        final attempts = row.attempts + 1;
        final exponent = attempts.clamp(1, 9);
        final seconds = (1 << exponent) * 2;
        await (_database.update(
          _database.syncQueueItems,
        )..where((item) => item.id.equals(row.id))).write(
          SyncQueueItemsCompanion(
            attempts: Value(attempts),
            nextAttemptAt: Value(now.add(Duration(seconds: seconds))),
            lastError: Value(error.toString()),
          ),
        );
      }
    });
  }
}
