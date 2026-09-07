# Google Play test release checklist

The web/PWA repository is ready to serve as the web content for an Android test build after the automated and manual checks below pass on the production HTTPS URL.

## Completed in this repository

- [x] Installable web manifest with name, stable app id/scope, standalone display, theme colors, categories, shortcuts, and 192/512 icons.
- [x] Maskable-capable 512 icon with an opaque background and safe central artwork.
- [x] Offline app shell and navigation fallback.
- [x] Controlled service-worker update prompt and cache cleanup.
- [x] Central app/cache version and visible `v2.4.3`.
- [x] Backward-compatible data normalization and stable history ids.
- [x] Local JSON backup/restore with validation and rollback on failed import.
- [x] Privacy page, offline status, storage error feedback, keyboard dialog close, focus visibility, reduced-motion support, touch targets, safe areas, and narrow-screen adjustments.
- [x] Automated regression tests and CI workflow.

## Production PWA verification

- [x] Deploy the exact tested commit to `https://liadbenaharon.github.io/combat-equipment/` over HTTPS.
- [ ] In Chrome DevTools, run the Application manifest/installability checks and Lighthouse PWA/accessibility audits on the deployed URL.
- [ ] Install on at least one current Android phone, launch once online, then verify a cold launch in airplane mode.
- [ ] Upgrade from the previously installed PWA with real existing data and confirm the update banner, history, attendance, and unresolved return debts remain intact.
- [ ] Test backup download, restore on a second browser profile, Hebrew RTL layout, rotation, system font scaling, and 320/360/412 px widths.

## Android wrapper

The repository now includes a buildable Android Browser Helper TWA project in [`android/`](android/), targeting API 36 with a stable package id, production URL, no analytics, and only the Internet permission. GitHub Actions can build the AAB and can sign it when the publisher supplies protected repository secrets. The signing identity and Play Console steps must still be completed by the publisher.

1. Confirm the reserved application id `com.liadbenaharon.combatequipment` before the first Play upload; it cannot be changed after publication.
2. Create and securely retain the Android upload key. Never commit private keys or passwords.
3. Add a valid Digital Asset Links file at `https://liadbenaharon.github.io/.well-known/assetlinks.json`, containing the final application id and SHA-256 signing certificate fingerprint. A project-path file under `/combat-equipment/` is not sufficient. If the root GitHub Pages site cannot host it, use a domain you control.
4. Build a signed Android App Bundle (`.aab`) with Android Studio, Gradle, or the **Android AAB** workflow and verify the TWA opens without the browser address bar.
5. Test Android back navigation, process death/relaunch, offline startup, app update, orientation, large fonts, TalkBack, and at least the minimum and latest supported Android versions.

## Play Console work required outside this repository

- [ ] Create the app entry, accept the developer declarations, and configure Play App Signing.
- [ ] Upload the signed `.aab` to Internal testing first, add testers, and resolve every pre-launch report issue before Closed/Open testing.
- [ ] Supply store title/description, phone and tablet screenshots, high-resolution icon, feature graphic, category, contact details, and the public privacy-policy URL.
- [ ] Complete Data safety accurately: Google account details and approved training data are stored in Supabase; the app also hands a prepared number/message to WhatsApp only after a user action. Confirm the final Android wrapper adds no analytics, ads, backups, or permissions before declaring this.
- [ ] Complete content rating, ads declaration, target audience, app access, and the required public account/data-deletion route.
- [ ] Confirm the current target API deadline and testing requirements in Play Console immediately before submission; these policies change outside the repository.

## Release gate

Do not promote beyond Internal testing unless: CI is green, the deployed service worker controls the page, offline cold launch works, an upgrade preserves a realistic backup, Digital Asset Links verifies, the signed bundle passes Play pre-launch reports, and the store/privacy declarations match the final wrapper exactly.

