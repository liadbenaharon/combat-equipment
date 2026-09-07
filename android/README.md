# Android / Google Play

זוהי מעטפת Android אמיתית מסוג Trusted Web Activity לאפליקציית ה־PWA.

## הגדרות

- Application ID: `com.liadbenaharon.combatequipment`
- כתובת: `https://liadbenaharon.github.io/combat-equipment/`
- גרסה: `2.4.4` / version code `254`
- `compileSdk` ו־`targetSdk`: API 36
- מינימום: Android 7.0 / API 24
- הרשאה יחידה: גישה לאינטרנט
- ללא analytics, פרסום, חשבון, התראות או הרשאות אנשי קשר/מיקום/קבצים

## בנייה מקומית

פתחו את התיקייה `android` ב־Android Studio, התקינו Android SDK 36 ובנו `bundleRelease`. לחלופין, עם Java 17, Android SDK ו־Gradle 8.11.1:

```bash
cd android
gradle bundleRelease
```

ללא משתני חתימה ייווצר AAB לא חתום לבדיקה. לבניית AAB חתום הגדירו:

- `ANDROID_KEYSTORE_PATH`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

אין לשמור keystore או סיסמאות ב־Git.

## בנייה אוטומטית

ה־workflow בשם **Android AAB** בונה ומעלה artifact מכל שינוי בתיקיית Android, ואפשר להפעילו ידנית. אם מוסיפים ל־GitHub Actions את ארבעת הסודות הבאים, ה־AAB ייחתם אוטומטית:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

`ANDROID_KEYSTORE_BASE64` הוא קובץ ה־keystore כולו בקידוד Base64. מפתח החתימה והסיסמאות אינם חלק מהמאגר.

## Digital Asset Links — חובה לפני פרסום

לאחר הפעלת Play App Signing, העתיקו את טביעת SHA-256 של **App signing certificate** מ־Play Console, החליפו את הערך ב־[`assetlinks.template.json`](assetlinks.template.json), ופרסמו את הקובץ בכתובת המדויקת:

`https://liadbenaharon.github.io/.well-known/assetlinks.json`

הקובץ חייב להיות בשורש הדומיין. כתובת תחת `/combat-equipment/.well-known/` אינה מספיקה. לכן צריך לפרסם אותו במאגר GitHub Pages הראשי `liadbenaharon.github.io` או להעביר את האתר לדומיין שבשליטת המפרסם. עד שהקישור יאומת, האפליקציה עשויה להיפתח כ־Custom Tab עם סרגל דפדפן במקום כ־TWA מלא.

## לפני Production

1. לבנות AAB חתום ולעלות קודם ל־Internal testing.
2. לוודא שאין סרגל כתובת וש־Digital Asset Links אומתו.
3. לבדוק מצב לא מקוון, חזרה, סיבוב, הגדלת גופן, TalkBack ושמירת נתונים לאחר עדכון.
4. להשלים את הקבצים בתיקיית `play-store` ואת כל הצהרות Play Console.
