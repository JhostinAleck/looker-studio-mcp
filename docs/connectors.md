# Connectors and community visualizations

`create_report`, `add_data_source` and `build_report_link` read data from BigQuery by default. The `connector` field picks another Looker Studio connector:

| `connector` | Looker Studio connector | `create_report` / `add_data_source` | `build_report_link` |
|---|---|---|---|
| `bigquery` (default) | BigQuery | table, view or custom query | yes |
| `google_sheets` | Google Sheets | yes | yes, by worksheet gid |
| `postgresql` | PostgreSQL | yes, **not verified end to end** | no |
| `mysql` | MySQL | yes, **not verified end to end** | no |

Calls without `connector` behave exactly as before. Fields of another connector are rejected (`host` on a BigQuery source, `table_id` on a Google Sheet…) instead of being ignored. `source_name` names the data source in the report for every connector other than BigQuery tables.

## Google Sheets

```json
{
  "name": "Project hours",
  "connector": "google_sheets",
  "spreadsheet": "https://docs.google.com/spreadsheets/d/<spreadsheet id>/edit#gid=0",
  "worksheet": "Data",
  "range": "A1:C200",
  "source_name": "Tasks"
}
```

| Field | Meaning |
|---|---|
| `spreadsheet` | Spreadsheet URL or id. A URL with `#gid=` also gives `worksheet_id`. |
| `worksheet` | Tab name, as the spreadsheet shows it. |
| `worksheet_id` | Tab id: the number after `#gid=` in its URL. Either this or `worksheet`. |
| `use_first_row_as_headers` | "Use first row as headers" (default `true`). Headers must be unique; columns with an empty header are left out. |
| `include_hidden_and_filtered_cells` | "Include hidden and filtered cells" (default `true`). |
| `range` | "Include specific range", an A1 range such as `A1:D20`. |

What to know:

- **Authorization.** The first Google Sheets source of a browser profile asks to authorize the connector. The editor accepts it for the signed-in account (Google's consent screen: "See and download your Google Drive files"). After that the form opens directly.
- **Access.** The signed-in account must be able to open the spreadsheet. The data source uses that account's credentials, so viewers of a shared report see the data without access to the sheet.
- **Field types.** Looker Studio guesses each column's type from its values and can guess wrong (a column of small integers came in as a Date). Fix the type in the data source, or keep the column's values unambiguous.
- **Linking API.** `build_report_link` addresses a tab by `worksheet_id` only. Pass the tab's URL (with `#gid=`) or `worksheet_id`; a `worksheet` name alone is an error there. It sends `ds.*.connector=googleSheets`, `spreadsheetId`, `worksheetId`, `hasHeader`, `includeHiddenCells`, `includeFilteredCells` (both set from `include_hidden_and_filtered_cells`), `range` and `datasourceName`.

## PostgreSQL and MySQL

```json
{
  "report_id": "<report id or URL>",
  "connector": "postgresql",
  "host": "db.example.com",
  "port": 5432,
  "database": "shop",
  "user": "looker_reader",
  "password": "<password>",
  "ssl": { "server_certificate": "/path/to/server-ca.pem" },
  "table_id": "orders",
  "source_name": "Orders"
}
```

| Field | Meaning |
|---|---|
| `host`, `port`, `database`, `user`, `password` | The connector's Basic authentication form. `port` is optional (the connector's default). |
| `ssl` | Turns on "Enable SSL". `server_certificate`, `client_certificate`, `client_key` are local PEM files uploaded to the form; giving the client certificate and key turns on "Enable client authentication". |
| `table_id` | A table of the database. |
| `sql` | A custom query in the database's own SQL, instead of `table_id`. |

**Not verified end to end.** There was no database to test against. The form up to AUTHENTICATE (authorization, Basic fields, SSL check boxes and the certificate uploads) was inspected in the live editor; the step after it (picking the table, or the CUSTOM QUERY box) follows the connector's documentation and has not run. If it fails, the error says which step broke and a screenshot is saved.

What to know:

- **Passwords.** The password is typed into the connector form and nowhere else: it is replaced with `[redacted]` in the audit log (`~/.looker-studio-mcp/audit.ndjson` and its log line), and the tool reply and editor step messages describe the source as `user@host:port/database`. It still passes through the MCP client's conversation, so use a read-only database user.
- **Network.** Looker Studio connects from Google's servers: the database must accept connections from Looker Studio's IP ranges.
- **Linking API.** It has no PostgreSQL or MySQL connector; `build_report_link` refuses them.

## Community visualizations

`add_community_viz` inserts a visualization from the toolbar's "Community visualizations and components" menu and configures it like a chart:

```json
{
  "report_id": "<report id or URL>",
  "name": "Sunburst Chart",
  "data_source": "Tasks",
  "dimensions": ["Category", "Task"],
  "metrics": [{ "field": "Hours", "aggregation": "sum" }],
  "layout": { "x": 40, "y": 40, "width": 500, "height": 400 }
}
```

| Field | Meaning |
|---|---|
| `name` | Card name in the Community Gallery, matched whole, ignoring case ("Gauge", "Sunburst Chart", "Gantt Chart", "Sankey"…). An unknown name fails with the list of names the gallery shows. |
| `manifest_path` | Instead of `name`: the `gs://` path of your own visualization ("Build your own visualization"). |
| `dimensions`, `metrics` | Go to the visualization's Dimension and Metric sections. |
| `fields` | Any other Setup slot by its heading, as in `add_chart`. |
| `data_source`, `filters`, `date_range`, `sorts`, `title`, `style`, `layout`, `page` | As in `add_chart`. |

What to know:

- The menu is disabled until the report has a data source.
- Third-party visualizations ask "Grant consent" the first time; the tool clicks Allow. Only add visualizations from providers you trust: they receive the data they display.
- Each visualization defines its own Setup slots and Style settings. `describe_component` lists them; `update_component` changes them afterwards.
- A manifest that cannot be loaded fails with the editor's message ("An error occurred while requesting the visualization manifest"). Gallery visualizations (Google's Gauge, a third-party Sunburst) were tested live; a valid `manifest_path` was not, for lack of a deployed manifest.
