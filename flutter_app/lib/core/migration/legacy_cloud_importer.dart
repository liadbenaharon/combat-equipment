import 'package:drift/drift.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../features/workouts/data/offline_repository.dart';
import '../database/app_database.dart';

/// Imports the previous coach_states JSON only when the normalized local
/// workspace is empty. The caller must pull normalized cloud data first, which
/// prevents a second device from importing the same legacy snapshot again.
class LegacyCloudImporter {
  LegacyCloudImporter(this._database, this._client, this._repository);

  final AppDatabase _database;
  final SupabaseClient _client;
  final OfflineRepository _repository;

  Future<bool> importIfNeeded(String workspaceId) async {
    if (!await _isEmpty(workspaceId)) return false;

    final row = await _client
        .from('coach_states')
        .select('data')
        .eq('owner_id', workspaceId)
        .maybeSingle();
    final rawData = row?['data'];
    if (rawData is! Map || rawData.isEmpty) return false;
    final data = rawData.cast<String, dynamic>();

    final history = _listOfMaps(data['combatEquipmentHistoryV1']);
    final currentState = _map(data['combatEquipmentStateV1']);
    final currentEquipment = _listOfMaps(currentState['equipment']);
    final contacts = _listOfMaps(data['combatEquipmentContactsV1']);
    final returns = _map(data['combatEquipmentReturnsV1']);

    final equipmentByLegacyId = <String, _LegacyEquipment>{};
    for (final item in [
      ...currentEquipment,
      ...history.expand((workout) => _listOfMaps(workout['equipment'])),
    ]) {
      final legacyId = '${item['id'] ?? item['name'] ?? ''}'.trim();
      final name = '${item['name'] ?? legacyId}'.trim();
      final quantity = _integer(item['qty']);
      if (legacyId.isEmpty || name.isEmpty || quantity <= 0) continue;
      final existing = equipmentByLegacyId[legacyId];
      if (existing == null || quantity > existing.quantity) {
        equipmentByLegacyId[legacyId] = _LegacyEquipment(
          name: name,
          quantity: quantity,
        );
      }
    }

    final traineeNames = <String>{};
    for (final contact in contacts) {
      _addName(traineeNames, contact['name']);
    }
    for (final workout in history) {
      for (final person in _listOfMaps(workout['people'])) {
        _addName(traineeNames, person['name']);
      }
      _collectAssignmentNames(
        traineeNames,
        _listOfMaps(workout['equipment']),
      );
    }
    _collectAssignmentNames(traineeNames, currentEquipment);

    final equipmentIds = <String, String>{};
    for (final entry in equipmentByLegacyId.entries) {
      equipmentIds[entry.key] = await _repository.addEquipment(
        workspaceId: workspaceId,
        name: entry.value.name,
        totalQuantity: entry.value.quantity,
      );
    }

    final traineeIds = <String, String>{};
    final sortedNames = traineeNames.toList()..sort();
    for (final name in sortedNames) {
      traineeIds[_normalizedName(name)] = await _repository.addTrainee(
        workspaceId: workspaceId,
        name: name,
      );
    }

    for (final workout in history) {
      final legacyWorkoutId = '${workout['id'] ?? ''}';
      final dateLabel = '${workout['date'] ?? ''}'.trim();
      final workoutId = await _repository.createWorkout(
        workspaceId: workspaceId,
        title: dateLabel.isEmpty ? 'אימון קודם' : dateLabel,
        startsAt: _legacyDate(workout['id']),
      );
      await _importAssignments(
        workspaceId: workspaceId,
        workoutId: workoutId,
        equipment: _listOfMaps(workout['equipment']),
        equipmentIds: equipmentIds,
        traineeIds: traineeIds,
        returnedUnits: _map(returns['history:$legacyWorkoutId']),
      );
    }

    if (_hasAssignments(currentEquipment)) {
      final workoutId = await _repository.createWorkout(
        workspaceId: workspaceId,
        title: 'האימון הנוכחי',
        startsAt: DateTime.now(),
      );
      await _importAssignments(
        workspaceId: workspaceId,
        workoutId: workoutId,
        equipment: currentEquipment,
        equipmentIds: equipmentIds,
        traineeIds: traineeIds,
        returnedUnits: const {},
      );
    }
    return true;
  }

  Future<void> _importAssignments({
    required String workspaceId,
    required String workoutId,
    required List<Map<String, dynamic>> equipment,
    required Map<String, String> equipmentIds,
    required Map<String, String> traineeIds,
    required Map<String, dynamic> returnedUnits,
  }) async {
    for (final item in equipment) {
      final legacyEquipmentId = '${item['id'] ?? item['name'] ?? ''}'.trim();
      final equipmentId = equipmentIds[legacyEquipmentId];
      if (equipmentId == null) continue;
      for (final assignment in _listOfMaps(item['assignments'])) {
        final name = '${assignment['name'] ?? ''}'.trim();
        final traineeId = traineeIds[_normalizedName(name)];
        final quantity = _integer(assignment['qty']);
        if (traineeId == null || quantity <= 0) continue;
        final assignmentId = await _repository.saveAssignment(
          workspaceId: workspaceId,
          workoutId: workoutId,
          traineeId: traineeId,
          equipmentId: equipmentId,
          quantity: quantity,
        );
        final units = _list(assignment['units']);
        final returned = units
            .where(
              (unit) =>
                  returnedUnits['$legacyEquipmentId:${_integer(unit)}'] == true,
            )
            .length;
        if (returned > 0) {
          await _repository.setReturnedQuantity(
            assignmentId: assignmentId,
            returnedQuantity: returned.clamp(0, quantity).toInt(),
          );
        }
      }
    }
  }

  Future<bool> _isEmpty(String workspaceId) async {
    final workout = await (_database.select(_database.workouts)
          ..where(
            (row) => row.workspaceId.equals(workspaceId) & row.deletedAt.isNull(),
          )
          ..limit(1))
        .getSingleOrNull();
    final equipment = await (_database.select(_database.equipmentItems)
          ..where(
            (row) => row.workspaceId.equals(workspaceId) & row.deletedAt.isNull(),
          )
          ..limit(1))
        .getSingleOrNull();
    final trainee = await (_database.select(_database.trainees)
          ..where(
            (row) => row.workspaceId.equals(workspaceId) & row.deletedAt.isNull(),
          )
          ..limit(1))
        .getSingleOrNull();
    return workout == null && equipment == null && trainee == null;
  }
}

void _collectAssignmentNames(
  Set<String> names,
  List<Map<String, dynamic>> equipment,
) {
  for (final item in equipment) {
    for (final assignment in _listOfMaps(item['assignments'])) {
      _addName(names, assignment['name']);
    }
  }
}

void _addName(Set<String> names, Object? value) {
  final name = '$value'.trim();
  if (value != null && name.isNotEmpty && name != 'null') names.add(name);
}

bool _hasAssignments(List<Map<String, dynamic>> equipment) => equipment.any(
  (item) => _listOfMaps(item['assignments']).isNotEmpty,
);

String _normalizedName(String value) => value.trim().toLowerCase();

DateTime _legacyDate(Object? value) {
  final milliseconds = value is num ? value.toInt() : int.tryParse('$value');
  if (milliseconds != null && milliseconds > 1000000000000) {
    return DateTime.fromMillisecondsSinceEpoch(milliseconds, isUtc: true);
  }
  return DateTime.now().toUtc();
}

int _integer(Object? value) => switch (value) {
  int number => number,
  num number => number.toInt(),
  _ => int.tryParse('$value') ?? 0,
};

Map<String, dynamic> _map(Object? value) =>
    value is Map ? value.cast<String, dynamic>() : <String, dynamic>{};

List<dynamic> _list(Object? value) => value is List ? value : const [];

List<Map<String, dynamic>> _listOfMaps(Object? value) => _list(value)
    .whereType<Map>()
    .map((item) => item.cast<String, dynamic>())
    .toList();

class _LegacyEquipment {
  const _LegacyEquipment({required this.name, required this.quantity});

  final String name;
  final int quantity;
}
