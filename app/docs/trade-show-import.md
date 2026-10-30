# Trade Show lead import

The Trade Show import accepts the NRA / NRF and MODEX / XPressLeads Import Templates in `.xls` and `.xlsx` workbooks, plus custom column mappings. Workbooks are limited to 2 MB, 1,000 source rows, and 100 source columns. Only the first worksheet is parsed; formulas are not evaluated, and imported cells use the values cached in the workbook. Formula text, rich-text HTML, VBA projects, raw workbook files, styles, and calculation chains are not retained. The importer does not resolve external workbook links.

Security TODO: consider moving workbook parsing into a resource-limited worker or separate process to further contain parser failures and CPU or memory exhaustion. This isolation is intentionally deferred from the current parser-hardening pass.

## Import Template and event attribution

`TradeShowImport.format` identifies the workbook template, not Lead Source. The legacy `XPRESSLEADS_MODEX` value was introduced in `20260922180000_trade_show_foundation` for the MODEX XPressLeads export (the reference workbook is `XPressLeadsMODX0426_2663118_C669ADFB76C9468_BIXOLON.xls`). Detection uses the `downloads` worksheet and expected columns including `DeviceLabel` and `Scan Date/Time`; it does not select an event. Preview, Import History, and lead import details display **Import Template: MODEX / XPressLeads**. Preserve the enum and historical template name.

The selected `tradeShowId` on the import and lead supplies the actual event. `firstImportId` retains the original import metadata; custom imports also retain `mappingId` and the historical `mappingName`. Raw workbook fields, including any Lead Origin column, remain original import data rather than business attribution.

Business Lead Source is separately stored in `TradeShowLead.leadSourceId` (and `Contact.leadSourceId`). Imports use the `TRADE_SHOW_EVENT` system category (Events), preserving existing Contact first touch. Campaigns are linked by the selected `tradeShowId`, with influence context `TRADE_SHOW_IMPORT`. Reports group/filter by the actual event, and Saved Views retain event filters. Routing uses the selected destination and rep; follow-up Tasks use the lead's event name. None uses the template label as attribution. Template format remains relevant to parsing, validation, and duplicate identity handling.

This terminology correction needs no schema or historical data migration and changes no attribution rules.

## Partner routing after import

Choose a Follow-up Owner when routing new leads to a Partner Account during import. The chosen user will receive the internal follow-up Task after handoff. New leads routed to a Partner Account start **Awaiting Handoff**. They create no per-lead Sales Task. Open the Trade Show’s **Partner Handoffs** view, review each partner’s awaiting leads, and confirm **Export & Complete Handoff** to mark the leads as **Sent to Partner** and create one internal follow-up Task. **Source Notes**, **Partner Handoff Notes**, Product Interest, Qualification, Competitor Mentioned, Current Product Being Used and Customer Pain Points are shared with the partner. Comments mapped into Source Notes are included. Sales Notes, internal Referral Notes and unrelated CRM notes stay private. Review shared context before export. Handoff History remains available after source refreshes and conversion. See [Partner Handoffs v1](trade-show-partner-handoff-v1.md) for export, reassignment and history details.
