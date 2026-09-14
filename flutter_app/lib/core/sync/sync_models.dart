enum SyncOperation { upsert, delete }

class SyncMutation {
  const SyncMutation({
    required this.id,
    required this.workspaceId,
    required this.entityTable,
    required this.entityId,
    required this.operation,
    required this.payload,
    required this.baseVersion,
  });

  final String id;
  final String workspaceId;
  final String entityTable;
  final String entityId;
  final SyncOperation operation;
  final Map<String, Object?> payload;
  final int baseVersion;

  Map<String, Object?> toJson() => {
    'mutation_id': id,
    'workspace_id': workspaceId,
    'entity_table': entityTable,
    'entity_id': entityId,
    'operation': operation.name,
    'payload': payload,
    'base_version': baseVersion,
  };
}

class RemoteChange {
  const RemoteChange({
    required this.sequence,
    required this.workspaceId,
    required this.entityTable,
    required this.entityId,
    required this.version,
    required this.payload,
  });

  final int sequence;
  final String workspaceId;
  final String entityTable;
  final String entityId;
  final int version;
  final Map<String, Object?> payload;
}

class PushResult {
  const PushResult({required this.acknowledgedIds, required this.conflicts});

  final Set<String> acknowledgedIds;
  final List<RemoteChange> conflicts;
}

class PullResult {
  const PullResult({required this.changes, required this.nextCursor});

  final List<RemoteChange> changes;
  final int nextCursor;
}
