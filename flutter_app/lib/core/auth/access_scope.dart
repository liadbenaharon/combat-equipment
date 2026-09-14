class AccessScope {
  const AccessScope({
    required this.userId,
    required this.role,
    required this.workspaceIds,
  });

  final String userId;
  final String role;
  final Set<String> workspaceIds;

  bool get isAdmin => role == 'admin';

  bool canOpenWorkspace(String workspaceId) {
    return isAdmin || workspaceIds.contains(workspaceId);
  }

  void requireWorkspace(String workspaceId) {
    if (!canOpenWorkspace(workspaceId)) {
      throw WorkspaceAccessDenied(workspaceId);
    }
  }
}

class WorkspaceAccessDenied implements Exception {
  const WorkspaceAccessDenied(this.workspaceId);

  final String workspaceId;

  @override
  String toString() => 'Access denied to workspace $workspaceId';
}
