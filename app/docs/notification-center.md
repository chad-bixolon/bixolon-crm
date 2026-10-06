# Notification Center

The Dashboard and reports show persistent business truth from Price Exception records. The Notification Center is each user's attention queue. Reading or dismissing a notification changes only that user's Notification row; it never changes PE status, expiration, follow-up, or audit history.

## States and access

- Unread means `readAt` is empty. Active means both `dismissedAt` and `resolvedAt` are empty. The badge counts active unread rows.
- Dismissed rows stay in history. Resolved rows stay in history. There is no user-facing delete action.
- Reads and mutations use the effective user, including local development impersonation. Admins see only their own notifications. PE visibility is checked on lists, updates, and the normal PE detail route. Stale inaccessible notifications are hidden from lists and cannot be opened through the notification action.

## PE sources

The daily evaluator uses the shared New York business date, expiration calculation, and follow-up overdue helper. It creates one 31–60 day Info notice, one 0–30 day Warning notice, one expired Critical notice, and one Warning notice per overdue follow-up date. The expired notice itself says when follow-up has not started; no separate alert is created for that state. Critical is reserved for a date that has already passed; overdue follow-up uses Warning because no lateness escalation policy exists.

The 60-day notice resolves when the PE enters the 30-day window. The 30-day notice resolves after expiration. Overdue notices resolve when the date moves ahead, follow-up closes, ownership changes, or the PE is archived. Changing an overdue date creates a new source key for the new date. Resolved and dismissed instances are never reopened by a rerun. Assignment notifications remain until read or dismissed.

The recipient is the follow-up owner, or the assigned Sales Rep when there is no follow-up record yet. An existing follow-up record with no owner remains unassigned, matching the PE report. There is no team-wide manager or admin broadcast. A Sales user is skipped if existing PE visibility would deny that PE. Manager/admin reassignment creates an immediate Info notice for the new owner, keyed by the follow-up audit event ID. Assigning to oneself does not create an assignment notice.

All source keys include PE ID, recipient ID, and condition, with the follow-up date or assignment audit ID when needed. The database unique constraint and `createMany(..., skipDuplicates: true)` make reruns idempotent. Types, severity, and entity type are general so Tasks, Opportunities, Demos, Projects, Trade Shows, and Campaigns can be added later. No user preference UI exists in v1.

## Operation

The evaluator does not run on page views. Follow-up edits synchronize conditions and reassignment notices in the PE transaction. Date-based changes require a daily scheduler to POST `/api/internal/notifications/evaluate` with `Authorization: Bearer <NOTIFICATION_EVALUATOR_SECRET>`. Configure a random secret of at least 32 characters in the DigitalOcean app environment and a daily authenticated job after migration deployment. Without that job, date-based notifications do not advance. The endpoint returns 404 when the secret is absent or incorrect. No email, push, Slack, or Teams delivery is used.
