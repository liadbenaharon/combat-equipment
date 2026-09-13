import 'sync_models.dart';

abstract interface class SyncGateway {
  Future<PushResult> push(List<SyncMutation> mutations);

  Future<PullResult> pull({
    required String workspaceId,
    required int afterSequence,
  });
}
