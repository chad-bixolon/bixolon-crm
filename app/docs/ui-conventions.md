# SalesHub UI conventions

Use the existing classes in `app/app/globals.css` for forms and actions. Keep page-specific CSS for layout or genuinely distinct content, not for new control sizes.

## Controls and labels

- Do not expose raw database IDs in user-facing UI unless the value is an intentional business identifier. Use BXS case numbers, PE Numbers, and SKUs where meaningful; do not show labels such as Contact #99. Keep internal IDs in routes and form values.

- Use `.label` for form labels and associate separate labels with controls using `htmlFor` and `id`. Nested controls may use a wrapping label.
- Use `.field` for text, search, date, number, native select, textarea, and searchable picker inputs. Standard controls are 2.5rem tall with 14px text and 12px horizontal padding. Textareas grow with content.
- Native select fields use the same font and height as inputs. Browser option menus vary by platform; do not style their internals. Custom picker results use `.search-results-popover` and `.search-results-option` for bounded scrolling and compact 13px rows.
- Use a native select for a small, known set of options. Use the existing searchable picker when finding an Account, Product, Contact, or Project among many records requires search. Preserve its listbox roles, keyboard handling, and portal placement.

## Entity search

- Use `EntityPicker` for Account, Contact, Opportunity, and Project relationships. Its endpoint searches PostgreSQL after two characters, debounces requests for 250 ms, and returns at most 25 records. Do not preload entity tables for a picker or filter them in the browser.
- Rank exact names first, then names starting with the query, then word prefixes, then contained matches. Sort equally ranked names without regard to case and break ties with the record ID. Show the business name plus compact Account or location context. Preserve entity-specific access and eligibility filters in the server query and in the save action.
- Use the shared `SearchResultsPopover` for results. It stays within the viewport, opens upward when needed, scrolls internally, and caps its height at 320px. Show the two-character prompt initially, `Searching...` while waiting, and a clear no-results message.
- Keep selected ID and selected label separate from search text. Changing text must clear the prior selected ID. A required relationship needs a selected result; a typed but unselected value is a field error. Preserve selected IDs and labels on failed saves. A changed parent only clears a dependent selection when that selection is no longer eligible.

## Failed Save / Validation Behavior

- Preserve entered text, dates, options, and unrelated selections after a failed mutation. Show a specific error beside the field where practical and a clear form error for other failures.
- Reset, close, refresh, or redirect a form only after a successful mutation or an explicit user action.
- Searchable entity pickers keep the selected ID and business display label together. Typed search text without a selected suggestion is not a valid relation; preserve that text and ask the user to select a result.
- Changing a parent relation may clear incompatible child selections. A validation failure alone must not clear valid dependent selections.

## Buttons

- `.btn-primary`: orange main action, such as Save, Apply, View report, or Export.
- `.btn-secondary`: neutral navigation, Cancel, Clear, or other secondary action.
- `.btn-danger`: destructive action when the existing workflow calls for a destructive emphasis.
- The existing `.btn-filter-primary` and `.btn-filter-secondary` use the same variants with narrower horizontal padding. Disabled buttons use a neutral appearance and keep the native `disabled` attribute.
- All variants share control height, font, radius, visible focus, and inline alignment. Use real buttons for actions and links for navigation.

## Layout

- `PageHeader` already places the heading on the left and actions on the right. Wrap multiple actions in `.page-header-actions`.
- Use `.filter-panel.filter-grid.filter-row` for compact report filters, `.field.filter-control` for their controls, and `.filter-actions` for submit and clear actions. Keep labels with their controls.
- For a small set of server-filtered states or categories, group labeled link controls in one `.filter-panel`; mark the selected link with `aria-current="page"` and a visible non-color cue. Keep a server-side select and its Apply action together when selection does not submit immediately.
- Use `.inline-field-action` for a labeled control beside Save or Apply. Use `.form-action-row` for related actions and form footer buttons.
- Existing `.panel` provides card border, background, and radius. Add responsive padding and gaps with the page's layout classes.
- Let rows wrap at tablet widths. On narrow screens, controls stack and the main inline action can fill the row. Do not set fixed widths that cause horizontal overflow.
