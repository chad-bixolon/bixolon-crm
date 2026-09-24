# Document attachments V1

SalesHub stores attachment metadata and its Account, Project, or Opportunity foreign key in PostgreSQL. File contents are stored only in the private DigitalOcean Space. Object keys use `<SPACES_PREFIX>/documents/<UUID>` and never include the original filename or CRM/customer names. Signed download URLs expire after five minutes and are never persisted.

## Configuration

Set these only as runtime environment variables: `SPACES_BUCKET`, `SPACES_REGION`, `SPACES_ENDPOINT`, `SPACES_ACCESS_KEY_ID`, `SPACES_SECRET_ACCESS_KEY`, and `SPACES_PREFIX`. Local development uses `SPACES_PREFIX=dev`; production uses `SPACES_PREFIX=prod`. Missing or invalid values affect document operations without initializing storage on unrelated pages. Never make the Space public or enable its CDN.

Supported uploads are PDF, DOC, DOCX, XLS, XLSX, PPT, and PPTX, up to 25 MB. The server checks extension, MIME, and file signature. Legacy DOC/XLS/PPT all use the same OLE Compound File signature, so V1 can verify that they are genuine OLE containers but cannot reliably distinguish the three legacy formats from one another without parsing their internal streams. Modern Office formats and PDF receive format-specific magic-byte/container detection. Antivirus scanning is intentionally deferred; the storage boundary allows a scanning stage to be inserted before metadata persistence.

To safely verify development storage from the running app container:

```sh
docker compose exec -T app npm run storage:check
```

The check refuses any prefix except `dev`, writes a generated tiny object below `dev/documents/`, verifies it, deletes it, and verifies cleanup. It does not print credentials or signed URLs.

## Local manual acceptance

Account:

1. Open an Account and select Documents.
2. Upload a small PDF as Contract and confirm it appears.
3. Open/download it.
4. Archive it and confirm it disappears from Active.
5. Select Archived and confirm the archive date and user appear.

Project:

1. Open a Project, select Documents, and upload a Statement of Work.
2. Confirm it appears only on the correct Project.
3. Open/download it.

Opportunity:

1. Open an Opportunity and upload a Quote, then a Proposal.
2. Confirm both appear and the Proposal is first (newest-first).
3. Open/download both.

Security and validation:

1. Confirm READ_ONLY can view/download a document on an allowed parent but sees no upload/archive action.
2. Confirm an unauthorized parent cannot retrieve a document by changing the document ID in the download URL.
3. Confirm an executable/script and a renamed or MIME-mismatched file are rejected.
4. Confirm a file over 25 MB is rejected and a supported business document is accepted.
5. Confirm a localhost-created object is below `dev/documents/`, never `prod/documents/`.

## Eventual production sequence

1. After review, commit and push the change.
2. Trigger the DigitalOcean App Platform deployment.
3. Run `npm run db:deploy` once from the DigitalOcean console/release process.
4. Verify all six Spaces environment variable names are configured as encrypted runtime values and `SPACES_PREFIX=prod`.
5. Smoke test with a harmless PDF on an authorized CRM record.
6. Confirm the resulting object is below `prod/documents/` and remains private.

Do not store secret values in source control, build arguments, deployment notes, or logs.
