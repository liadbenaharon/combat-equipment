import 'package:flutter/material.dart';

import '../../../core/database/app_database.dart';
import '../../../core/session/session_bootstrapper.dart';
import '../../../core/sync/sync_engine.dart';
import '../data/offline_repository.dart';
import 'workout_detail_page.dart';

class WorkoutsPage extends StatefulWidget {
  const WorkoutsPage({
    required this.session,
    required this.database,
    required this.repository,
    required this.syncEngine,
    required this.onSignOut,
    super.key,
  });

  final LocalSession session;
  final AppDatabase database;
  final OfflineRepository repository;
  final SyncEngine? syncEngine;
  final Future<void> Function() onSignOut;

  @override
  State<WorkoutsPage> createState() => _WorkoutsPageState();
}

class _WorkoutsPageState extends State<WorkoutsPage> {
  bool _syncing = false;
  String? _notice;

  @override
  void initState() {
    super.initState();
    if (widget.syncEngine != null) _sync(silent: true);
  }

  Future<void> _sync({bool silent = false}) async {
    if (_syncing || widget.syncEngine == null) return;
    setState(() => _syncing = true);
    try {
      await widget.syncEngine!.syncWorkspace(widget.session.workspaceId);
      if (!silent && mounted) setState(() => _notice = 'הסנכרון הושלם');
    } catch (_) {
      if (!silent && mounted) {
        setState(() => _notice = 'אין חיבור כרגע — השינויים נשמרו בטלפון');
      }
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  Future<void> _createWorkout() async {
    final controller = TextEditingController();
    final title = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('אימון חדש'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'שם האימון'),
          onSubmitted: (value) => Navigator.pop(context, value.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('ביטול'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('שמירה'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (title == null || title.isEmpty) return;
    await widget.repository.createWorkout(
      workspaceId: widget.session.workspaceId,
      title: title,
      startsAt: DateTime.now(),
    );
    await _sync(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Combat Equipment'),
        actions: [
          IconButton(
            tooltip: 'סנכרון',
            onPressed: _syncing ? null : _sync,
            icon: _syncing
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.sync_rounded),
          ),
          PopupMenuButton<String>(
            onSelected: (value) {
              if (value == 'signout') widget.onSignOut();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'signout', child: Text('יציאה מהחשבון')),
            ],
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createWorkout,
        icon: const Icon(Icons.add),
        label: const Text('אימון חדש'),
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
              child: Text(
                '${widget.session.role == 'admin' ? 'אדמין' : 'מאמן'} · ${widget.session.displayName}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            if (_notice != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Text(_notice!),
              ),
            Expanded(
              child: StreamBuilder<List<Workout>>(
                stream: widget.repository.watchWorkouts(
                  widget.session.workspaceId,
                ),
                builder: (context, snapshot) {
                  final workouts = snapshot.data ?? const [];
                  if (workouts.isEmpty) {
                    return const Center(
                      child: Padding(
                        padding: EdgeInsets.all(32),
                        child: Text(
                          'עדיין אין אימונים. אפשר ליצור אימון גם בלי אינטרנט.',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    );
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
                    itemCount: workouts.length,
                    separatorBuilder: (context, index) =>
                        const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final workout = workouts[index];
                      return Card(
                        child: ListTile(
                          leading: const Icon(Icons.fitness_center_rounded),
                          title: Text(workout.title),
                          subtitle: Text(
                            MaterialLocalizations.of(
                              context,
                            ).formatMediumDate(workout.startsAt.toLocal()),
                          ),
                          trailing: const Icon(Icons.chevron_left),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => WorkoutDetailPage(
                                workout: workout,
                                workspaceId: widget.session.workspaceId,
                                repository: widget.repository,
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
