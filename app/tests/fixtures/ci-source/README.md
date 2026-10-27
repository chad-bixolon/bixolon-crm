# Synthetic import source fixtures

These tracked files contain fabricated source records. A few product codes, company names, names and amounts are regression sentinels already asserted in the unit tests; they do not come from copied customer documents. Hosted CI sets `SALESHUB_TEST_USE_CI_FIXTURES=true`, so the complete unit suite can run from a clean checkout. Local release validation prefers the ignored `../reference-data/` documents when those are available.

Regenerate the files from `app/` with `node tests/fixtures/ci-source/generate.mjs`. The generator is the source of truth for the binary XLSX files; review changes to it and the generated files together. When adding an import regression that reads a local source document, add an equivalent synthetic fixture and keep `tests/ci-contract.test.mjs`'s fixture list current. Do not copy real customer files into this directory.
