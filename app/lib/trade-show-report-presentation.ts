// Presentation only: keys remain compatible with saved report configurations.
export const tradeShowMetricGroups = {
  'Lead Activity': ['totalLeads', 'routedLeads', 'unreviewedLeads', 'newLeads', 'contactedLeads', 'qualifiedLeads', 'convertedLeads', 'disqualifiedLeads', 'conversionRate'],
  Routing: ['bixolonSalesLeads', 'partnerReferredLeads', 'marketingFollowUpLeads', 'referralRate'],
  'Sales Outcomes': ['opportunityCount', 'pipeline', 'weightedPipeline', 'closedWonValue', 'closedWonOpportunityCount'],
  'Additional Metrics': ['assignedLeads', 'commit'],
};

export const tradeShowColumnGroups = {
  'Lead Details': ['tradeShow', 'lead', 'company', 'assignedRep', 'leadStatus', 'routing', 'referralPartner', 'account', 'contact'],
  'Follow-Up and Interests': ['capturedDate', 'followUp', 'competitor', 'competitorSourceText', 'productInterest'],
  'Sales Outcomes': ['opportunity', 'opportunityOwner', 'opportunityStage', 'opportunityValue', 'weightedValue', 'conversionDate', 'currency'],
};

export const tradeShowRoutingSummary = ['totalLeads', 'routedLeads', 'unreviewedLeads', 'bixolonSalesLeads', 'partnerReferredLeads', 'marketingFollowUpLeads'];

export const tradeShowMetricLabels: Record<string, string> = {
  totalLeads: 'Total Leads', routedLeads: 'Routed Leads', assignedLeads: 'Leads with Sales Rep',
  unreviewedLeads: 'Unreviewed Leads', bixolonSalesLeads: 'BIXOLON Sales',
  partnerReferredLeads: 'Partner Referrals', marketingFollowUpLeads: 'Marketing Follow-Up',
  referralRate: 'Referral Rate', newLeads: 'New', contactedLeads: 'Contacted',
  qualifiedLeads: 'Qualified', convertedLeads: 'Converted', disqualifiedLeads: 'Disqualified',
  conversionRate: 'Conversion Rate', opportunityCount: 'Opportunities Created', pipeline: 'Open Pipeline',
  weightedPipeline: 'Weighted Pipeline', commit: 'Commit', closedWonValue: 'Closed Won Value',
  closedWonOpportunityCount: 'Closed Won Opportunities',
};

export const tradeShowColumnLabels: Record<string, string> = {
  tradeShow: 'Trade Show', lead: 'Lead', company: 'Company', assignedRep: 'Assigned Sales Rep',
  leadStatus: 'Lead Status', routing: 'Routing', referralPartner: 'Partner', account: 'Account',
  contact: 'Contact', capturedDate: 'Lead Captured Date', followUp: 'Follow-Up', competitor: 'Competitor',
  competitorSourceText: 'Competitor Detail', productInterest: 'Product Interest', opportunity: 'Opportunity',
  opportunityOwner: 'Opportunity Owner', opportunityStage: 'Opportunity Stage', opportunityValue: 'Pipeline Value',
  weightedValue: 'Weighted Pipeline', conversionDate: 'Conversion Date', currency: 'Currency',
};
