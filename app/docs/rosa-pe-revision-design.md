# Rosa PE source revision design (proposal only)

The current importer keeps one `PriceException` header per normalized PE Number and stores the original CSV rows and reviewed choices in that header and its lines. A changed submission is review-only. The schema has no immutable record for a second source submission and no way to retire old pricing lines from new selection while retaining their Opportunity references. Updating the header JSON or replacing lines would lose evidence or change historical links.

## Smallest additive schema change

1. Add `PriceExceptionSourceRevision` with an identity key, `priceExceptionId` foreign key, `contentHash` unique within the PE, `sourceFileName`, `sourceReviewedAt`, `rawRows` JSONB, `reviewedChoices` JSONB, `resolvedHeader` JSONB, `resolvedTiers` JSONB, `recordedById` foreign key, and `createdAt`. Rows are append-only. The content hash covers the exact source rows and reviewed resolution; it makes recording a repeat idempotent.
2. Add nullable `currentSourceRevisionId` to `PriceException`. Null means the original imported representation remains current. Retain its original `sourceMetadata` unchanged.
3. Add nullable `retiredAt` and `sourceRevisionId` to `PriceExceptionLine`, plus an index for active lines by PE. Existing lines remain the original revision. New revision line keys include the revision hash so the existing `(priceExceptionId, sourceLineKey)` uniqueness remains valid.

## Apply sequence after that migration

Preview still performs no writes. A changed PE stays **Needs review — Newer source revision available**. After resolving all source and CRM questions, an Admin can explicitly record the reviewed submission in `PriceExceptionSourceRevision`; this does not change the current PE or its prices. Re-recording the same hash is a no-op.

Promotion is a separate explicit Admin confirmation. In one serializable transaction, recheck the preview digest, current revision pointer, and active CRM references; retire the current PE lines, insert the reviewed revision's lines, update the current PE header fields and pointer, and retain the original header metadata and all prior line rows. New pricing searches and new Opportunity selections must filter to `retiredAt IS NULL`. Existing Opportunity line references and their price snapshots continue to reference retained historical lines. The PE detail view should show current lines by default and provide revision history from the append-only table.

No migration or promotion action is implemented by this proposal.
