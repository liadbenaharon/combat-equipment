import 'package:drift/drift.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../database/app_database.dart';

class LocalSession {
  const LocalSession({
    required this.userId,
    required this.workspaceId,
    required this.displayName,
    required this.role,
  });

  final String userId;
  final String workspaceId;
  final String displayName;
  final String role;
}

class SessionBootstrapper {
  SessionBootstrapper(this._database, this._client);

  final AppDatabase _database;
  final SupabaseClient? _client;

  Future<LocalSession> fromRemoteUser(User user) async {
    Map<String, dynamic>? profile;
    try {
      profile = await _client
          ?.from('profiles')
          .select('id,email,display_name,role')
          .eq('id', user.id)
          .single();
    } catch (_) {
      // An existing cached identity is enough to keep the local app usable.
    }

    final now = DateTime.now().toUtc();
    final displayName =
        (profile?['display_name'] as String?)?.trim().isNotEmpty == true
        ? (profile!['display_name'] as String).trim()
        : (user.userMetadata?['full_name'] as String?)?.trim().isNotEmpty == true
        ? (user.userMetadata!['full_name'] as String).trim()
        : user.email ?? 'מאמן';
    final role = profile?['role'] as String? ?? 'coach';

    await _database.transaction(() async {
      await _database
          .into(_database.userProfiles)
          .insertOnConflictUpdate(
            UserProfilesCompanion.insert(
              id: user.id,
              email: Value(user.email),
              displayName: Value(displayName),
              role: Value(role),
              lastAuthenticatedAt: now,
            ),
          );
      await _database
          .into(_database.workspaces)
          .insertOnConflictUpdate(
            WorkspacesCompanion.insert(
              id: user.id,
              ownerUserId: user.id,
              name: displayName,
              createdAt: now,
              updatedAt: now,
            ),
      );
    });

    if (role == 'admin' && _client != null) {
      try {
        final rows = await _client
            .from('workspaces')
            .select(
              'id,owner_user_id,name,created_at,updated_at,version,deleted_at',
            );
        await _database.transaction(() async {
          for (final value in rows) {
            final row = value;
            await _database.into(_database.workspaces).insertOnConflictUpdate(
              WorkspacesCompanion.insert(
                id: row['id'] as String,
                ownerUserId: row['owner_user_id'] as String,
                name: row['name'] as String,
                createdAt: DateTime.parse(row['created_at'] as String).toUtc(),
                updatedAt: DateTime.parse(row['updated_at'] as String).toUtc(),
                version: Value((row['version'] as num?)?.toInt() ?? 0),
                deletedAt: Value(
                  row['deleted_at'] == null
                      ? null
                      : DateTime.parse(row['deleted_at'] as String).toUtc(),
                ),
              ),
            );
          }
        });
      } catch (_) {
        // Previously cached coach workspaces remain available while offline.
      }
    }

    return LocalSession(
      userId: user.id,
      workspaceId: user.id,
      displayName: displayName,
      role: role,
    );
  }

  Future<LocalSession?> latestLocalSession() async {
    final query = _database.select(_database.userProfiles)
      ..orderBy([(row) => OrderingTerm.desc(row.lastAuthenticatedAt)])
      ..limit(1);
    final profile = await query.getSingleOrNull();
    if (profile == null) return null;

    final workspace =
        await (_database.select(_database.workspaces)..where(
              (row) =>
                  row.ownerUserId.equals(profile.id) & row.deletedAt.isNull(),
            ))
            .getSingleOrNull();
    if (workspace == null) return null;

    return LocalSession(
      userId: profile.id,
      workspaceId: workspace.id,
      displayName: profile.displayName ?? profile.email ?? 'מאמן',
      role: profile.role,
    );
  }
}
