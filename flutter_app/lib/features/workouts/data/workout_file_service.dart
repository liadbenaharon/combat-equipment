import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/database/app_database.dart';
import 'offline_repository.dart';

class WorkoutFileService {
  const WorkoutFileService(this._repository);

  final OfflineRepository _repository;

  Future<int> exportAndShare(Workout workout) async {
    final assignments = await _repository.getAssignments(workout.id);
    final rows = <List<String>>[
      ['Combat Equipment', '1'],
      ['workout_id', workout.id],
      ['workout_title', workout.title],
      ['שם המתאמן', 'ציוד', 'כמות', 'הוחזר'],
      ...assignments.map(
        (item) => [
          item.traineeName,
          item.equipmentName,
          '${item.quantity}',
          '${item.returnedQuantity}',
        ],
      ),
    ];
    final csv = '\uFEFF${rows.map(_encodeRow).join('\r\n')}\r\n';
    final safeTitle = workout.title.replaceAll(
      RegExp(r'[^\p{L}\p{N}_-]+', unicode: true),
      '-',
    );
    await SharePlus.instance.share(
      ShareParams(
        subject: 'רשימת ציוד — ${workout.title}',
        text: 'רשימת המתאמנים והציוד עבור ${workout.title}',
        files: [
          XFile.fromData(utf8.encode(csv), mimeType: 'text/csv'),
        ],
        fileNameOverrides: ['combat-equipment-$safeTitle.csv'],
      ),
    );
    return assignments.length;
  }

  Future<int?> pickAndImport({
    required String workspaceId,
    required Workout targetWorkout,
  }) async {
    final file = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: const ['csv'],
    );
    if (file == null) return null;
    final text = utf8.decode(await file.readAsBytes(), allowMalformed: false);
    final rows = _parseCsv(text.replaceFirst('\uFEFF', ''));
    final headerIndex = rows.indexWhere(
      (row) => row.length >= 4 && row[0].trim() == 'שם המתאמן',
    );
    if (headerIndex < 0) {
      throw const FormatException('לא נמצאה שורת הכותרות של Combat Equipment');
    }

    final equipment = await _repository.getEquipment(workspaceId);
    final equipmentByName = {
      for (final item in equipment) item.name.trim().toLowerCase(): item,
    };
    final trainees = await _repository.getTrainees(workspaceId);
    final traineeIdByName = {
      for (final item in trainees) item.name.trim().toLowerCase(): item.id,
    };
    final parsed = <_ImportedRow>[];
    for (var index = headerIndex + 1; index < rows.length; index++) {
      final row = rows[index];
      if (row.every((cell) => cell.trim().isEmpty)) continue;
      if (row.length < 4) {
        throw FormatException('שורה ${index + 1}: חסרים ערכים');
      }
      final traineeName = row[0].trim();
      final equipmentName = row[1].trim();
      final quantity = int.tryParse(row[2].trim());
      final returned = int.tryParse(row[3].trim());
      if (traineeName.isEmpty || equipmentName.isEmpty) {
        throw FormatException('שורה ${index + 1}: חסר שם או ציוד');
      }
      if (quantity == null || quantity <= 0) {
        throw FormatException('שורה ${index + 1}: הכמות אינה תקינה');
      }
      if (returned == null || returned < 0 || returned > quantity) {
        throw FormatException('שורה ${index + 1}: כמות ההחזרה אינה תקינה');
      }
      final equipmentItem = equipmentByName[equipmentName.toLowerCase()];
      if (equipmentItem == null) {
        throw FormatException(
          'שורה ${index + 1}: הציוד "$equipmentName" לא קיים באפליקציה',
        );
      }
      parsed.add(
        _ImportedRow(
          traineeName: traineeName,
          equipment: equipmentItem,
          quantity: quantity,
          returnedQuantity: returned,
        ),
      );
    }

    final totals = <String, int>{};
    for (final row in parsed) {
      totals.update(
        row.equipment.id,
        (value) => value + row.quantity,
        ifAbsent: () => row.quantity,
      );
    }
    for (final item in equipment) {
      if ((totals[item.id] ?? 0) > item.totalQuantity) {
        throw FormatException(
          'הכמות הכוללת של ${item.name} גדולה מהמלאי (${item.totalQuantity})',
        );
      }
    }

    for (final row in parsed) {
      final key = row.traineeName.toLowerCase();
      if (!traineeIdByName.containsKey(key)) {
        final id = await _repository.addTrainee(
          workspaceId: workspaceId,
          name: row.traineeName,
        );
        traineeIdByName[key] = id;
      }
    }

    await _repository.replaceWorkoutAssignments(
      workspaceId: workspaceId,
      workoutId: targetWorkout.id,
      replacements: parsed
          .map(
            (row) => AssignmentReplacement(
              traineeId: traineeIdByName[row.traineeName.toLowerCase()]!,
              equipmentId: row.equipment.id,
              quantity: row.quantity,
              returnedQuantity: row.returnedQuantity,
            ),
          )
          .toList(),
    );
    return parsed.length;
  }

  String _encodeRow(List<String> cells) {
    return cells.map((cell) => '"${cell.replaceAll('"', '""')}"').join(',');
  }

  List<List<String>> _parseCsv(String input) {
    final rows = <List<String>>[];
    var row = <String>[];
    final cell = StringBuffer();
    var quoted = false;
    for (var index = 0; index < input.length; index++) {
      final char = input[index];
      if (char == '"') {
        if (quoted && index + 1 < input.length && input[index + 1] == '"') {
          cell.write('"');
          index++;
        } else {
          quoted = !quoted;
        }
      } else if (char == ',' && !quoted) {
        row.add(cell.toString());
        cell.clear();
      } else if ((char == '\n' || char == '\r') && !quoted) {
        if (char == '\r' && index + 1 < input.length && input[index + 1] == '\n') {
          index++;
        }
        row.add(cell.toString());
        cell.clear();
        rows.add(row);
        row = <String>[];
      } else {
        cell.write(char);
      }
    }
    if (cell.isNotEmpty || row.isNotEmpty) {
      row.add(cell.toString());
      rows.add(row);
    }
    if (quoted) throw const FormatException('קובץ CSV לא תקין');
    return rows;
  }
}

class _ImportedRow {
  const _ImportedRow({
    required this.traineeName,
    required this.equipment,
    required this.quantity,
    required this.returnedQuantity,
  });

  final String traineeName;
  final EquipmentItem equipment;
  final int quantity;
  final int returnedQuantity;
}
