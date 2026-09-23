-- Opportunity contacts are optional so all historical Opportunities remain valid.
CREATE TABLE "OpportunityContact" (
    "opportunityId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpportunityContact_pkey" PRIMARY KEY ("opportunityId", "contactId")
);

CREATE INDEX "OpportunityContact_contactId_opportunityId_idx"
    ON "OpportunityContact"("contactId", "opportunityId");

-- PostgreSQL partial uniqueness safely enforces one optional primary Contact.
CREATE UNIQUE INDEX "OpportunityContact_one_primary_per_opportunity"
    ON "OpportunityContact"("opportunityId") WHERE "isPrimary" = true;

-- The lead-side foreign key is the authoritative Trade Show attribution.
-- Uniqueness also prevents one Opportunity being attributed to conflicting leads.
CREATE UNIQUE INDEX "TradeShowLead_convertedOpportunityId_key"
    ON "TradeShowLead"("convertedOpportunityId");

ALTER TABLE "OpportunityContact" ADD CONSTRAINT "OpportunityContact_opportunityId_fkey"
    FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OpportunityContact" ADD CONSTRAINT "OpportunityContact_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
