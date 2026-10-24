# Internal Email Domains v1

Internal Email Domains identify the company's own email domains for business-context classification in Calendar Matches, My Day, and Support Inbox. They do not control sign-in, assign roles, grant module access, change ownership eligibility, or create Contacts. Trusted Sign-In Domains independently control which verified corporate Google domains may authenticate for an approved active SalesHub User.

The Admin page is **Administration → Internal Email Domains**. Only a true Admin with `deployment.manage` can read or change it. The page shows active and inactive domains, allows add/deactivate/reactivate, explains sign-in independence, and links to Trusted Sign-In Domains. Each effective change writes a safe old/new entry to Admin Maintenance History in the same serialized transaction. No message content or credentials enter that history.

Domain input is trimmed, lowercased, and validated as a DNS-style domain. Email addresses, protocols, paths, wildcard entries, malformed labels, and IP addresses are rejected. Classification compares the normalized email domain exactly against one compact in-memory Set. `user@acme.com` matches `acme.com`; `user@eu.acme.com` does not. The local part and display name do not participate, so Korean and other Unicode names remain unchanged. Calendar still recognizes its owner and self attendee independently of domain membership.

## Bootstrap and migration

The additive `20261023180000_internal_email_domains_v1` migration creates the typed table, lowercase database check, updater index, and nullable `User` relation with `ON DELETE SET NULL`. It does not modify authentication tables or seed BIXOLON domains. While there are no persisted rows, a visible bootstrap list is deduplicated from valid `GOOGLE_WORKSPACE_DOMAIN` and active Trusted Sign-In Domain rows. The first successful Admin mutation materializes those domains and applies the requested change in one transaction. Once any Internal Email Domain row exists, persisted rows alone are authoritative, including when all are inactive. Later trusted-domain or environment changes cannot silently change that list.

Zero active domains are allowed. In that state, no email domain matches as internal; Calendar's existing owner/self exceptions remain. The Admin page warns about the classification effect. There is no authentication lockout safeguard on this list.

Read the active list once per request or Calendar evaluation batch. Do not query per attendee or Support message, and do not use a long-lived cache that delays Admin changes. Existing confirmed Calendar review choices and logged Activities retain their current review workflow. Support uses the policy for the sender badge and original-request selection; Gmail scope, mailbox identity, message linking, and exact-email Contact suggestions stay unchanged.

For a generic deployment, Trusted Sign-In Domains can contain `acme.com` and `parentcompany.com` while Internal Email Domains contains only `acme.com`. Approved users of either trusted domain may authenticate, but `parentcompany.com` is external business activity. For BIXOLON, `bixolonusa.com` and `bixolon.com` can be active in both lists so both classify as internal; roles remain independent.

Rollback to prior application code restores its older business classification behavior while leaving the additive table unused. Dropping the table would lose Admin choices; export them first if a destructive rollback is ever required. The Admin Maintenance History entries remain separate from the table.
