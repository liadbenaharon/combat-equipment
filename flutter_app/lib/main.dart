import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: CombatEquipmentApp()));
}

class CombatEquipmentApp extends StatelessWidget {
  const CombatEquipmentApp({super.key});

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
      home: const Directionality(
        textDirection: TextDirection.rtl,
        child: OfflineFoundationPage(),
      ),
    );
  }
}

class OfflineFoundationPage extends StatelessWidget {
  const OfflineFoundationPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ניהול ציוד')),
      body: const SafeArea(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(Icons.inventory_2_rounded, size: 72),
              SizedBox(height: 20),
              Text(
                'הגרסה המקומית החדשה',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 12),
              Text(
                'האימונים והציוד נשמרים קודם בטלפון. החיבור ל-Supabase מסנכרן אותם כשיש אינטרנט.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 17, height: 1.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
