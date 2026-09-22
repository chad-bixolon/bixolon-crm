# Trade Show lead import

The Trade Show import accepts the known NRA, NRF, and MODEX binary `.xls` export profiles. Workbooks are limited to 2 MB, 1,000 source rows, and 100 source columns. Only the first worksheet is parsed; formulas are not evaluated, and imported cells use the values cached in the workbook. Formula text, rich-text HTML, VBA projects, raw workbook files, styles, and calculation chains are not retained. The importer does not resolve external workbook links.

Security TODO: consider moving workbook parsing into a resource-limited worker or separate process to further contain parser failures and CPU or memory exhaustion. This isolation is intentionally deferred from the current parser-hardening pass.
