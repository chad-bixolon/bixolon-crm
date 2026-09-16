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


def prisma(database, *args):
    url = f"postgresql://postgres@{DB}:5432/{database}"
    result = run(["docker", "run", "--rm", "--network", NETWORK, "-e", f"DATABASE_URL={url}", IMAGE,
                  "./node_modules/.bin/prisma", *args])
    return result.stdout


def create_database(name):
    assert name in {"fresh", "upgrade", "compatibility", "bad_role", "bad_price", "bad_parent", "bad_stage"}
    sql("postgres", f'CREATE DATABASE "{name}";')


initial = (ROOT / "prisma/migrations" / INITIAL / "migration.sql").read_text()
forward = (ROOT / "prisma/migrations" / FORWARD / "migration.sql").read_text()
fixture = (ROOT / "prisma/tests/legacy-fixture.sql").read_text()
assert hashlib.sha256(initial.encode()).hexdigest() == "33f9a5f4ece57a83789738d3289f3d30917af01d750ef13d63c3badece658b29"
assert "DROP COLUMN" not in forward and "DROP TABLE" not in forward and "TRUNCATE" not in forward
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
    client = run(["docker", "run", "--rm", "-i", "--network", NETWORK,
                  "-e", f"DATABASE_URL=postgresql://postgres@{DB}:5432/upgrade", IMAGE,
                  "node", "--input-type=module"],
                 (ROOT / "prisma/tests/client-smoke.mjs").read_text())
    print(client.stdout, flush=True)
    print(prisma("upgrade", "migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma",
                 "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"), flush=True)
    print(prisma("upgrade", "migrate", "deploy"), flush=True)
    print("PASS: populated upgrade, preservation, integrity, parity, and repeat deployment", flush=True)

    create_database("compatibility")
    sql("compatibility", initial)
    for revised in (False, True):
        if revised:
            prisma("compatibility", "migrate", "resolve", "--applied", INITIAL)
            prisma("compatibility", "migrate", "deploy")
        result = run(["docker", "run", "--rm", "-i", "--network", NETWORK,
                      "-v", f"{ROOT / 'lib/accounts.ts'}:/app/lib/accounts.ts:ro",
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
