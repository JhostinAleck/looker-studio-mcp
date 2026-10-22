# Custom queries

A data source can be a SQL query instead of a table or view. `create_report`, `add_data_source` and `build_report_link` take it the same way.

## Usage

Pass `sql` instead of `dataset_id` and `table_id`:

```json
{
  "report_id": "<report id or URL>",
  "sql": "SELECT platform, CAST(COUNT(*) AS INT64) AS events FROM `my-project.analytics.events` GROUP BY platform",
  "source_name": "Events by platform"
}
```

| Field | Meaning |
|---|---|
| `sql` | A GoogleSQL `SELECT`. Use fully qualified table names (`project.dataset.table`). |
| `project_id` | The **billing project** the query runs in. Optional: without it the MCP uses `project_id` from the config (`~/.looker-studio-mcp/config.yaml`), and fails if neither is set. It must be in the account's billing project list in the BigQuery connector. |
| `source_name` | Name of the data source in the report. Only with `sql`. |

Giving `sql` together with `dataset_id` or `table_id`, or `source_name` without `sql`, is an error.

Once added, a custom query is an ordinary data source: charts, controls, filters, calculated fields, parameters and blends pick it by name with `data_source`, and `refresh_data_source` re-reads its fields after the SQL's columns change.

## Managing a custom query

| Tool | Use |
|---|---|
| `list_data_sources` | Shows each data source's alias, whether it is a table/view or a custom query, its SQL and billing project, how many charts use it, its data credentials and freshness. `fields: true` adds every field's type and aggregation: check them after adding a query. |
| `update_data_source` | `sql` replaces the query in place (Edit Connection › Reconnect; the reply lists new, missing and retyped fields), `name` renames it, `credentials` and `freshness` set the header options. Charts keep using the same data source. |
| `update_field` | Fixes a field Looker Studio typed wrong: `{"field": "events", "type": "Number", "aggregation": "sum"}`. `name` renames the field. |
| `remove_data_source` | Removes the data source. It refuses while charts use it, since Looker Studio would leave them broken; delete or repoint those charts, or pass `force: true`. |

```json
{
  "report_id": "<report id or URL>",
  "data_source": "Events by platform",
  "sql": "SELECT platform, CAST(COUNT(*) AS INT64) AS events FROM `my-project.analytics.events` GROUP BY platform",
  "freshness": "1 hour"
}
```

`data_source` takes the name or the alias (`ds0`, `ds1`…, as `list_data_sources` shows it). Names can repeat (two queries on the same table both get the table's name when `source_name` is omitted); then pass the alias. Aliases of removed data sources are given to the next one added, so list again rather than reusing an old alias.

## What to know

- **Always pass `source_name`.** Without it Looker Studio names the data source after the first table in the query, so it looks like the real view and `data_source` can pick the wrong one.
- **Check field types.** Looker Studio guesses the type of each column and can get it wrong: a `COUNT(*)` column came in as a Date. Cast in the SQL (`CAST(COUNT(*) AS INT64) AS events`), fix it afterwards with `update_field` (`type: "Number"`, `aggregation: "sum"`), or use `Record Count` as the metric.
- **Validate the SQL first.** If Looker Studio rejects the query, the step times out with a screenshot instead of a clear message (`update_data_source` reports "The query returned an error" and keeps the old SQL, without BigQuery's reason). Run it with `run_query` and `dry_run: true` before adding it.
- **The query runs on every load.** Each chart that uses the source runs the SQL in BigQuery (with Looker Studio's cache, "Data freshness"). For a query reused by many charts or reports, prefer `create_view` and connect the view.
- **Credentials.** The data source uses the credentials of the account that added it, so editors of a shared report see the data without BigQuery access of their own. Anyone who edits the SQL needs access to the billing project. `update_data_source` with `credentials: "viewer"` makes every viewer use their own access instead; Looker Studio then asks each viewer, editors included, to grant consent before it loads data (the MCP declines that prompt for you).
- **Freshness.** Data freshness defaults to 12 hours; `update_data_source` sets `15 minutes`, `1 hour`, `4 hours` or `12 hours`. Fresher data runs the query more often.
- **No date range or viewer email parameters.** The connector's "Enable date range parameters" and "Enable viewer email address parameter" options stay off.
- **Linking API.** `build_report_link` sends the query as `type=CUSTOM_QUERY` with `sql`; long queries make long URLs, so keep them short there or use a view.
