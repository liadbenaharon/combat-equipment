# Pre-release audit

Audit date: 2026-09-04  
Baseline: `6a5e872` (`main`)

## Executive summary

The app's core equipment, attendance, history, and return flows are usable and all data is kept locally. The current baseline is not yet Play-test ready: two automated tests fail, version strings are duplicated and disagree, storage writes can fail without a consistent recovery path, and the service worker updates silently without an update/reload flow.

The upgrade must preserve the existing `localStorage` keys and accept every shape already written by released versions. No migration may delete or rename user data in place.

## Baseline verification

- `node --test tests/*.test.cjs`: 10 passed, 2 failed.
- Manifest, icons, and service worker exist and use the repository's GitHub Pages scope.
- The app has no server, account, analytics, advertising, or remote data synchronization.
- Primary data keys: `combatEquipmentStateV1`, `combatEquipmentHistoryV1`, `combatEquipmentAttendanceV2`, `combatEquipmentReturnsV1`, `combatEquipmentContactsV1`, `combatEquipmentPhonesV1`, and `combatEquipmentTraineesV1`.

## Findings and priorities

### P0 — release blockers

1. The service-worker tests expect an older implementation (`ASSETS`, HTML enhancement, cache v23) and fail against the shipped cache v34 implementation. A green, implementation-aligned test suite is required before release.
2. App version is written independently by several scripts (`v1.2.3`, `v1.2.6`, `v1.3.8`, and `v1.6.0`). Load order currently hides the inconsistency, but a partial-cache update can display the wrong version.
3. Core state/history writes use raw `localStorage.setItem`; quota, private-mode, or serialization failures can leave the UI appearing saved when persistence failed.

### P1 — high value

1. Add non-destructive schema normalization and migration for malformed or older equipment/history records while preserving unknown fields.
2. Add export/import backup with validation and transactional writes so device/browser loss is recoverable.
3. Add an explicit service-worker update banner, controlled activation, navigation fallback, cache cleanup, and offline status messaging.
4. Harden history/attendance/return identifiers so records remain associated after history order changes.
5. Improve dialog semantics, keyboard focus, visible focus, status announcements, touch targets, safe-area handling, and narrow-screen layout.

### P2 — Play/PWA readiness

1. Complete manifest metadata, shortcuts, icon purposes, and installability checks.
2. Add a privacy policy and a release checklist covering HTTPS hosting, asset links, TWA packaging, signing, Play Console declarations, screenshots, testing tracks, and store listing work that cannot be completed in this web repository.
3. Add automated tests for migrations, failed writes, backup round trips, consistency, manifest, and service-worker lifecycle.

## Compatibility rules

- Keep all released storage keys readable.
- Migrate by normalization on read and write only after a valid replacement is ready.
- Never clear unrelated keys.
- Preserve history entries and unresolved return debts.
- Treat corrupt payloads as recoverable errors; retain the raw value and offer backup/export where possible.
- Keep GitHub Pages subpath support (`/combat-equipment/`) and standalone browser support.

## Staged implementation

1. Data safety and a single app version source, with migration/unit tests.
2. Service-worker lifecycle, offline/update UX, manifest/installability, and accessibility.
3. Cross-feature consistency tests, privacy/release documentation, final browser and offline verification.
