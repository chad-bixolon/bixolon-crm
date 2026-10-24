-- Existing users retain the light appearance they had before this feature.
-- The final default applies only to users created after this migration.
BEGIN;
CREATE TYPE "AppearancePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');
ALTER TABLE "User" ADD COLUMN "appearancePreference" "AppearancePreference" NOT NULL DEFAULT 'LIGHT';
ALTER TABLE "User" ALTER COLUMN "appearancePreference" SET DEFAULT 'SYSTEM';
COMMIT;
