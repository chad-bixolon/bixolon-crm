export const cleanupIssues = {
  missingOwner: 'Missing salesperson', missingAccount: 'Missing Customer / Distributor', missingVar: 'Missing VAR', missingEndUser: 'Missing End User', sourceAccountMismatch: 'Source differs from linked Account', suspiciousSku: 'Suspicious SKU mapping', inactiveAccount: 'Inactive / archived Account',
  expired: 'Expired', activePastExpiration: 'Active past expiration', archived: 'Archived', incompleteCustomer: 'Incomplete customer information',
  missingSku: 'Unlinked product / SKU', legacyUnassigned: 'Legacy / unassigned', possibleDuplicate: 'Possible duplicate PE number',
  inconsistentStatus: 'Inconsistent status / dates',
} as const;
export type CleanupIssue = keyof typeof cleanupIssues;
export const cleanupIssueKeys = Object.keys(cleanupIssues) as CleanupIssue[];
export type CleanupAction = 'assignOwner' | 'linkDistributor' | 'linkVar' | 'linkEndUser' | 'expire' | 'archive';
export type CleanupRequest = { ids: number[]; action: CleanupAction; targetId?: number };
