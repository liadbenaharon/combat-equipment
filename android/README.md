# Android / Google Play test build

ה־Web/PWA כבר פרוס ב־HTTPS. התיקייה הזו מכינה את עטיפת ה־Trusted Web Activity (TWA) בלי להכניס לריפו מפתחות חתימה, סיסמאות או סודות.

## הגדרות קבועות

- Application ID מומלץ: `com.liadbenaharon.combatequipment`
- כתובת ההשקה: `https://liadbenaharon.github.io/combat-equipment/`
- גרסת Android ראשונה: `2.3.1` / version code `231`
- ללא הרשאות, analytics או notifications שאינם נדרשים על ידי האפליקציה.
- תצורת Bubblewrap מוכנה בקובץ [`twa-manifest.example.json`](twa-manifest.example.json).

## יצירת הפרויקט ובניית AAB

יש לבצע במחשב עם Node.js, Java, Android SDK ו־Android Studio:

```powershell
npm install --global @bubblewrap/cli
New-Item -ItemType Directory -Force android-build | Out-Null
Set-Location android-build
bubblewrap init --manifest https://liadbenaharon.github.io/combat-equipment/manifest.webmanifest
```

במהלך האתחול יש לבחור את ה־Application ID שמופיע למעלה, או להעתיק את הערכים מ־`twa-manifest.example.json`. את שדות `signingKey` שבקובץ הדוגמה יש להחליף בנתיב וב־alias אמיתיים, או לתת ל־Bubblewrap ליצור מפתח חדש. אין להעתיק את ערכי ה־placeholder כמו שהם. לאחר מכן:

```powershell
bubblewrap update
bubblewrap build
```

הפקודה `build` מייצרת את ה־AAB. יש ליצור או לבחור מפתח upload מאובטח, לשמור אותו מחוץ לריפו, ולהעלות ל־Play Console עם Play App Signing. אין להכניס קובץ keystore או סיסמה ל־Git.

## Digital Asset Links — שלב חובה ל־TWA ללא סרגל דפדפן

אחרי יצירת ה־AAB, להעתיק את `assetlinks.template.json`, להחליף את טביעת ה־SHA-256 בטביעת **App signing certificate** שמוצגת ב־Play Console, ולפרסם אותו בכתובת המדויקת:

`https://liadbenaharon.github.io/.well-known/assetlinks.json`

חשוב: מאחר שהאפליקציה הנוכחית מתארחת ב־GitHub Project Pages תחת `/combat-equipment/`, הקובץ שבתוך הפרויקט יופיע תחת `/combat-equipment/.well-known/` ולא יעמוד בדרישת Android. לכן נדרש אתר־שורש/דומיין בשליטת המפרסם (או מעבר של ה־PWA לדומיין כזה) כדי להשלים אימות TWA. ללא אימות, ניתן לבדוק עטיפת WebView/Custom Tab, אך היא אינה תחליף מומלץ ל־TWA מאומת.

## בדיקת release לפני העלאה

1. לפתוח את ה־AAB ב־Android Studio ולוודא שאין הרשאות מיותרות.
2. להתקין Internal test על מכשיר Android אמיתי, לבדוק cold launch, offline, Back, rotation, גופנים גדולים, TalkBack ועדכון עם נתונים קיימים.
3. לוודא שה־Digital Asset Links מאומתים ושאין סרגל כתובת ב־TWA.
4. להעלות קודם ל־Internal testing ולפתור את כל ממצאי ה־Pre-launch report.

