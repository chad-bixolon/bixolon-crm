# Accounts & Contacts CSV or XLSX import

Administration → Imports → Accounts & Contacts accepts UTF-8 CSV (maximum 2 MB) or `.xlsx` (maximum 4 MB compressed). Download the CSV header template from the page; the same header row can be pasted into the first row of an XLSX worksheet. Either format may contain Account and Contact rows together. Put Account rows first for easiest review; the planner resolves all Account rows before Contact rows regardless of file order.

Headers (use only those needed):

```csv
record_type,account_name,account_status,website,phone,owner_email,territory_code,industry_code,business_roles,strategic_account,address_line_1,address_line_2,city,state_province,postal_code,country,contact_first_name,contact_last_name,contact_title,contact_email,contact_phone,contact_mobile,contact_account_name,contact_active,contact_primary
```

`record_type` is `account` or `contact`. Account rows require `account_name`. Contact rows require `contact_first_name` and `contact_last_name`. `contact_account_name` maps a Contact to an existing or imported Account by normalized exact name; leave it blank for an unassigned Contact. When it is blank, `account_name` can also supply the Contact's Account. Owner uses an active CRM user's email. Territory and Industry use active codes. Business roles use internal values (`END_USER|DISTRIBUTOR|VAR|ISV|OEM|PARTNER`) joined with `|`. Boolean values accept `true`, `false`, `yes`, `no`, `1`, or `0`. Account status accepts `ACTIVE` or `INACTIVE`. Empty cells preserve existing values.

Account matching checks normalized exact name and normalized website host. If those identify different Accounts, the row is an error. Contact matching uses normalized email. Ambiguous matches and duplicate rows block confirmation. A Primary Contact change is shown as a warning and needs confirmation. Confirmation reruns the plan inside a serializable transaction and rejects a changed preview. An error rolls back all writes.

XLSX imports use one worksheet. If more than one worksheet has values, the Admin must choose which sheet to preview and confirm; worksheets are never combined. The limit is 5,000 data rows and 50 columns in the selected worksheet, 10,000 rows across the workbook, 100 ZIP entries, and 20 MB of verified uncompressed workbook content. Password-encrypted and malformed workbooks are rejected. Formatting is ignored. Formula cells use only their cached evaluated value; formulas are never calculated by the CRM. Numbers are read as decimal strings to avoid JavaScript rounding. Keep phone numbers and postal codes formatted as text in Excel if leading zeros matter. Date cells become ISO `YYYY-MM-DD` strings; the current import fields contain no date columns.

## Proposed source key migration (not applied)

Account and Contact currently have no source ID. A future schema migration can add a pair of nullable source fields to each model. The source system is required with a source ID so different pilots cannot collide.

Proposed Prisma schema diff:

```diff
 model Account {
   id                     Int                   @id @default(autoincrement())
+  sourceSystem           String?
+  sourceId               String?
   name                   String
@@
   @@index([archivedById])
+  @@unique([sourceSystem, sourceId])
 }
@@
 model Contact {
   id           Int       @id @default(autoincrement())
+  sourceSystem String?
+  sourceId     String?
   accountId    Int?
@@
   @@index([archivedById])
+  @@unique([sourceSystem, sourceId])
 }
```

Proposed forward-only migration SQL:

```sql
ALTER TABLE "Account" ADD COLUMN "sourceSystem" TEXT, ADD COLUMN "sourceId" TEXT;
ALTER TABLE "Contact" ADD COLUMN "sourceSystem" TEXT, ADD COLUMN "sourceId" TEXT;
ALTER TABLE "Account" ADD CONSTRAINT "Account_source_pair_check" CHECK (("sourceSystem" IS NULL) = ("sourceId" IS NULL));
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_source_pair_check" CHECK (("sourceSystem" IS NULL) = ("sourceId" IS NULL));
CREATE UNIQUE INDEX "Account_sourceSystem_sourceId_key" ON "Account"("sourceSystem", "sourceId");
CREATE UNIQUE INDEX "Contact_sourceSystem_sourceId_key" ON "Contact"("sourceSystem", "sourceId");
```

All existing rows receive null values in both new columns. No existing data is rewritten, deleted, or matched differently until the import code is updated to use these keys. The proposed migration has not been created or deployed.

Import history is deferred; it would also require a schema change.
