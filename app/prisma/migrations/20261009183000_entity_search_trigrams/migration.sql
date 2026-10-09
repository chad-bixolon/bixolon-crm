CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Picker predicates use case-insensitive contains/prefix search. Existing
-- case-sensitive btree name indexes do not accelerate those ILIKE predicates.
CREATE INDEX "Account_name_trgm_idx" ON "Account" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Contact_firstName_trgm_idx" ON "Contact" USING GIN ("firstName" gin_trgm_ops);
CREATE INDEX "Contact_lastName_trgm_idx" ON "Contact" USING GIN ("lastName" gin_trgm_ops);
CREATE INDEX "Contact_email_trgm_idx" ON "Contact" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "Opportunity_name_trgm_idx" ON "Opportunity" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Project_name_trgm_idx" ON "Project" USING GIN ("name" gin_trgm_ops);
