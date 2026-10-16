# Support Email production architecture

Gmail is the system of record for email. SalesHub is the system of record for the Support Case. [Outbound email logging](support-cases.md#log-an-outbound-email-response) records only a lightweight Activity summary for an email already sent outside SalesHub. It does not mirror Gmail, fetch Sent Mail, send messages, copy outbound bodies or attachments, or request additional OAuth scopes.

Support Inbox is `/support/inbox`, available from Support Cases to active Support/Admin users when `SUPPORT_GMAIL_ENABLED=true`. It ports the validated Support Email worktree into current SalesHub. Normal login and Calendar integration keep their existing clients and permissions. The dedicated Support client requests exactly `https://www.googleapis.com/auth/gmail.readonly`; the token exchange rejects any additional scope. Gmail calls are GET requests for profile, messages and explicitly selected attachment bytes. Only Google's OAuth token endpoint receives POST requests. No Gmail mutation API is implemented.

## Connection and environment boundaries

`SupportGmailConnection` is a singleton PostgreSQL record for the shared mailbox. It records mailbox, AES-256-GCM encrypted refresh token, exact granted scope, connection time, connecting CRM user, last successful inbox read and update time. Access tokens exist only in server memory. The encryption key is an encrypted runtime environment variable, never database content. There is no filesystem credential path or automatic import of the POC credential. Connect production afresh after rollout; the validated POC remains independent.

Authenticated encryption binds a token to canonical `AUTH_URL`, database identity (user/host/port/database, excluding password and pool parameters), dedicated OAuth client ID, mailbox and scope. Copying a token or database to another environment fails decryption. Changing these identities or rotating the key requires reconnecting. Restore the original key with a database backup if preserving its connection. Rotating only the database password does not require reconnection.

Live Gmail requires `NODE_ENV=production`, an explicit enable flag, canonical HTTPS origin, expected external PostgreSQL identity, database TLS and all test modes disabled. Local development cannot connect or read the real mailbox. The configured callback must exactly equal `${AUTH_URL}/api/support-gmail/callback` (with `AUTH_URL` containing an origin only); omitting the callback variable derives that value. Connect/disconnect/callback additionally validate the Host against the canonical origin. Use the canonical hostname at the App Platform proxy. Alternate app domains are not accepted for Support authorization.

If the feature is enabled on a development instance, the Inbox explains that live Gmail is available on the production site and retains the Support Cases link. Production environment validation failures ask for Gmail runtime configuration; connection lookup failures separately ask for mailbox settings and migration checks. An environment validation failure does not indicate a missing database migration.

OAuth uses the real authenticated active Support/Admin user, signed ten-minute state, HTTP-only SameSite=Lax callback-only cookies (Secure in production) and S256 PKCE. State binds the actor and verifier. Cookies are cleared after callback. A bounded per-process claim prevents concurrent replay; Google authorization codes are independently single-use across replicas. Fixed-stage diagnostics never log callback parameters, errors, provider payloads or credentials. Failed/declined consent preserves the existing connection. Successful reconnect replaces it; disconnect deletes only its PostgreSQL credential, without revoking Google access or modifying Gmail. Revocation can be performed separately in the Google account.

## Inbox window and historical context

Every explicit inbox view fetches at most 50 messages using Gmail's `after:<epoch-seconds> -in:spam -in:trash` query, then filters precisely by the configured lookback and sorts by received time. Default lookback is **30 days**, configurable from 1–365. There is no pagination, poller, mailbox mirror or automatic business-record write. The connection's last-successful-read timestamp is operational metadata and survives container replacement.

A dormant thread with no messages inside the window stays absent. A new message on an older thread becomes visible if it falls inside the window and returned 50-message cap. The adapter lists **messages**, not whole threads: it does not retrieve dormant older messages merely because a thread becomes active. Each returned message retains its plain-text body, including any quoted history Gmail includes; thread context uses the earliest available customer message in this bounded result. Linked/signed source messages and attachment retries can later be fetched by their verified exact IDs even when outside the window. No full historical thread reconstruction is claimed. See the [Gmail list API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

Different direct and Google Group deliveries stay separate by Gmail message/thread IDs, even with the same originating RFC Message-ID, sender, time, body and files. RFC Message-ID is not a deduplication key for those deliveries. A linked thread is a suggestion for other messages; only exact linked message IDs receive the Linked badge.

## CRM actions and source integrity

Viewing suggestions and opening intake save no business records. Suggestions use exact Contact email, eligible Account, linked thread, explicit BXS case reference and related open cases; ambiguity/conflicts require manual review. No Contact or Account is invented.

Create Case from Email uses normal Case validation, permissions, numbering and notifications, with the email source marker in audit/history. A signed 24-hour source binds actor, configured mailbox, selected message, thread and original request. Save verifies the signature and rereads the exact messages server-side before writing. Forged, expired, changed-thread, missing and cross-user sources fail. Case creation, email linking, audit and notifications commit atomically. PostgreSQL advisory thread locks serialize manual links and intake; a unique Gmail message ID additionally prevents duplicate linkage. Repeat intake redirects to the existing Case. Optional attachments are copied after Case/link commit; failures show that the Case was saved and offer review/retry.

Manual Link to Existing Case validates the chosen exact Case and rereads the selected message from the authorized recent mailbox. Link and Ignore share a per-mailbox/message PostgreSQL transaction lock (Link acquires the existing thread lock first). Link creation and dismissal removal commit together; repeat links also remove stale dismissals. Ignore checks for a link after acquiring that same lock, so a racing Ignore cannot hide an already-linked message. Intake retries for the already-linked message repair stale dismissals too. Ignore/Restore similarly validate the recent message before writing only mailbox/message/actor/time decisions in `SupportInboxDismissal`. Gmail stays unchanged. Ignored messages can be shown and restored within the same recent window. Case timelines and Account Support tabs show saved linked emails under existing Case visibility permissions; Sales and Read Only cannot browse the inbox or use mutation actions.

## Attachments and writing UX

Files require explicit unchecked selection. Signed file grants bind the source, message/thread, part and full attachment metadata. Import rereads Gmail and compares attachment ID, filename, MIME and size. Signature/tracking/decorative inline assets are hidden initially and can be reviewed; safety restrictions still apply. Existing Support envelope, binary signature, UTF-8 and 25 MB checks remain. Nothing is imported automatically.

Imported bytes use the existing `documentStorage` abstraction, private DigitalOcean Spaces and `<SPACES_PREFIX>/support-cases/<UUID>` production path. PostgreSQL retains mailbox/message/thread/attachment/part provenance. A unique Case/mailbox/message/part index and transaction lock prevent repeat imports, including after removal. Partial failures preserve successful files and saved Case/email links. Recovery reports and attachment review support retry. An ambiguous commit is reconciled against attachment metadata before deleting an uploaded object; failed cleanup may leave a private orphan for operator reconciliation. Files are not malware-scanned.

Attachment review queries 51 linked rows to display a page of 50 ordered by saved `messageDate DESC, id DESC`, with a validated Case-scoped cursor for older pages. Up to 50 unresolved failed-message sources from the latest 50 import events are included independently of that page, after verifying their thread remains linked to the Case. Up to 50 distinct linked-thread anchors and 50 retained-provenance message sources support recovery. Exact message reads are deduplicated and capped at 200. Import-event queries return at most 50 events (50 failures per event); completion checks are limited to those 2,500 identities. Review metadata is restricted to selected messages (at most 200 parts per message), and retained-source lookups are capped at 50.

The exact file ordering **within each conversation** is: unresolved failed parts first, then unimported parts, then already-imported parts (including removed files). Within each tier: received date descending, Gmail message ID ascending, then part ID ascending. Sort happens before the 200-options-per-conversation cap, so completed files cannot consume space ahead of actionable files. Conversations sort by their first file's tier, newest available message date descending, then thread ID ascending. Retry-source candidates follow latest import-event ID descending, then failure order in that event; linked messages independently use the date/ID page ordering above. Failed-message sources page in batches of 50 through “More failed email sources”; completed files do not consume that retry window. The existing 50-event recovery-history limit is preserved.

A missing, unreadable or identity-mismatched source produces an individual retry notice and leaves other messages reviewable. If any source is unavailable, one existing recent-inbox window (at most 50 messages) can supply surviving same-thread replies; retained provenance can also supply an exact reply ID outside that window. The source token uses a surviving verified message in the Case-linked thread. File grants always retain the actual message/thread/part IDs and are revalidated on import. No filename matching or provenance substitution is used. Missing original files remain unavailable until restored at their original source; restoring a different reply does not recreate an origin's missing attachment.

Email-originated creation alone gets the larger **Description / Email Thread** field; manual creation retains normal sizing. Support Note starts at five rows, grows for typing/paste, retains manual vertical resize, and scrolls internally at its CSS maximum height. Mailbox status stays compact; technical settings/actions remain under Manage, case-link controls are collapsed and cards wrap for desktop/tablet/mobile.

## Migrations and test modes

`20261013230000_support_email_production` adds `SupportCaseEmail`, `SupportInboxDismissal`, attachment provenance/duplicate index and `SupportGmailConnection`. It consolidates the final POC schema without adding then dropping its obsolete recipient column. Main had none of these models. No applied migration is changed. Do not apply it to the POC database or a database carrying the POC migration history; production uses main's history.

Automated tests use `SUPPORT_GMAIL_MOCK=true` or `SUPPORT_GMAIL_TEST_FIXTURE=true`, plus existing E2E authentication guards: nonproduction, test auth token, and `saleshub_e2e` on loopback port 55432. Fixture mode performs no Google requests; OAuth remains unavailable. Fixture IDs/text may retain POC prefixes solely for regression continuity. The normal `npm run test:e2e` runner supplies these values. There is no POC login provider, filesystem token, dry-run flag or port-3001 runtime in production.

See [production rollout](support-email-rollout.md) and [port comparison](support-email-port-review.md).

## Gmail request volume and protective limits

Inbox reads now fetch at most 50 message **metadata** records (headers, dates,
Gmail IDs and snippets), without fetching full MIME bodies or attachment bytes.
The preview continues to use Gmail's snippet. Full bodies and file metadata are
fetched only for a selected source, the selected thread's messages in the bounded
inbox window, or linked/recovery attachment sources. Metadata listing does not
show attachment counts or detect case numbers found only in the body; full
request text, earliest-request prefills and file selection remain available in
Create Case. Subject, sender, existing message/thread links and CRM suggestions
continue to work in the inbox.

All counts below include OAuth refresh and Gmail profile calls, exclude retries,
and assume a full 50-message inbox. Baselines were calculated from the original
call graph; the new counts are verified with a counting synthetic Google adapter.
A warm read means the same process has an inbox result less than 10 seconds old.
The initial inbox load is excluded from subsequent action counts.

| Workflow | Before | After |
| --- | ---: | ---: |
| Cold inbox | 53 (50 full bodies) | 53 (50 metadata reads) |
| Immediate identical inbox reload | 53 | 0 |
| Ignore / Restore and inbox redirect, warm | 106 | 3 |
| Ignore / Restore with expired cache or another replica | 106 | 56 |
| Link to Case and Case redirect | 53 | 3 |
| Open Create Case, single-message thread, warm | 53 | 3 |
| Save Create Case, one / two source messages | 3 / 6 | 3 / 4 |
| Create review + save, single-message thread, warm | 56 | 6 |
| Create review + save, single-message thread, cold | 56 | 59 |
| Review 50 linked attachment sources | 150 | 52 |
| Import one selected inline / external file | 3 / 4 | 3 / 4 |

For a thread with K messages in the bounded window, Create review costs K+2
requests on a warm inbox, or 53+K+2 on a cold inbox. The current bounded-window
selection of the earliest customer request and all reviewable thread files is
preserved. Attachment recovery may additionally read a cold inbox and fetch
matching surviving sources. Large reviews (up to 200 distinct sources) and
multi-file imports remain relatively expensive and can encounter the protective
short-window budget; existing per-file success/failure and retry behavior remains.

Ignore, Restore and Link require the actor-bound signed source rendered by the
inbox. They check the signed mailbox/message/thread against a fresh targeted
Gmail read, including the lookback and spam/trash exclusion. Arbitrary IDs,
forged sources, missing messages and thread mismatches cannot authorize a CRM
write. A cached inbox result is never accepted as live source validation. A
message that falls out of the top 50 after rendering can still be acted upon
using its signed source while it remains within the configured lookback.

The cache, single-flight registry, rate counters and Google cooldown are
**per Node process**, shared across users of that mailbox. There is no PostgreSQL
cache and no distributed lock. Each replica independently checks the persisted
connection and exact read-only scope before cache hits and live reads; live reads
also recheck the connection after completion. Cache keys contain only mailbox,
connection timestamp and read parameters; cached values contain only metadata.
OAuth tokens and credentials never enter cache keys or values. Tokens live only
inside the current operation, including its short read retry. One token refresh
and profile check covers each multi-message operation; each fresh token is still
verified against the expected mailbox. Reconnect/disconnect makes old cache
entries inaccessible. Cached objects are copied for callers, failures are not
cached, and expired entries are discarded. CRM dismissal/link queries always
run again so CRM writes are visible on immediate redirects.

Identical in-flight operations coalesce before limits are applied. Nonduplicate
operations allow at most three active operations per mailbox, including at most
one expensive inbox or multi-message review. Per mailbox and process, rolling
10-second windows allow 60 operation starts and 300 outgoing Google requests
(including refresh/profile/retry requests). There is no queue or arbitrary delay
for local throttling. The UI receives: **Support Gmail is busy. Please try again
in a moment.** Local throttles are never classified as Google failures. These
limits multiply with replicas; they are a safety net, not a cluster-wide quota.
Correctness does not depend on cache affinity or shared process state: signed
sources, live source checks, mailbox verification, permissions, PostgreSQL
transactions, advisory locks and uniqueness constraints remain authoritative.

Google error reason classification remains intact. Genuine HTTP 429 or recognized
rate-limit 403 responses establish a mailbox cooldown, honoring `Retry-After`
seconds or an HTTP date. Safe GETs retry **once**, after at least 1 second plus
0–249 ms jitter, or Google's longer minimum. If the minimum exceeds 2 seconds,
the request returns the Google rate-limit message immediately and the process
suppresses reads until the full cooldown expires. Token POSTs never retry. Only
one automatic retry owner is allowed per mailbox; concurrent callers share the
cooldown. A second rate-limit response ends the retry and renews the cooldown.
Quota, policy, scope, authentication and other failures retain their distinct
messages and do not enter this retry policy. See Google's [error handling
guide](https://developers.google.com/workspace/gmail/api/guides/handle-errors)
and [message get API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get).

Safe process logs use fixed workflow names (`inbox`, `ignore`, `restore`, `link`,
`create-review`, `create-save`, `file-review`, `file-import`) and events (`request`,
`cache-hit`, `coalesced`, `local-throttle`, `provider-rate-limit`, `retry`). Sum
`requests=1` events by workflow to measure outgoing calls, including retries;
coalesced callers add no outgoing calls of their own. Existing failure logs keep
fixed stage/status/category labels. Logs contain no mailbox/user/message IDs,
URLs, tokens, credentials, provider payloads, bodies or file contents.

Gmail authorization remains exactly
`https://www.googleapis.com/auth/gmail.readonly`; all Gmail resource operations
remain GETs. No Gmail write, send, trash, modify or draft permission is added.


### Regression verification

Verified with Node 22: 140 Support unit tests across 16 files, all 15 Support
Gmail browser scenarios (including focused reruns), repository lint, typecheck,
and `git diff --check`. The new regression suite covers targeted and repeated
Ignore, concurrent actors, duplicate coalescing, TTL/copy isolation, stale and
forged sources, local limits, provider classification, Retry-After/backoff,
independent replicas, connection changes, cross-bundle provider errors and the
unchanged read-only scope. Browser coverage also verifies PostgreSQL races,
creation/linking, optional file failures, recovery, and forged inbox sources.

The production build uses `npm run build -- --webpack` in this validation
environment. Default Turbopack cannot bind its CSS worker port here; Webpack
performs the production compilation, TypeScript check and static generation.
No application configuration or build script is changed for that fallback.
