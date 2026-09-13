import 'package:supabase_flutter/supabase_flutter.dart';

import 'sync_gateway.dart';
import 'sync_models.dart';

/// Keeps Supabase details outside the local repository.
///
/// The two RPCs will be added only after the normalized backend migration and
/// RLS policies are reviewed. Until then this class is not wired into startup,
/// so the existing production data remains untouched.
class SupabaseSyncGateway implements SyncGateway {
  SupabaseSyncGateway(this._client);

  final SupabaseClient _client;

  @override
  Future<PushResult> push(List<SyncMutation> mutations) async {
    final response = await _client.rpc(
      'push_offline_changes',
      params: {'p_mutations': mutations.map((item) => item.toJson()).toList()},
    ) as Map<String, dynamic>;

    final acknowledged =
        (response['acknowledged'] as List<dynamic>? ?? const [])
            .cast<String>()
            .toSet();
    final conflicts = (response['conflicts'] as List<dynamic>? ?? const [])
        .cast<Map<String, dynamic>>()
        .map(_remoteChangeFromJson)
        .toList();
    return PushResult(acknowledgedIds: acknowledged, conflicts: conflicts);
  }

  @override
  Future<PullResult> pull({
    required String workspaceId,
    required int afterSequence,
  }) async {
    final response = await _client.rpc(
      'pull_offline_changes',
      params: {
        'p_workspace_id': workspaceId,
        'p_after_sequence': afterSequence,
      },
    ) as Map<String, dynamic>;

    return PullResult(
      changes: (response['changes'] as List<dynamic>? ?? const [])
          .cast<Map<String, dynamic>>()
          .map(_remoteChangeFromJson)
          .toList(),
      nextCursor: response['next_cursor'] as int? ?? afterSequence,
    );
  }
}

RemoteChange _remoteChangeFromJson(Map<String, dynamic> json) {
  return RemoteChange(
    sequence: json['sequence'] as int,
    workspaceId: json['workspace_id'] as String,
    entityTable: json['entity_table'] as String,
    entityId: json['entity_id'] as String,
    version: json['version'] as int,
    payload: (json['payload'] as Map).cast<String, Object?>(),
  );
}
