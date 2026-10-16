CREATE TABLE "AdminMaintenanceEvent" (
  id SERIAL PRIMARY KEY,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" INTEGER NOT NULL,
  "entityType" VARCHAR(40) NOT NULL,
  action VARCHAR(40) NOT NULL,
  "recordIds" INTEGER[] NOT NULL,
  "recordCount" INTEGER NOT NULL CHECK ("recordCount" > 0)
);
CREATE INDEX "AdminMaintenanceEvent_occurredAt_id_idx" ON "AdminMaintenanceEvent" ("occurredAt" DESC, id DESC);
CREATE INDEX "AdminMaintenanceEvent_actorId_occurredAt_idx" ON "AdminMaintenanceEvent" ("actorId", "occurredAt");
CREATE FUNCTION reject_admin_maintenance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Maintenance history is append-only'; END;
$$;
CREATE TRIGGER admin_maintenance_immutable BEFORE UPDATE OR DELETE ON "AdminMaintenanceEvent"
FOR EACH STATEMENT EXECUTE FUNCTION reject_admin_maintenance_mutation();
CREATE TRIGGER admin_maintenance_no_truncate BEFORE TRUNCATE ON "AdminMaintenanceEvent"
FOR EACH STATEMENT EXECUTE FUNCTION reject_admin_maintenance_mutation();
