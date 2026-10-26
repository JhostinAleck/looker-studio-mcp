# looker-studio-mcp

MCP server that lets an AI assistant build **Looker Studio** (formerly Data Studio) dashboards on top of **BigQuery**: explore datasets, run read-only queries, create views, and design reports — charts, text, shapes, themes, exact layouts — then check the result with a screenshot.

Looker Studio has no public API to edit reports, so the report tools drive the real Looker Studio editor in a dedicated, signed-in Chrome profile (Playwright). BigQuery goes through its REST API.

```
"Build a dark dashboard for analytics.events:
 a header band, three KPI cards, uses per feature as bars, the share as a donut
 and a table at the bottom."
```

## Quick start

```bash
npm install && npm run build
npx playwright install chromium            # Playwright's driver; reports run on your Google Chrome
node build/cli/main.js init --project my-gcp-project --enable-writes
node build/cli/main.js login               # sign in to Google once, then quit Chrome (⌘Q)
gcloud auth application-default login      # or --credentials-file for a service account
node build/cli/main.js auth                # checks both
```

Register it with your MCP client (Claude Code shown):

```bash
claude mcp add looker-studio -- node /path/to/looker-studio-mcp/build/cli/main.js serve --enable-writes
```

## Table of contents

- [Authentication](#authentication)
- [Configuration](#configuration)
- [Write operations](#write-operations)
- [Available tools](#available-tools)
- [Custom queries](#custom-queries)
- [Other connectors](#other-connectors)
- [Designing dashboards](#designing-dashboards)
- [CLI reference](#cli-reference)
- [Limits](#limits)
- [Architecture](#architecture)

## Authentication

Two independent credentials:

| For | How | Check |
|---|---|---|
| BigQuery (datasets, queries, views) | Application Default Credentials, or `auth.credentials_file` (service account / authorized_user JSON) | `auth` |
| Looker Studio reports | A Chrome profile at `~/.looker-studio-mcp/browser-profile`, signed in once with `login` | `auth` |

`login` opens your regular Google Chrome (not an automated one: Google refuses sign-in in automated browsers). Sign in, open Looker Studio once, then quit Chrome completely with ⌘Q so the session is written to disk. Every later run reuses that profile; the server never sees your password.

## Configuration

`~/.looker-studio-mcp/config.yaml` (written by `init`):

```yaml
project_id: my-gcp-project      # default project for BigQuery tools
location: US                    # BigQuery location
auth:
  credentials: adc              # adc | file
  credentials_file: null
  browser_profile_dir: ~/.looker-studio-mcp/browser-profile
  browser_channel: chrome       # chrome | chromium | msedge
  headless: true                # false (or serve --headed) to watch the editor
writes:
  enabled: false
  dry_run: false                # true: write tools only describe what they would do
query:
  max_rows: 500
  max_bytes_billed: 1000000000  # 1 GB per query
ui:
  step_timeout_ms: 30000
logging:
  level: info
```

Environment overrides: `LOOKER_STUDIO_MCP_PROJECT`, `LOOKER_STUDIO_MCP_CREDENTIALS_FILE`, `LOOKER_STUDIO_MCP_HEADLESS`. CLI flags override both.

## Write operations

Write tools are registered only when **both** `writes.enabled: true` is in the config **and** `serve --enable-writes` is passed. Every write is appended to `~/.looker-studio-mcp/audit.ndjson`. With `writes.dry_run: true` they only describe the change.

`delete_report` also needs `confirm_name` to match the report's name. `run_query` refuses anything but a single `SELECT`/`WITH`, and every query is capped by `max_bytes_billed`.

## Available tools

### Read tools (always available)

| Tool | What it does |
|---|---|
| `check_auth` | Checks the BigQuery credentials and the signed-in browser profile |
| `list_datasets`, `list_tables`, `describe_table` | Explore BigQuery (fields, row counts, view SQL) |
| `run_query` | One read-only query, rows as a table; `dry_run` estimates bytes |
| `list_reports` | Your Looker Studio reports, filterable by name |
| `list_report_pages` | Pages of a report |
| `list_components` | Charts, texts and shapes of a page: index, kind, layout |
| `describe_component` | Every Setup/Style setting of a component with its exact label and value |
| `screenshot_report` | PNG of a page in view mode, returned as an image |
| `build_report_link` | A Linking API URL that creates a report from BigQuery tables, custom queries or Google Sheets |
| `check_report` | Every chart of a report (or a page) that shows "No data", a configuration error, a data set error (Too Many Rows, BigQuery errors) or is still loading, with page, index, kind, fields and Looker's details ([docs](docs/check-report.md)) |
| `list_data_sources` | Data sources of a report: name, alias (ds0…), table or custom query SQL, charts using it, data credentials, data freshness; `fields: true` adds each field's type and aggregation |
| `export_report_spec` | Read a report into a JSON spec (theme, data sources, pages, components with fields and main style) that `apply_report_spec` rebuilds |
| `list_deliveries` | The report's email delivery schedule (recipients, pages, start, repeat with weekdays, time, time zone, Filters tab values), if any |
| `list_versions` | File › Version history: index, name or date, and authors of each version, newest first |

### Write tools (require writes)

| Tool | What it does |
|---|---|
| `create_view`, `delete_view` | BigQuery views (dry-run validated first) |
| `create_report` | New report connected to a BigQuery table, view or custom query (`sql`), a Google Sheet, or a PostgreSQL/MySQL database (`connector`) |
| `add_data_source` | Connect another BigQuery table, view or custom query (`sql`, optional `source_name`), Google Sheet or PostgreSQL/MySQL database (`connector`) to a report |
| `refresh_data_source` | Re-read a data source's fields after a column was added to the table or view |
| `add_chart` | All 49 chart presets: tables (with bars/heatmap), scorecards (compact, with dimension, sparkline), time series, bars (stacked, 100%), histogram, pie, donut, line, area, combo, pivot tables (with bars/heatmap), funnel, waterfall, sankey, bullet, gauge, treemap, scatter, bubble, boxplot, candlestick, timeline, geo and Google Maps — with dimensions, metrics (aggregation, display name), breakdown, sorts (Sort #2…), extra Setup slots, filters (AND/OR), default date range (preset or fixed dates), comparison period, combo series, value colors, reference lines and bands, conditional formatting, title, layout and Style settings |
| `add_control` | Drop-down, fixed-size list, input box, advanced filter, slider, checkbox, preset filter, date range, data control, dimension control, button (link to a URL or page, or a report action) |
| `add_image` | Logo or header art from a local file or https URL |
| `add_calculated_field` | A formula field on a data source (ratios, CASE groupings, date parts) |
| `add_text` | Text box: size, color, bold, alignment, background |
| `add_shape` | Rectangle, circle, triangle, heart, diamond, pentagon, star, hexagon, octagon, cylinder, block arrows, callout: fill, border, radius |
| `add_line` | Straight line between two points: color, dash style, arrow heads |
| `add_embed` | URL embed (a page that allows being embedded) |
| `update_component` | Move/resize, switch the chart type, Style/Setup settings, Setup slots, filters, sorts, reference lines/bands, conditional formatting, date range, comparison, series, value colors, rename fields, restack (front/back), make report-level, button action, embed URL |
| `duplicate_component` | Copy a component with its settings and place the copy |
| `arrange_components` | Align, distribute evenly, group or ungroup components |
| `delete_component` | Remove a component |
| `set_page_settings` | Filters, default date range, date range dimension and data source of a whole page or of the whole report; page background and size |
| `manage_filter` | Edit (rename, replace clauses), duplicate or delete a filter of the report |
| `add_parameter`, `add_group_field`, `add_bin_field` | Parameters (with permitted values and default), group fields (named buckets) and bin fields (numeric ranges) |
| `create_blend` | Blend 2 to 5 data sources with left/right/inner/full/cross joins |
| `set_theme` | Built-in theme, custom theme settings, page size, Layout settings (tab navigation, header) |
| `share_report` | Invite several people at once as viewers or editors; existing access is changed in place |
| `add_page`, `rename_page`, `manage_page`, `rename_report`, `delete_report` | Report management; `manage_page` deletes, duplicates, hides/shows and reorders pages |
| `add_community_viz` | Community visualization from the gallery by name ("Gauge", "Sunburst Chart"…) or your own by `manifest_path` (gs://…), with consent, data source, dimensions, metrics, Setup slots, filters, style and layout |
| `remove_data_source` | Remove a data source by name or alias; refuses while charts use it unless `force: true` |
| `update_data_source` | Rename a data source, replace a custom query's SQL, set data credentials (`owner`/`viewer`) and data freshness (presets, or a custom period such as `30 minutes` or `2 hours`, up to `12 hours`); `make_reusable` moves an embedded data source to the account's reusable data sources |
| `update_field` | Change a data source field's type (Number, Text, Date…), default aggregation and/or name |
| `apply_actions` | Run a list of editing actions (any of the tools above, same arguments) in one editor visit: validated first, a result per action |
| `apply_report_spec` | Build a report from a JSON spec, or add the missing pages and components to an existing one, in one visit |
| `copy_report` | File › Make a copy under a new name; `data_sources` swaps a data source for a reusable one of the account (`reusable`, picked in the copy dialog) or reconnects an embedded one to another table, view or custom query. Returns the new id and URL |
| `set_link_sharing` | Link settings: restricted, unlisted (anyone with the link) or public, with the link's role (viewer/editor) |
| `schedule_delivery`, `remove_delivery` | Email the report on a schedule: recipients, start date, time, time zone, repeat (daily, weekly, monthly, weekdays, custom every N days, weeks on chosen weekdays, or months on the day or weekday), pages, and the Filters tab (filter control values, date range controls); or delete the schedule |
| `restore_version` | Restore a version by its index or label from `list_versions` |
| `get_embed_code` | File › Embed report: turns embedding on if needed and returns the iframe code and embed URL (width, height, page, navigation) |

Settings are addressed by the **label the properties panel shows** (`"Bar color"`, `"Show data labels"`, `"Border radius"`…). `describe_component` lists them; settings that do not exist come back as warnings instead of failing silently.

## Custom queries

`create_report`, `add_data_source` and `build_report_link` take `sql` instead of `dataset_id` and `table_id`; `project_id` is then the billing project and `source_name` names the data source. The SQL is dry-run in BigQuery first: a query BigQuery rejects comes back with BigQuery's message and the browser never opens. `date_range_params` and `viewer_email_param` pass `@DS_START_DATE`/`@DS_END_DATE` and `@DS_USER_EMAIL` to the query (not through the Linking API). The data source then works like any other. See [docs/custom-queries.md](docs/custom-queries.md) for naming, field types, validation and cost.

## Other connectors

`create_report`, `add_data_source` and `build_report_link` take `connector` (default `bigquery`, so existing calls are unchanged):

- `google_sheets`: `spreadsheet` (URL or id), `worksheet` (tab name) or `worksheet_id` (its gid), `use_first_row_as_headers`, `include_hidden_and_filtered_cells`, `range`.
- `postgresql`, `mysql`: `host`, `port`, `database`, `user`, `password`, `ssl`, and `table_id` or `sql`. Not available in `build_report_link` (the Linking API has no such connector).

Passwords are redacted from the audit log and never appear in replies. See [docs/connectors.md](docs/connectors.md).

## Batches and report specs

Each editing tool opens the report, does its work and closes it. `apply_actions` runs many of them in one editor visit, several times faster: `{"report_id": "…", "actions": [{"tool": "add_text", "args": {"text": "Title"}}, …]}`. `export_report_spec` and `apply_report_spec` read a report into JSON and build one from it (copies, templates, dashboards written by hand). See [docs/report-spec.md](docs/report-spec.md).

## Designing dashboards

See [docs/design-guide.md](docs/design-guide.md) for the canvas grid, the card pattern, color and type choices, and a full worked example. The short version:

1. `set_theme` first (e.g. `Constellation` + `"Report background color": "#0B1020"`).
2. Shapes for structure (header band), then charts, each with `layout` on a 20 px grid.
3. Card look on charts and scorecards: `{"Background": "#151B33", "Border color": "#151B33", "Border radius": 16}`.
4. Human labels: metric `label` in `add_chart`, `labels` in `update_component`.
5. `screenshot_report` after each section; fix with `update_component`.

## CLI reference

| Command | Purpose |
|---|---|
| `serve [--config] [--project] [--enable-writes] [--headed]` | Start the MCP server on stdio (default command) |
| `login [--chrome-path]` | Sign in to Google in the MCP browser profile |
| `auth [--test]` | Check BigQuery credentials and the browser sign-in |
| `init --project <id> [--location] [--credentials-file] [--enable-writes] [--force]` | Write the config without prompts |

## Limits

- Report tools depend on the Looker Studio editor UI. Selectors are kept in one file (`src/contexts/reports/infrastructure/ui/selectors.ts`) and the editor is opened in English (`hl=en`) regardless of the account language, but a Looker Studio redesign can break them.
- One editor action per page visit: each tool call takes a few seconds.
- Time series need a date or date-time dimension with a sensible granularity; a raw timestamp gives "Too many rows". Add a `DATE(...)` column in a view.
- Field chips are matched by their display name, so rename fields (`labels`) after the setup that refers to them.
- `add_page` appends after the last page.
- `manage_filter` edit rewrites every clause of the filter; charts that use it keep it.
- Filter values are typed as free text (the editor's value suggestions are turned off), so a value that is not in the data is accepted: check the spelling. "In" takes its values comma separated.
- Custom queries: always pass `source_name` and cast columns whose type Looker Studio may guess wrong. The automatic dry run catches unknown columns and syntax errors, not errors that only happen when the query runs ([details](docs/custom-queries.md)).
- PostgreSQL and MySQL were written against the live connector form, but not run end to end against a database: the table list and custom query step after AUTHENTICATE are untested ([details](docs/connectors.md)).
- `build_report_link` cannot enable date range or viewer email parameters: the Linking API has no parameter for them.
- `check_report` opens the editor, so it needs edit access, and reads the English messages of Looker Studio.
- Community visualizations define their own Setup slots and Style settings: use `describe_component` to read them. `add_community_viz` accepts the gallery's consent prompt for you.
- `share_report` opens a visible Chrome window for a few seconds: Google refuses invitations sent from a headless browser. It sends one invitation per address, since a batch fails with "An unknown error occurred".
- `set_link_sharing`, `schedule_delivery` and `remove_delivery` also open a visible window: Google refuses link changes and schedules from a headless browser.
- `copy_report` copies only the data sources a component uses (an unused one is dropped, and a report with no chart loses its data). Any of them can be swapped for a reusable data source of the account (`reusable`); only embedded ones can be reconnected to a new table or query, since a reusable one is shared with other reports. To swap in a source that is still embedded somewhere, make it reusable first (`update_data_source` with `make_reusable: true`); reusable data sources live in the account's Data sources list until deleted there. Looker Studio names the copy in the account language; the tool renames it.
- `schedule_delivery`: one schedule per report and account, and the signed-in account is always a recipient (its chip cannot be removed). The dialog has no subject or message. Times are half-hour slots. The time zone is not a field of the dialog: a new schedule takes the browser's, and keeps it. `time_zone` opens the window in that zone and recreates an existing schedule (options not passed go back to their defaults); Looker Studio shows its own name for the zone, chosen by the current offset (America/Bogota is saved as "Eastern Time - Indianapolis", which observes daylight saving time). Weekly and monthly repeat on the weekday of the start date; custom repeats take `weekdays` for weeks and `monthly_on` for months. `filters` set the Filters tab: the report's filter controls by page (drop-downs and lists by value, input boxes, date range controls); a single-select control on a field with one value cannot hold it. `list_deliveries` shows the schedule of one report: Looker Studio has no list of every schedule.
- `list_versions`: the current version is the live draft, so edits within a few minutes are grouped into it; indexes shift after every save, so call `list_versions` right before `restore_version`.
- `get_embed_code` returns the URL on the host the account uses (some accounts still get `datastudio.google.com`). "Public" link sharing can be turned off by a Google Workspace admin; the tool then fails with that message.

## Architecture

DDD with bounded contexts:

```
src/contexts/authentication   Google token provider, browser session (Playwright profile)
src/contexts/google-api       Authenticated REST client with retries
src/contexts/bigquery         Datasets, tables, read-only queries, views
src/contexts/reports          Report model + use cases; UI adapter driving the editor
src/mcp                       Tool schemas, handlers, registry (writes gated)
src/shared-kernel             Config, logging, audit, errors, writes gate
src/cli                       serve, login, auth, init
```

Dependency rules are enforced by `npm run check:deps`. See [AGENTS.md](AGENTS.md).

## License

MIT
