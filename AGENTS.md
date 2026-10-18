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
- Filters: Setup › Add filter lists the report's filters by name, then "Create a filter": name, Include/Exclude, field picker, condition `mat-select`, value chip inputs, Save.
- Images and value-color dialogs ignore `fill()` on some inputs; type with the keyboard. A clicked image lands at 0×0: drag its box out.
- Some settings (Layout › Navigation type) put the label in its own cell; `findField` falls back to the next cell with a control.
- Sharing: Google refuses invitations from a headless browser and from a Send with several chips. One address per Send, in a visible window (`withPage(work, { visible: true })`). Changing an existing person's role closes the dialog.
