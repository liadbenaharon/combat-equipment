# Google Play test release checklist

The web/PWA repository is ready to serve as the web content for an Android test build after the automated and manual checks below pass on the production HTTPS URL.

## Completed in this repository

- [x] Installable web manifest with name, stable app id/scope, standalone display, theme colors, categories, shortcuts, and 192/512 icons.
- [x] Maskable-capable 512 icon with an opaque background and safe central artwork.
- [x] Offline app shell and navigation fallback.
- [x] Controlled service-worker update prompt and cache cleanup.
- [x] Central app/cache version and visible `v2.1.0`.
- [x] Backward-compatible data normalization and stable history ids.
- [x] Local JSON backup/restore with validation and rollback on failed import.
- [x] Privacy page, offline status, storage error feedback, keyboard dialog close, focus visibility, reduced-motion support, touch targets, safe areas, and narrow-screen adjustments.
- [x] Automated regression tests and CI workflow.

## Production PWA verification

- [ ] Deploy the exact tested commit to `https://liadbenaharon.github.io/combat-equipment/` over HTTPS.
- [ ] In Chrome DevTools, run the Application manifest/installability checks and Lighthouse PWA/accessibility audits on the deployed URL.
- [ ] Install on at least one current Android phone, launch once online, then verify a cold launch in airplane mode.
- [ ] Upgrade from the previously installed PWA with real existing data and confirm the update banner, history, attendance, and unresolved return debts remain intact.
- [ ] Test backup download, restore on a second browser profile, Hebrew RTL layout, rotation, system font scaling, and 320/360/412 px widths.

## Android wrapper required outside this repository

1. Choose a unique Android application id (for example `com.example.combatequipment`; this must be owned and finalized by the publisher).
2. Generate a Trusted Web Activity project with Bubblewrap or Android Studio, targeting the production HTTPS start URL and current Play target SDK requirements.
3. Create and securely retain the Android upload/signing keys. Never commit private keys or passwords.
4. Add a valid Digital Asset Links file at `https://liadbenaharon.github.io/.well-known/assetlinks.json`, containing the final application id and SHA-256 signing certificate fingerprint. A project-path file under `/combat-equipment/` is not sufficient. If the root GitHub Pages site cannot host it, use a domain you control.
5. Build a signed Android App Bundle (`.aab`) and verify the TWA opens without the browser address bar. If asset links are unavailable, use a normal WebView wrapper and complete the additional security/review work it requires.
6. Test Android back navigation, process death/relaunch, offline startup, app update, orientation, large fonts, TalkBack, and at least the minimum and latest supported Android versions.

## Play Console work required outside this repository

- [ ] Create the app entry, accept the developer declarations, and configure Play App Signing.
- [ ] Upload the signed `.aab` to Internal testing first, add testers, and resolve every pre-launch report issue before Closed/Open testing.
- [ ] Supply store title/description, phone and tablet screenshots, high-resolution icon, feature graphic, category, contact details, and the public privacy-policy URL.
- [ ] Complete Data safety accurately: this build stores user-entered data locally and hands a prepared number/message to WhatsApp only after a user action; confirm the final Android wrapper adds no analytics, SDK collection, backups, or permissions before declaring this.
- [ ] Complete content rating, ads declaration, target audience, app access, and any account-deletion declaration (there are no accounts in the current web app).
- [ ] Confirm the current target API deadline and testing requirements in Play Console immediately before submission; these policies change outside the repository.

## Release gate

Do not promote beyond Internal testing unless: CI is green, the deployed service worker controls the page, offline cold launch works, an upgrade preserves a realistic backup, Digital Asset Links verifies, the signed bundle passes Play pre-launch reports, and the store/privacy declarations match the final wrapper exactly.
