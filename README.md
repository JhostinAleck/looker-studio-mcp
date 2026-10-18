# looker-studio-mcp

MCP server that lets an AI assistant build **Looker Studio** (formerly Data Studio) dashboards on top of **BigQuery**: explore datasets, run read-only queries, create views, and design reports — charts, text, shapes, themes, exact layouts — then check the result with a screenshot.

Looker Studio has no public API to edit reports, so the report tools drive the real Looker Studio editor in a dedicated, signed-in Chrome profile (Playwright). BigQuery goes through its REST API.

```
"Build a dark dashboard for campusfind_analytics.bq_feature_usage:
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
| `build_report_link` | A Linking API URL that creates a report from BigQuery sources |

### Write tools (require writes)

| Tool | What it does |
|---|---|
| `create_view`, `delete_view` | BigQuery views (dry-run validated first) |
| `create_report` | New report connected to a BigQuery table or view |
| `add_data_source` | Connect another BigQuery table to a report |
| `refresh_data_source` | Re-read a data source's fields after a column was added to the table or view |
| `add_chart` | Table, scorecard, time series, column, bar, pie, donut, line, area, combo, geo, treemap, gauge, pivot table, scatter — with dimensions, metrics (aggregation, display name), breakdown, sort, title, layout and Style settings |
| `add_text` | Text box: size, color, bold, alignment, background |
| `add_shape` | Rectangle, circle, triangle, heart, diamond, pentagon, star, hexagon, octagon, cylinder: fill, border, radius |
| `update_component` | Move/resize, Style/Setup settings, rename fields, restack (front/back), make report-level |
| `delete_component` | Remove a component |
| `set_theme` | Built-in theme, custom theme settings, page size |
| `add_page`, `rename_report`, `share_report`, `delete_report` | Report management |

Settings are addressed by the **label the properties panel shows** (`"Bar color"`, `"Show data labels"`, `"Border radius"`…). `describe_component` lists them; settings that do not exist come back as warnings instead of failing silently.

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
- `add_page` appends after the last page. `share_report` has not been exercised against a real recipient yet.

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
