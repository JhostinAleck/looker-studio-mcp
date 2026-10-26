# AGENTS.md — Project map for AI assistants & humans

> Map of the `looker-studio-mcp` repository. Read this first if you've never touched the project.

## What this is

MCP server that lets AI assistants build Looker Studio dashboards on BigQuery. TypeScript, DDD with bounded contexts, opt-in writes.

```
src/
  contexts/
    authentication/        ← AccessTokenProvider (google-auth-library), BrowserSession (Playwright profile)
    google-api/            ← GoogleApiClient: bearer token, retries on 429/5xx
    bigquery/              ← domain (types, SQL guards), use cases, REST repository
    reports/
      domain/              ← Report, ChartSpec, Layout, settings validation, ReportRepository port
      application/         ← Use cases: validation before any browser work
      infrastructure/
        LookerStudioUiReportRepository.ts  ← one editor visit per repository call
        ui/LookerStudioEditor.ts           ← canvas geometry, menus, field slots, panels
        ui/selectors.ts                    ← every Looker Studio selector and label
  mcp/                     ← schemas.ts (Zod), tools/*.tool.ts, registry.ts (writes gated)
  shared-kernel/           ← config, logging, audit, errors, writes gate, fs
  cli/                     ← serve, login, auth, init
  composition-root.ts      ← buildDependencies
tests/                     ← Vitest mirror of src/ (the UI adapter is verified live, not unit-tested)
docs/design-guide.md       ← How to lay out good-looking reports with the tools
```

## Commands

```bash
npm run build        # tsc + tsc-alias
npm run check        # typecheck, lint, tests, dependency rules
npm test             # vitest watch
```

## Rules

- **Domain stays pure.** `reports/domain` and `bigquery/domain` import nothing from infrastructure; `check:deps` enforces it.
- **Validate in use cases**, before opening a browser: colors `#RRGGBB`, layouts, non-empty labels, report ids.
- **All Looker Studio knowledge lives in `ui/`.** Labels, icons and section names go in `selectors.ts`; interaction mechanics in `LookerStudioEditor.ts`.
- **Writes are opt-in**: config `writes.enabled` and `--enable-writes`. Every write goes through `runWrite` (audit + dry run).
- **Never fail silently.** Settings the panel lacks and layouts the editor snapped are returned as warnings.

## Looker Studio editor: things that bite

- Open every URL with `hl=en`; the account language would change every label.
- Chrome must start without `--use-mock-keychain`/`--password-store=basic` and with `viewport: null`, or the signed-in cookies cannot be decrypted and are wiped.
- Field slots: click "Add metric"/a chip name to open the **field picker** (searchable, reliable). Dragging from the Data panel is only a fallback: the drag ghost hangs from the grab point, the search results are drawn over the full list, and a diagonal path is captured by the data source drop zone.
- Chip lists are virtual-scrolled: scroll a section into view before reading its chips.
- Chips are named by **display name**; the field editor (pencil at the chip's left edge) holds display name and aggregation. It ignores Escape; click its backdrop.
- Long menus (Insert) overflow the window: scroll items into view; submenus open on hover, search the right panel depth (a parent can share an icon with a child, e.g. Shapes/Rectangle).
- New components land with their top-left at the click and a default size up to 400×300; place them where the resize handle stays on screen, resize, then move.
- The viewer clips pages taller than the window: `screenshot` grows the window through CDP first.
- Text boxes ignore drags; move them with Shift+Arrow (1 px per press). A click on a selected text box enters text editing, so deselect first.
- Date pickers (chart "Custom" range, date range control, comparison) open a popup with a preset menu button and Apply; presets like "Last 28 days" sit in a submenu named after its first entry ("Last 7 days").
- The chart date range's "Custom" radio shows a tooltip to its right while hovered that stays over the picker button: move the mouse away before clicking the picker. Page and report settings only show "Default date range" once they have a date range dimension; custom queries with `@DS_START_DATE`/`@DS_END_DATE` have no date field but follow the page/report/control range.
- Filters: Setup › Add filter lists the report's filters by name, then "Create a filter": name, Include/Exclude, field picker, condition `mat-select`, value box, Save. Each clause is a `.ng2-filter-expression-definition` with its own × button; the AND/OR buttons add the next clause last.
- Filter values: with "Show suggested values while typing" on, "Equal to" and "In" take chips that only accept a suggested value (none while the data loads) and Save stays disabled. Turn it off: the box then takes free text, "In" comma separated.
- `mat-select` labels intercept clicks: click with `force`. Option lists differ in case ("GREATER THAN" in conditional formatting): match ignoring case and the "(>)" suffix.
- The filter editor and Manage filters have a field labelled "Name"; `getByLabel('Name')` also matches the report title. Use the placeholder "Filter name".
- Resource › Manage filters: Remove asks "Remove Filter"; the page closes with CLOSE, not Escape.
- "Add sort" opens the field picker directly and adds "Sort #2" with its own Descending/Ascending.
- The "Chart types" grid lists presets in "Add a chart" order without labels: switch types by position.
- Images and value-color dialogs ignore `fill()` on some inputs; type with the keyboard. A clicked image lands at 0×0: drag its box out.
- Some settings (Layout › Navigation type) put the label in its own cell; `findField` falls back to the next cell with a control.
- Making a component report-level puts it on top of every other component: a header band made report-level last covers its logo and title.
- Sharing: Google refuses invitations from a headless browser and from a Send with several chips. One address per Send, in a visible window (`withPage(work, { visible: true })`). Changing an existing person's role closes the dialog.
- A selected button opens a link menu over a transparent backdrop that ignores Escape and swallows the next click: `select` clicks the backdrop away first.
- Vega charts (bar, column, line, pie, …) also draw in an iframe; a click on it still selects the chart. Turn off canvas iframe pointer events while clicking or dragging: a selection box takes every component inside it, and starts by dragging whatever lies under its corner.
- URL embeds are iframes: a click lands in the embedded page. Select them with a selection box dragged from the empty canvas. Inserted by a click they come in at 400x300; dragged out they stay at 6x6.
- A new line keeps the drawing state: deselect before selecting it. Its "Line start"/"Line end" drop-downs have no label (values None, Circle, Diamond, Pointer).
- Page › Current page settings only shows Filter and Date range dimension when the page has a chart with data.
- Group fields: the "remaining values" name is a textarea under its checkbox. Bin fields: Bin Size / Bin min value / Bin max value.
- Blends: the merge dialog pre-fills key pairs with the same field name; the join type buttons need a forced click.
- Page visibility (Control visibility) is a dialog of three radios and Confirm.
- When a repository call fails, a screenshot of the editor is saved as `error-<report>-<time>.png` in the screenshots folder.
- Connectors other than BigQuery ask to Authorize on first use: a Google OAuth popup (account chooser, then `#submit_approve_access`, its labels in the account language). Google Sheets: pick "Url" in the left list; options are `mat-checkbox[formcontrolname=…]`. PostgreSQL/MySQL inputs carry `formcontrolname` (hostNameOrIp, port, database, username, password).
- The "Community visualizations and components" button is disabled until the report has a data source. Third-party visualizations ask "Grant consent" (Allow). They draw in an iframe that swallows a resize drag passing over it: turn off its pointer events while resizing.
- Chart states: a loading chart shows `ng2-canvas-component-loading-shimmer`; an error is an `ng2-component-error` card (`.error-title`, `.error-description`, `a.more` "See details") whose dialog is an AngularJS `md-dialog.errorDialog` closed with OK; tables write "No data" in `.noData`. Charts and controls have a `.lego-component-header`, texts and shapes do not.
- Vega charts (bar, column, line, area) with no rows draw empty axes and a legend, not "No data" (pie charts write it in `.emptyMsg`). Their sandboxed iframe can be read through Playwright's frame: `.role-mark.hoverTarget` holds one item per data point.
- A viewer email custom query keeps showing "Consent required" with owner's credentials until the viewer clicks Allow; the dialog declined by `openReport` is the same one viewer's credentials open.
- Custom query options: "Enable viewer email address parameter" opens a "Grant consent" dialog (Allow), and the report then asks once more for consent on its first load; until then charts show "Consent required".
- In the data source editor the "Edit Connection" and "Reconnect" buttons have no matching accessible name: find them by text.
- Manage added data sources: the Type chip (Embedded/Reusable) has no cell of its own, so row cells are told apart by content; the alias is the last cell. Remove asks "You are removing a data source" (also when charts use it: they are left broken).
- Data source editor: changes only stick after Done. Edit Connection's Cancel closes the whole editor, back to the Data sources panel. Field type and aggregation menus are AngularJS md-menus (submenus open on hover); closed ones stay in the DOM. Aggregation has no menu for Text or Date fields. Data freshness is an md-dialog, credentials a mat-dialog.
- Viewer's credentials make every editor visit open "Grant consent" over the editor, each time a chart on such a source loads (late, again on other pages and after reloads; the viewer too). `openReport` declines it (Cancel leaves the editor usable; charts show "Consent required" / "Allow"). It is the same dialog as the viewer email one, so only `connectBigQuery` of a viewer email source grants it; the community visualization consent shares the title, not the body text.
- Schedule delivery: the Timezone row is plain text. A new schedule takes the browser's zone (CDP `Emulation.setTimezoneOverride` before the editor loads), mapped by current offset to Google's list (America/Bogota → "Eastern Time - Indianapolis"); an existing schedule keeps its zone through Edit schedule. Repeat › Custom: pick the unit first (it sets the interval's `max`); filling the interval ticks the start date's weekday in "On". Month units read "month on the 27th day" / "month on the last Tuesday".
- Schedule Filters tab: one expansion panel per page with live filter controls (`ng2-canvas-component`). A list control's menu closes through its backdrop, which lies under the menu: click a backdrop corner (a centered click toggles a value; Escape closes the whole dialog). The date range control's picker has its own Cancel next to the dialog's. The summary does not show filters: read them in Edit schedule (Cancel returns to the summary). A single-select control on a field with one value drops it.
- Data freshness › Custom: two md-selects, amount then unit; minutes offer 1-5, 10, 15, 20, 25, 30, 40, 50 and hours 1-12 (no days). The header then reads "Data freshness: 30 minutes".
- Make reusable (Manage added data sources) asks with a "Grant report editors access" checkbox, on by default; the row's Type becomes Reusable and the alias stays. The copy dialog's "New Data Source" picker lists added data sources, then the account's reusable ones; picking one fills the form's `datasourceMap`.
