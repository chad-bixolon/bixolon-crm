export const OUTBOUND_EMAIL_SUMMARY_MAX = 2000;
export type OutboundEmailState = { message?: string; errors?: Record<string, string>; success?: boolean };
export type OutboundEmailPrefill = {
  caseNumber: string; accountName: string | null; contactName: string | null;
  recipientName: string; recipientEmail: string; subject: string;
};
