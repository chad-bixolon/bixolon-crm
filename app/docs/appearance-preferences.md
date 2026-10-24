# Appearance Preferences v1

`User.appearancePreference` is a typed personal setting with `SYSTEM`, `LIGHT`, and `DARK`. The migration backfills pre-existing users as `LIGHT` and changes the column default to `SYSTEM` for users created afterward. Admin User forms and CSV import/export do not read or write it. Only the real authenticated user may change their own value in My integrations → Personal settings; development impersonation does not change whose preference is saved.

The root layout reads the real user's value and renders `data-appearance` on `<html>`. An unauthenticated sign-in renders `system`. `color-scheme: light dark` and CSS `light-dark()` resolve System against the device before paint and respond to later device changes without hydration-time DOM edits or a local copy of the server preference. Light and Dark force the corresponding browser scheme. The selection updates the DOM immediately, then saves through an authenticated server action. A failed save restores the prior selection.

Appearance affects application CSS only. Exports, documents, product images, attachments, printable reports, and outbound email content retain their own presentation. The single configured company logo receives a light neutral backing in both themes and is never inverted. V1 does not provide separate Light and Dark logo uploads, theme packs, custom colors, or an organization-enforced theme.

To roll back, first deploy application code that does not use the column, then remove `User.appearancePreference` and the `AppearancePreference` enum. Removing the column discards saved choices; users return to the former light-only UI.
