-- Additive classifications; existing Account and Opportunity role assignments are untouched.
ALTER TYPE "AccountBusinessRoleCode" ADD VALUE IF NOT EXISTS 'MEDIA_PARTNER';
ALTER TYPE "OpportunityPartyRole" ADD VALUE IF NOT EXISTS 'MEDIA_PARTNER';
