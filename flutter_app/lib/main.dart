import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/config/app_config.dart';
import 'core/database/app_database.dart';
import 'features/auth/presentation/auth_gate.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SupabaseClient? client;
  if (AppConfig.hasCloudConfiguration) {
    await Supabase.initialize(
      url: AppConfig.supabaseUrl,
      publishableKey: AppConfig.supabasePublishableKey,
    );
    client = Supabase.instance.client;
  }
  runApp(
    ProviderScope(
      child: CombatEquipmentApp(database: AppDatabase(), client: client),
    ),
  );
}

class CombatEquipmentApp extends StatelessWidget {
  const CombatEquipmentApp({
    required this.database,
    required this.client,
    super.key,
  });

  final AppDatabase database;
  final SupabaseClient? client;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Combat Equipment',
      theme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFF7F2A),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xFF07150D),
        useMaterial3: true,
      ),
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: AuthGate(database: database, client: client),
      ),
    );
  }
}
