#!/usr/bin/env python3
"""Replays migrations on synthetic data in isolated, ephemeral PostgreSQL 17.

Never reads DATABASE_URL or .env. Requires the locally built test image and Docker.
Creates no published ports or persistent volumes; removes only its own test resources.
"""
from pathlib import Path
import hashlib
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "bixolon-crm-foundation-test:local"
INITIAL = "20260916005259_initial_crm"
FORWARD = "20260916020000_crm_foundation"
OPTIONAL_PROJECT_ACCOUNT = "20260920090000_optional_project_primary_account"
PREFIX = "bixolon-foundation-test-" + uuid.uuid4().hex[:10]
NETWORK = PREFIX
DB = PREFIX + "-db"


def run(args, source=None, check=True):
    result = subprocess.run(args, input=source, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(f"Command failed: {' '.join(args)}\n{result.stdout}\n{result.stderr}")
    return result


def sql(database, source, check=True):
    return run(["docker", "exec", "-i", DB, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], source, check)


def sql_values(database, statement):
    return run(["docker", "exec", DB, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-c", statement]).stdout.strip().splitlines()


def prisma(database, *args):
    url = f"postgresql://postgres@{DB}:5432/{database}"
    result = run(["docker", "run", "--rm", "--network", NETWORK, "-e", f"DATABASE_URL={url}", IMAGE,
                  "./node_modules/.bin/prisma", *args])
    return result.stdout


def create_database(name):
    assert name in {"fresh", "upgrade", "compatibility", "backfill", "bad_role", "bad_price", "bad_parent", "bad_stage"}
    for attempt in range(30):
        result = sql("postgres", f'CREATE DATABASE "{name}";', check=False)
        if result.returncode == 0:
            return
        if "connection to server" not in result.stderr:
            raise RuntimeError(f"Could not create disposable database {name}: {result.stderr}")
        time.sleep(0.5)
    raise RuntimeError(f"Disposable PostgreSQL did not accept CREATE DATABASE {name}")


def preserved_fingerprints(database, legacy_opportunity):
    tables = ("Account", "Contact", "Opportunity", "OpportunityAccount", "OpportunityAccountRole",
              "Project", "ProjectAccount", "ProjectAccountRole", "Activity", "ActivityContact",
              "Task", "OpportunityProduct", "Note", "Product", "ProductSku", "ProductPrice")
    result = {}
    for table in tables:
        row = "to_jsonb(t) - 'projectId'" if table == "Opportunity" and legacy_opportunity else "to_jsonb(t)"
        statement = f'''SELECT count(*) || ':' || md5(COALESCE(jsonb_agg({row} ORDER BY ({row})::text)::text, '[]')) FROM "{table}" t;'''
        result[table] = sql(database, statement).stdout.strip()
    return result


def all_table_fingerprints(database):
    tables = sql_values(database, "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename;")
    return {table: sql_values(database, f'''SELECT count(*) || ':' || md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text, '[]')) FROM "{table}" t;''')[0] for table in tables}


def foreign_keys(database):
    return set(sql_values(database, "SELECT conrelid::regclass::text || '.' || conname || ': ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace ORDER BY 1;"))


initial = (ROOT / "prisma/migrations" / INITIAL / "migration.sql").read_text()
forward = (ROOT / "prisma/migrations" / FORWARD / "migration.sql").read_text()
optional_project_account = (ROOT / "prisma/migrations" / OPTIONAL_PROJECT_ACCOUNT / "migration.sql").read_text()
fixture = (ROOT / "prisma/tests/legacy-fixture.sql").read_text()
assert hashlib.sha256(initial.encode()).hexdigest() == "33f9a5f4ece57a83789738d3289f3d30917af01d750ef13d63c3badece658b29"
assert "DROP COLUMN" not in forward and "DROP TABLE" not in forward and "TRUNCATE" not in forward
assert 'ALTER TABLE "Project" ALTER COLUMN "primaryAccountId" DROP NOT NULL' in optional_project_account
assert all(token not in optional_project_account.upper() for token in ("DELETE FROM", "UPDATE ", "INSERT INTO", "TRUNCATE", "DROP COLUMN", "DROP TABLE"))
network_created = db_created = False
try:
    run(["docker", "network", "create", "--internal", NETWORK])
    network_created = True
    run(["docker", "run", "-d", "--name", DB, "--network", NETWORK,
         "--label", "bixolon.disposable-migration-test=true",
         "--tmpfs", "/var/lib/postgresql/data:rw", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"])
    db_created = True
    for attempt in range(60):
        if run(["docker", "exec", DB, "pg_isready", "-U", "postgres"], check=False).returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError("Disposable PostgreSQL did not become ready")
    print("PASS: isolated PostgreSQL 17, internal network, tmpfs storage, no published ports", flush=True)

    create_database("fresh")
    print(prisma("fresh", "migrate", "deploy"), flush=True)
    print(prisma("fresh", "migrate", "status"), flush=True)
    print(prisma("fresh", "migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma",
                 "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"), flush=True)
    print("PASS: empty database replay and schema parity", flush=True)

    create_database("upgrade")
    sql("upgrade", initial)
    sql("upgrade", fixture)
    # Test database only: simulate the existing installation's already-applied initial migration.
    prisma("upgrade", "migrate", "resolve", "--applied", INITIAL)
    print(prisma("upgrade", "migrate", "deploy"), flush=True)
    print(sql("upgrade", (ROOT / "prisma/tests/verify-preservation.sql").read_text()).stdout, flush=True)
    print(sql("upgrade", (ROOT / "prisma/tests/integrity.sql").read_text()).stdout, flush=True)
    print(sql("upgrade", '''DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM "Project") OR EXISTS (SELECT 1 FROM "ProjectAccount") OR
         EXISTS (SELECT 1 FROM "ProjectAccountRole") OR
         EXISTS (SELECT 1 FROM "OpportunityProject") OR
         EXISTS (SELECT 1 FROM "Task" WHERE "projectId" IS NOT NULL) OR
         EXISTS (SELECT 1 FROM "Activity" WHERE "projectId" IS NOT NULL) OR
         EXISTS (SELECT 1 FROM "Note" WHERE "projectId" IS NOT NULL) THEN
        RAISE EXCEPTION 'Project migration changed legacy rows';
      END IF;
    END $$;
    INSERT INTO "Account" ("id", "name", "updatedAt") VALUES (1003, 'Additional participant', CURRENT_TIMESTAMP);
    INSERT INTO "Project" ("id", "name", "primaryAccountId", "primaryAccountRole", "createdById", "updatedAt")
      VALUES (1000, 'Fixture project', 100, 'PROGRAM_OWNER', 100, CURRENT_TIMESTAMP);
    INSERT INTO "ProjectAccount" ("projectId", "accountId", "updatedAt") VALUES (1000, 1003, CURRENT_TIMESTAMP);
    INSERT INTO "ProjectAccountRole" ("projectId", "accountId", "role", "updatedAt") VALUES
      (1000, 1003, 'SERVICE_PROVIDER', CURRENT_TIMESTAMP),
      (1000, 1003, 'CONNECTIVITY_PROVIDER', CURRENT_TIMESTAMP);
    INSERT INTO "OpportunityProject" ("opportunityId", "projectId") VALUES (100, 1000);
    INSERT INTO "Activity" ("id", "projectId", "type", "subject", "updatedAt")
      VALUES (1000, 1000, 'OTHER', 'Project update', CURRENT_TIMESTAMP);
    INSERT INTO "Note" ("id", "projectId", "body", "updatedAt")
      VALUES (1000, 1000, 'Project note', CURRENT_TIMESTAMP);
    SELECT count(*) AS project_roles FROM "ProjectAccountRole" WHERE "projectId" = 1000;''').stdout, flush=True)
    rejected = {
        "duplicate participant": '''INSERT INTO "ProjectAccount" ("projectId", "accountId", "updatedAt") VALUES (1000, 1003, CURRENT_TIMESTAMP);''',
        "duplicate role": '''INSERT INTO "ProjectAccountRole" ("projectId", "accountId", "role", "updatedAt") VALUES (1000, 1003, 'SERVICE_PROVIDER', CURRENT_TIMESTAMP);''',
        "primary account as participant": '''INSERT INTO "ProjectAccount" ("projectId", "accountId", "updatedAt") VALUES (1000, 100, CURRENT_TIMESTAMP);''',
        "primary account changed to participant": '''UPDATE "Project" SET "primaryAccountId" = 1003 WHERE "id" = 1000;''',
        "delete participating account": '''DELETE FROM "Account" WHERE "id" = 1003;''',
        "reversed project dates": '''UPDATE "Project" SET "startDate" = '2026-09-17', "targetEndDate" = '2026-09-16' WHERE "id" = 1000;''',
    }
    for label, statement in rejected.items():
        if sql("upgrade", statement, check=False).returncode == 0:
            raise RuntimeError(f"{label}: invalid change unexpectedly succeeded")
        print(f"PASS: {label} rejected", flush=True)
    print(sql("upgrade", '''DELETE FROM "ProjectAccountRole" WHERE "projectId" = 1000 AND "accountId" = 1003;
      DELETE FROM "ProjectAccount" WHERE "projectId" = 1000 AND "accountId" = 1003;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM "Account" WHERE "id" = 1003) THEN
          RAISE EXCEPTION 'Removing participant deleted Account';
        END IF;
      END $$;''').stdout, flush=True)
    print("PASS: Project constraints, links, parent checks, and Account preservation", flush=True)
    client = run(["docker", "run", "--rm", "-i", "--network", NETWORK,
                  "-e", f"DATABASE_URL=postgresql://postgres@{DB}:5432/upgrade", IMAGE,
                  "node", "--input-type=module"],
                 (ROOT / "prisma/tests/client-smoke.mjs").read_text())
    print(client.stdout, flush=True)
    print(prisma("upgrade", "migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma",
                 "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"), flush=True)
    print(prisma("upgrade", "migrate", "deploy"), flush=True)
    print("PASS: populated upgrade, preservation, integrity, parity, and repeat deployment", flush=True)

    # Exercise the new migration on a populated legacy link in a disposable database.
    create_database("backfill")
    sql("backfill", initial)
    sql("backfill", fixture)
    migration_root = ROOT / "prisma/migrations"
    for directory in sorted(migration_root.iterdir()):
        if directory.is_dir() and INITIAL < directory.name < "20260918010000_opportunity_projects":
            sql("backfill", (directory / "migration.sql").read_text())
    sql("backfill", '''INSERT INTO "Project" ("id", "name", "primaryAccountId", "primaryAccountRole", "createdById", "updatedAt")
      VALUES (1000, 'Legacy linked Project', 100, 'PROGRAM_OWNER', 100, CURRENT_TIMESTAMP);
      INSERT INTO "Opportunity" ("id", "stageId", "name", "updatedAt")
        SELECT 101, "stageId", 'Second linked Opportunity', CURRENT_TIMESTAMP FROM "Opportunity" WHERE "id" = 100;
      INSERT INTO "Opportunity" ("id", "stageId", "name", "updatedAt")
        SELECT 102, "stageId", 'Unlinked Opportunity', CURRENT_TIMESTAMP FROM "Opportunity" WHERE "id" = 100;
      UPDATE "Opportunity" SET "projectId" = 1000 WHERE "id" IN (100, 101);''')
    expected_links = sql("backfill", '''SELECT "id" || ':' || "projectId" FROM "Opportunity" WHERE "projectId" IS NOT NULL ORDER BY "id", "projectId";''').stdout.strip().splitlines()
    null_opportunities = sql("backfill", '''SELECT "id" FROM "Opportunity" WHERE "projectId" IS NULL ORDER BY "id";''').stdout.strip().splitlines()
    before = preserved_fingerprints("backfill", True)
    sql("backfill", (migration_root / "20260918010000_opportunity_projects/migration.sql").read_text())
    after = preserved_fingerprints("backfill", False)
    if before != after:
        raise RuntimeError(f"OpportunityProject migration changed row count or fingerprint in {[table for table in before if before[table] != after[table]]}")
    actual_links = sql("backfill", '''SELECT "opportunityId" || ':' || "projectId" FROM "OpportunityProject" ORDER BY "opportunityId", "projectId";''').stdout.strip().splitlines()
    if expected_links != actual_links:
        raise RuntimeError("Legacy Opportunity Project pairs were not backfilled exactly once")
    if any(link.split(':', 1)[0] in null_opportunities for link in actual_links):
        raise RuntimeError("A previously unlinked Opportunity acquired a Project link")
    if len(actual_links) != len(set(actual_links)):
        raise RuntimeError("Duplicate Opportunity Project pair exists")
    if sql("backfill", '''INSERT INTO "OpportunityProject" ("opportunityId", "projectId") VALUES (100, 1000);''', check=False).returncode == 0:
        raise RuntimeError("Duplicate Opportunity Project link unexpectedly succeeded")
    print(f"PASS: {len(expected_links)} legacy links backfilled exactly; {len(null_opportunities)} unlinked Opportunities remain unlinked; {len(before)} table counts and fingerprints preserved; duplicate rejected", flush=True)

    # Stage 3: capture every public data table and FK immediately before its migration.
    sql("backfill", '''INSERT INTO "OpportunityAccount" ("opportunityId","accountId","updatedAt") VALUES (100,102,now());
      INSERT INTO "Activity" (id,"accountId","opportunityId",type,subject,"updatedAt")
        SELECT 102,102,100,type,'Historical participant',now() FROM "Activity" WHERE id=100;''')
    stage3_before = all_table_fingerprints("backfill")
    fk_before = foreign_keys("backfill")
    sql("backfill", (migration_root / "20260918020000_activity_relationship_history/migration.sql").read_text())
    stage3_after = all_table_fingerprints("backfill")
    fk_after = foreign_keys("backfill")
    if stage3_before != stage3_after:
        raise RuntimeError(f"Stage 3 changed data in {[table for table in stage3_before if stage3_before[table] != stage3_after.get(table)]}")
    removed = fk_before - fk_after
    if len(removed) != 1 or not next(iter(removed)).startswith('"Activity".Activity_opportunityId_accountId_fkey: FOREIGN KEY ("opportunityId", "accountId") REFERENCES "OpportunityAccount"') or fk_after - fk_before:
        raise RuntimeError(f"Stage 3 changed unexpected foreign keys: removed={removed}, added={fk_after - fk_before}")
    print(f"PASS: Stage 3 left {len(stage3_before)} public table row counts and fingerprints unchanged; removed only {next(iter(removed))}", flush=True)
    sql("backfill", '''DELETE FROM "OpportunityAccount" WHERE "opportunityId"=100 AND "accountId"=102;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM "Activity" a JOIN "Account" c ON c.id=a."accountId"
          JOIN "Opportunity" o ON o.id=a."opportunityId" WHERE a.id=102 AND a."accountId"=102
          AND a."opportunityId"=100 AND a.subject='Historical participant') THEN
          RAISE EXCEPTION 'Historical Activity was changed or unreadable after participant removal';
        END IF;
        IF EXISTS (SELECT 1 FROM "OpportunityAccount" WHERE "opportunityId"=100 AND "accountId"=102) THEN
          RAISE EXCEPTION 'Former participant remains';
        END IF;
      END $$;''')
    print("PASS: referenced Opportunity participant removed without deleting or rewriting historical Activity", flush=True)
    history_client = run(["docker", "run", "--rm", "-i", "--network", NETWORK,
                          "-e", f"DATABASE_URL=postgresql://postgres@{DB}:5432/backfill", IMAGE,
                          "node", "--input-type=module"],
                         (ROOT / "prisma/tests/activity-history-smoke.mjs").read_text())
    print(history_client.stdout, flush=True)
    for directory in sorted(migration_root.iterdir()):
        if directory.is_dir() and directory.name > "20260918020000_activity_relationship_history":
            if directory.name == OPTIONAL_PROJECT_ACCOUNT:
                optional_before = all_table_fingerprints("backfill")
                primary_before = sql_values("backfill", '''SELECT id || ':' || "primaryAccountId" FROM "Project" ORDER BY id;''')
                sql("backfill", (directory / "migration.sql").read_text())
                optional_after = all_table_fingerprints("backfill")
                primary_after = sql_values("backfill", '''SELECT id || ':' || "primaryAccountId" FROM "Project" ORDER BY id;''')
                if optional_before != optional_after:
                    raise RuntimeError(f"Optional Project Primary Account migration changed data in {[table for table in optional_before if optional_before[table] != optional_after.get(table)]}")
                if primary_before != primary_after:
                    raise RuntimeError("Existing Project primaryAccountId values changed")
                nullable = sql_values("backfill", '''SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='Project' AND column_name='primaryAccountId';''')
                fk = sql_values("backfill", '''SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='"Project"'::regclass AND conname='Project_primaryAccountId_fkey';''')
                if nullable != ["YES"] or len(fk) != 1 or 'ON UPDATE CASCADE ON DELETE RESTRICT' not in fk[0]:
                    raise RuntimeError(f"Optional Project Primary Account schema invalid: nullable={nullable}, fk={fk}")
                sql("backfill", '''INSERT INTO "Project" ("id","name","primaryAccountId","primaryAccountRole","createdById","updatedAt") VALUES (1001,'Account-less Project',NULL,'PROGRAM_OWNER',100,now());
                  INSERT INTO "ProjectAccount" ("projectId","accountId","updatedAt") VALUES (1001,101,now());
                  INSERT INTO "ProjectAccountRole" ("projectId","accountId","role","updatedAt") VALUES (1001,101,'ISV',now());
                  INSERT INTO "OpportunityProject" ("opportunityId","projectId") VALUES (102,1001);''')
                print(f"PASS: Optional Project Primary Account migration preserved {len(optional_before)} table fingerprints and {len(primary_before)} existing primaryAccountId values; nullable FK retained; account-less, participant-only, and Opportunity-linked Project accepted", flush=True)
            else:
                sql("backfill", (directory / "migration.sql").read_text())
    for directory in sorted(migration_root.iterdir()):
        if directory.is_dir() and directory.name >= INITIAL:
            prisma("backfill", "migrate", "resolve", "--applied", directory.name)
    print(prisma("backfill", "migrate", "status"), flush=True)
    print(prisma("backfill", "migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma",
                 "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"), flush=True)
    print("PASS: Stage 3 migration status and schema diff clean", flush=True)

    create_database("compatibility")
    sql("compatibility", initial)
    for revised in (False, True):
        if revised:
            prisma("compatibility", "migrate", "resolve", "--applied", INITIAL)
            prisma("compatibility", "migrate", "deploy")
        result = run(["docker", "run", "--rm", "-i", "--network", NETWORK,
                      "-v", f"{ROOT / 'prisma/tests/account-compatibility-service.ts'}:/app/lib/accounts.ts:ro",
                      "-e", f"DATABASE_URL=postgresql://postgres@{DB}:5432/compatibility", IMAGE,
                      "sh", "-c", "./node_modules/.bin/tsc lib/accounts.ts --target ES2020 --module commonjs --moduleResolution node --skipLibCheck --esModuleInterop --outDir .test-client && node --input-type=module"],
                     (ROOT / "prisma/tests/account-compatibility.mjs").read_text())
        print(result.stdout, flush=True)

    failures = {
        "bad_role": 'UPDATE "Account" SET "accountType"=\'STRATEGIC\' WHERE id=100;',
        "bad_price": 'UPDATE "OpportunityProduct" SET "unitPrice"=NULL WHERE id=100;',
        "bad_parent": 'UPDATE "Task" SET "accountId"=101 WHERE id=101;',
        "bad_stage": 'UPDATE "SalesStage" SET "isWon"=true WHERE id=100;',
    }
    for name, mutation in failures.items():
        create_database(name)
        sql(name, initial)
        sql(name, fixture)
        sql(name, mutation)
        result = sql(name, forward, check=False)
        if result.returncode == 0:
            raise RuntimeError(f"{name}: invalid data unexpectedly migrated")
        sql(name, '''DO $$ BEGIN
          IF to_regclass('public."AccountBusinessRole"') IS NOT NULL OR
             EXISTS (SELECT 1 FROM pg_type WHERE typname='UserRole') OR
             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Account' AND column_name='strategicAccount') OR
             (SELECT count(*) FROM "Account") <> 3 THEN
            RAISE EXCEPTION 'Failed migration did not roll back cleanly';
          END IF;
        END $$;''')
        print(f"PASS: {name} rejected and schema transaction rolled back", flush=True)
    print("ALL MIGRATION TESTS PASSED", flush=True)
finally:
    if db_created:
        run(["docker", "rm", "-f", DB])
    if network_created:
        run(["docker", "network", "rm", NETWORK])
    print("Disposable test database container and network removed.", flush=True)
