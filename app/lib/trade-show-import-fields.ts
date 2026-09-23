export const MAPPING_DESTINATIONS = [
  ['firstName','First Name'],['lastName','Last Name'],['title','Title'],['sourceCompany','Company'],['email','Email'],['phone','Phone'],
  ['sourceCompanyWebsite','Company Website'],['addressLine1','Address Line 1'],['addressLine2','Address Line 2'],['city','City'],
  ['stateProvince','State / Province'],['postalCode','Postal Code'],['country','Country'],['capturedAt','Captured Date / Time'],
  ['sourceNotes','Source Notes'],['productInterest','Product Interest'],['competitorSourceText','Competitor Mentioned'],
  ['currentProductBeingUsed','Current Product Being Used'],['customerPainPoints','Customer Pain Points'],['sourceLeadId','Source Lead / Scan ID'],
] as const;
export type MappingDestination = typeof MAPPING_DESTINATIONS[number][0];
export type MappingDefinition = { version: 1; columns: { sourceHeader: string; destination: MappingDestination | null }[] };

export const REVIEWABLE_LEAD_FIELDS = [
  ['firstName','First Name'],['lastName','Last Name'],['title','Title'],['sourceCompany','Company'],['email','Email'],['phone','Phone'],
  ['sourceCompanyWebsite','Company Website'],['addressLine1','Address Line 1'],['addressLine2','Address Line 2'],['city','City'],
  ['stateProvince','State / Province'],['postalCode','Postal Code'],['country','Country'],['productInterest','Product Interest'],
  ['sourceNotes','Source Notes'],['competitorSourceText','Competitor Mentioned'],['currentProductBeingUsed','Current Product Being Used'],
  ['customerPainPoints','Customer Pain Points'],
] as const;
export type ReviewableLeadField = typeof REVIEWABLE_LEAD_FIELDS[number][0];
export type ReviewedOverrides = Partial<Record<ReviewableLeadField,string>>;
