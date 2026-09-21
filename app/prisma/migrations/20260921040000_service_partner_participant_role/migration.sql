-- Add a distinct deal-specific Service Partner role. Existing assignments remain unchanged.
ALTER TYPE "OpportunityPartyRole" ADD VALUE IF NOT EXISTS 'SERVICE_PARTNER';
