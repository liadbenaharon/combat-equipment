# Combat Equipment — Flutter Android

This directory is the native Android replacement for the existing web/TWA
client. It intentionally uses the same Android application ID:
`com.liadbenaharon.combatequipment`.

The first implementation milestone is the offline-first persistence and sync
foundation described in [docs/OFFLINE_FIRST.md](docs/OFFLINE_FIRST.md).

## הפעלה מקומית עם Supabase

ערכי החיבור הם כתובת הפרויקט ומפתח פרסום ציבורי בלבד. אין להכניס
`service_role` לאפליקציה.

```bash
flutter run \
  --dart-define=SUPABASE_URL=https://PROJECT.supabase.co \
  --dart-define=SUPABASE_PUBLISHABLE_KEY=sb_publishable_EXAMPLE
```

יש להוסיף ב-Supabase Auth את כתובת החזרה:

`com.liadbenaharon.combatequipment://login-callback/`
