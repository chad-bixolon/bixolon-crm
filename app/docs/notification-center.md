# Notification Center

The Dashboard and reports show broader business and management truth. The Notification Center is each user's actionable attention queue. Reading or dismissing a notification changes only that user's Notification row; it never changes the source record or its audit history.

## States and access

- Unread means `readAt` is empty. Active means both `dismissedAt` and `resolvedAt` are empty. The badge counts active unread rows.
- Dismissed rows stay in history. Resolved rows stay in history. There is no user-facing delete action.
- Reads and mutations use the effective user, including local development impersonation. Admins see only their own notifications. Entity visibility is checked on lists, updates, and normal detail routes. Stale inaccessible notifications are hidden from lists and cannot be opened through the notification action.
- The full page combines state (Active, Unread, All / History, Dismissed, Resolved), category (All, Price Exceptions, Tasks, Opportunities), and severity filters with server-side pagination. The bell remains a seven-item active preview.

## PE sources

The daily evaluator uses the shared New York business date, expiration calculation, and follow-up overdue helper. It creates one 31–60 day Info notice, one 0–30 day Warning notice, one expired Critical notice, and one Warning notice per overdue follow-up date. The expired notice itself says when follow-up has not started; no separate alert is created for that state. Critical is reserved for a date that has already passed; overdue follow-up uses Warning because no lateness escalation policy exists.

The 60-day notice resolves when the PE enters the 30-day window. The 30-day notice resolves after expiration. Overdue notices resolve when the date moves ahead, follow-up closes, ownership changes, or the PE is archived. Changing an overdue date creates a new source key for the new date. Resolved and dismissed instances are never reopened by a rerun. Assignment notifications remain until read or dismissed.

The recipient is the follow-up owner, or the assigned Sales Rep when there is no follow-up record yet. An existing follow-up record with no owner remains unassigned, matching the PE report. There is no team-wide manager or admin broadcast. A Sales user is skipped if existing PE visibility would deny that PE. Manager/admin reassignment creates an immediate Info notice for the new owner, keyed by the follow-up audit event ID. Assigning to oneself does not create an assignment notice.

All source keys include PE ID, recipient ID, and condition, with the follow-up date or assignment audit ID when needed. The database unique constraint and `createMany(..., skipDuplicates: true)` make reruns idempotent. Types, severity, and entity type are general so Tasks, Opportunities, Demos, Projects, Trade Shows, and Campaigns can be added later. No user preference UI exists in v1.

## Task and Opportunity sources

- A new Task assignee receives an immediate Info notification, keyed by the Task assignment event ID. A new Opportunity owner receives an immediate Info notification, keyed by the Opportunity baseline or owner history event ID. Returning ownership can therefore generate a new assignment notice. Only the new assignee or owner receives it.
- The evaluator creates Warning notices for open Tasks due today or overdue. Due-today keys include the due business date; overdue keys include the due date, avoiding daily duplicates. Completion, cancellation, archiving, a due-date move, or reassignment resolves active notices that no longer apply. Assignment notices remain historical/read/dismissible.
- The evaluator creates a Warning notice for an open owned Opportunity whose expected close date is before the New York business date. It also creates a Warning notice for an open Commit Opportunity when the existing Forecast Attention `STALE_COMMIT` predicate finds no recent directly linked, nonarchived Activity. The configured `COMMIT_FOLLOW_UP_DAYS` threshold is reused. The Commit key includes the latest qualifying history event and latest linked Activity ID and date, so a new stale spell can be a new condition.
- Closing or archiving an Opportunity, moving its close date to today or later, leaving Commit, recording a qualifying Activity, or changing the owner resolves applicable active notices. Won and Lost stages are closed and excluded. No other Forecast Attention conditions generate notifications.
- Date/condition notices go only to the current active assignee or Opportunity owner. There is no manager, Admin, or Read Only broadcast. A dismissed condition is not recreated by a rerun with the same source key. Task overdue uses Warning, matching the existing overdue follow-up convention; Critical remains reserved for expired Price Exceptions.

## Operation

The evaluator does not run on page views. Follow-up, Task, Opportunity, and directly linked Activity edits synchronize their applicable conditions in the source transaction. Date-based changes require a daily scheduler to POST `/api/internal/notifications/evaluate` with `Authorization: Bearer <NOTIFICATION_EVALUATOR_SECRET>`. Configure a random secret of at least 32 characters in the DigitalOcean app environment and a daily authenticated job. Without that job, date-based notifications do not advance. The endpoint returns 404 when the secret is absent or incorrect. Its response contains `evaluated`, `created`, and `resolved` counts for `priceExceptions`, `tasks`, and `opportunities`, plus totals; it contains no record content. No email, push, Slack, or Teams delivery is used.
