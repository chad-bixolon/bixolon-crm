-- Allow internal, strategic, and cross-account Projects to exist without a
-- Primary Account. Existing values and the foreign key for non-null values are
-- unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "Project" ALTER COLUMN "primaryAccountId" DROP NOT NULL;

COMMIT;
