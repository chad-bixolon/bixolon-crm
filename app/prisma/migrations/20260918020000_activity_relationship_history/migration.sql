-- Activity keeps its Account and Opportunity foreign keys, while participant
-- membership is checked when a relationship is selected or changed.
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_opportunityId_accountId_fkey";
