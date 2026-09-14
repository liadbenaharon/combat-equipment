import 'package:flutter/material.dart';

import '../../../core/database/app_database.dart';
import '../data/offline_repository.dart';

class WorkoutDetailPage extends StatelessWidget {
  const WorkoutDetailPage({
    required this.workout,
    required this.workspaceId,
    required this.repository,
    super.key,
  });

  final Workout workout;
  final String workspaceId;
  final OfflineRepository repository;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Text(workout.title),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'ציוד', icon: Icon(Icons.inventory_2_outlined)),
              Tab(text: 'שיוכים', icon: Icon(Icons.people_outline)),
              Tab(text: 'החזרות', icon: Icon(Icons.assignment_return_outlined)),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _EquipmentTab(
              workspaceId: workspaceId,
              workoutId: workout.id,
              repository: repository,
            ),
            _AssignmentsTab(
              workspaceId: workspaceId,
              workoutId: workout.id,
              repository: repository,
            ),
            _ReturnsTab(
              workoutId: workout.id,
              repository: repository,
            ),
          ],
        ),
      ),
    );
  }
}

class _EquipmentTab extends StatelessWidget {
  const _EquipmentTab({
    required this.workspaceId,
    required this.workoutId,
    required this.repository,
  });

  final String workspaceId;
  final String workoutId;
  final OfflineRepository repository;

  Future<void> _add(BuildContext context) async {
    final name = TextEditingController();
    final quantity = TextEditingController(text: '1');
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('הוספת ציוד'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: name,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'שם הציוד'),
            ),
            TextField(
              controller: quantity,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'כמות'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('ביטול'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('שמירה'),
          ),
        ],
      ),
    );
    if (result == true) {
      final count = int.tryParse(quantity.text) ?? 0;
      if (name.text.trim().isNotEmpty && count > 0) {
        await repository.addEquipment(
          workspaceId: workspaceId,
          name: name.text,
          totalQuantity: count,
        );
      }
    }
    name.dispose();
    quantity.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<EquipmentItem>>(
      stream: repository.watchEquipment(workspaceId),
      builder: (context, snapshot) {
        final items = snapshot.data ?? const [];
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            FilledButton.icon(
              onPressed: () => _add(context),
              icon: const Icon(Icons.add),
              label: const Text('הוספת ציוד'),
            ),
            const SizedBox(height: 12),
            if (items.isEmpty)
              const _EmptyState(text: 'עדיין אין ציוד')
            else
              ...items.map(
                (item) => FutureBuilder<int>(
                  future: repository.assignedQuantity(
                    workoutId: workoutId,
                    equipmentId: item.id,
                  ),
                  builder: (context, assigned) => Card(
                    child: ListTile(
                      leading: const Icon(Icons.backpack_outlined),
                      title: Text(item.name),
                      subtitle: Text(
                        'שויכו ${assigned.data ?? 0} מתוך ${item.totalQuantity}',
                      ),
                      trailing: Text(
                        '${item.totalQuantity}',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _AssignmentsTab extends StatelessWidget {
  const _AssignmentsTab({
    required this.workspaceId,
    required this.workoutId,
    required this.repository,
  });

  final String workspaceId;
  final String workoutId;
  final OfflineRepository repository;

  Future<void> _addTrainee(BuildContext context) async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('מתאמן חדש'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'שם מלא'),
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
    if (name != null && name.isNotEmpty) {
      await repository.addTrainee(workspaceId: workspaceId, name: name);
    }
  }

  Future<void> _assign(
    BuildContext context,
    List<Trainee> trainees,
    List<EquipmentItem> equipment,
  ) async {
    if (trainees.isEmpty || equipment.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('צריך להוסיף קודם מתאמן וציוד')),
      );
      return;
    }
    var traineeId = trainees.first.id;
    var equipmentId = equipment.first.id;
    final quantity = TextEditingController(text: '1');
    final save = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('שיוך ציוד'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: traineeId,
                decoration: const InputDecoration(labelText: 'מתאמן'),
                items: trainees
                    .map(
                      (item) => DropdownMenuItem(
                        value: item.id,
                        child: Text(item.name),
                      ),
                    )
                    .toList(),
                onChanged: (value) =>
                    setDialogState(() => traineeId = value ?? traineeId),
              ),
              DropdownButtonFormField<String>(
                initialValue: equipmentId,
                decoration: const InputDecoration(labelText: 'ציוד'),
                items: equipment
                    .map(
                      (item) => DropdownMenuItem(
                        value: item.id,
                        child: Text('${item.name} (${item.totalQuantity})'),
                      ),
                    )
                    .toList(),
                onChanged: (value) =>
                    setDialogState(() => equipmentId = value ?? equipmentId),
              ),
              TextField(
                controller: quantity,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'כמות'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('ביטול'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('שמירת שיוך'),
            ),
          ],
        ),
      ),
    );
    if (save == true) {
      final count = int.tryParse(quantity.text) ?? 0;
      final selected = equipment.firstWhere((item) => item.id == equipmentId);
      final assigned = await repository.assignedQuantity(
        workoutId: workoutId,
        equipmentId: equipmentId,
      );
      if (count <= 0 || assigned + count > selected.totalQuantity) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('הכמות גדולה מהציוד הזמין')),
          );
        }
      } else {
        await repository.saveAssignment(
          workspaceId: workspaceId,
          workoutId: workoutId,
          traineeId: traineeId,
          equipmentId: equipmentId,
          quantity: count,
        );
      }
    }
    quantity.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Trainee>>(
      stream: repository.watchTrainees(workspaceId),
      builder: (context, traineesSnapshot) {
        final trainees = traineesSnapshot.data ?? const [];
        return StreamBuilder<List<EquipmentItem>>(
          stream: repository.watchEquipment(workspaceId),
          builder: (context, equipmentSnapshot) {
            final equipment = equipmentSnapshot.data ?? const [];
            return StreamBuilder<List<AssignmentOverview>>(
              stream: repository.watchAssignments(workoutId),
              builder: (context, assignmentSnapshot) {
                final assignments = assignmentSnapshot.data ?? const [];
                return ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () =>
                                _assign(context, trainees, equipment),
                            icon: const Icon(Icons.add),
                            label: const Text('שיוך ציוד'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        OutlinedButton.icon(
                          onPressed: () => _addTrainee(context),
                          icon: const Icon(Icons.person_add_alt_1),
                          label: const Text('מתאמן'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    if (assignments.isEmpty)
                      const _EmptyState(text: 'עדיין אין שיוכים')
                    else
                      ...assignments.map(
                        (item) => Card(
                          child: ListTile(
                            leading: const Icon(Icons.person_outline),
                            title: Text(item.traineeName),
                            subtitle: Text(item.equipmentName),
                            trailing: Text(
                              '${item.quantity}',
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                          ),
                        ),
                      ),
                  ],
                );
              },
            );
          },
        );
      },
    );
  }
}

class _ReturnsTab extends StatelessWidget {
  const _ReturnsTab({required this.workoutId, required this.repository});

  final String workoutId;
  final OfflineRepository repository;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<AssignmentOverview>>(
      stream: repository.watchAssignments(workoutId),
      builder: (context, snapshot) {
        final assignments = snapshot.data ?? const [];
        if (assignments.isEmpty) {
          return const _EmptyState(text: 'אין ציוד שממתין להחזרה');
        }
        final total = assignments.fold(0, (sum, item) => sum + item.quantity);
        final returned = assignments.fold(
          0,
          (sum, item) => sum + item.returnedQuantity,
        );
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Text(
                      '$returned/$total הוחזרו',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 8),
                    LinearProgressIndicator(value: total == 0 ? 0 : returned / total),
                  ],
                ),
              ),
            ),
            ...assignments.map(
              (item) => Card(
                child: ListTile(
                  title: Text(item.traineeName),
                  subtitle: Text(
                    '${item.equipmentName} · ${item.returnedQuantity}/${item.quantity}',
                  ),
                  trailing: FilledButton(
                    onPressed: item.returnedQuantity == item.quantity
                        ? null
                        : () => repository.setReturnedQuantity(
                            assignmentId: item.id,
                            returnedQuantity: item.returnedQuantity + 1,
                          ),
                    child: Text(
                      item.returnedQuantity == item.quantity ? 'הוחזר' : '+1 חזר',
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Text(text, textAlign: TextAlign.center),
    );
  }
}
