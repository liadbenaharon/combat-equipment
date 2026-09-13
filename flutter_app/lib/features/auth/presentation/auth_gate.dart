import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/config/app_config.dart';
import '../../../core/database/app_database.dart';
import '../../../core/session/session_bootstrapper.dart';
import '../../../core/sync/database_remote_change_applier.dart';
import '../../../core/sync/supabase_sync_gateway.dart';
import '../../../core/sync/sync_engine.dart';
import '../../workouts/data/offline_repository.dart';
import '../../workouts/presentation/workouts_page.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({required this.database, required this.client, super.key});

  final AppDatabase database;
  final SupabaseClient? client;

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  StreamSubscription<AuthState>? _authSubscription;
  late Future<LocalSession?> _session;

  @override
  void initState() {
    super.initState();
    _session = _resolveSession();
    _authSubscription = widget.client?.auth.onAuthStateChange.listen((event) {
      if (!mounted) return;
      setState(() => _session = _resolveSession());
    });
  }

  Future<LocalSession?> _resolveSession() async {
    final bootstrapper = SessionBootstrapper(widget.database, widget.client);
    final user = widget.client?.auth.currentUser;
    if (user != null) return bootstrapper.fromRemoteUser(user);
    return bootstrapper.latestLocalSession();
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    super.dispose();
  }

  Future<void> _signIn() async {
    await widget.client?.auth.signInWithOAuth(
      OAuthProvider.google,
      redirectTo: AppConfig.authCallback,
    );
  }

  Future<void> _signOut() async {
    await widget.client?.auth.signOut();
    if (mounted) setState(() => _session = Future.value(null));
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<LocalSession?>(
      future: _session,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        final session = snapshot.data;
        if (session == null) {
          return _SignInPage(
            cloudConfigured: widget.client != null,
            onSignIn: _signIn,
          );
        }

        final repository = OfflineRepository(widget.database);
        final syncEngine = widget.client == null
            ? null
            : SyncEngine(
                widget.database,
                SupabaseSyncGateway(widget.client!),
                DatabaseRemoteChangeApplier(widget.database),
              );
        return WorkoutsPage(
          session: session,
          database: widget.database,
          repository: repository,
          syncEngine: syncEngine,
          onSignOut: _signOut,
        );
      },
    );
  }
}

class _SignInPage extends StatelessWidget {
  const _SignInPage({
    required this.cloudConfigured,
    required this.onSignIn,
  });

  final bool cloudConfigured;
  final Future<void> Function() onSignIn;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.inventory_2_rounded, size: 80),
              const SizedBox(height: 24),
              Text(
                'Combat Equipment',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 12),
              const Text(
                'הנתונים נשמרים קודם בטלפון ומסתנכרנים כשיש אינטרנט.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 28),
              FilledButton.icon(
                onPressed: cloudConfigured ? onSignIn : null,
                icon: const Icon(Icons.login_rounded),
                label: const Text('כניסה עם Google'),
              ),
              if (!cloudConfigured) ...[
                const SizedBox(height: 12),
                const Text(
                  'גרסת הפיתוח נבנתה ללא הגדרות ענן.',
                  textAlign: TextAlign.center,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
