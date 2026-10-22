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
| `date_range_params` | Ticks "Enable date range parameters": the query gets `@DS_START_DATE` and `@DS_END_DATE`. Only with `sql`. |
| `viewer_email_param` | Ticks "Enable viewer email address parameter": the query gets `@DS_USER_EMAIL`. Only with `sql`. |

Giving `sql` together with `dataset_id` or `table_id`, or `source_name`, `date_range_params` or `viewer_email_param` without `sql`, is an error.

## Validation

Before anything opens in the browser, the SQL is checked:

1. It must be a single `SELECT` (or `WITH ... SELECT`), with the same guard as `run_query`. Anything else is refused.
2. It is dry-run in BigQuery in the billing project. If BigQuery rejects it, the tool returns BigQuery's own message (`BigQuery rejected the custom query: Unrecognized name: nope at [1:8]`) and Looker Studio is never opened.
3. A query that uses `@DS_START_DATE`, `@DS_END_DATE` or `@DS_USER_EMAIL` without the matching option is refused: Looker Studio would not pass the parameter and every chart on the source would fail.

The dry run passes stand-in values for the parameters that are on (`20260101`, `20260131`, `viewer@example.com`). A dry run catches unknown columns and tables, syntax and type errors; errors that only happen when the query runs (an `ERROR()` call, a bad cast on some rows) still show up on the charts. Use `check_report` to find them.

## Parameters

With `date_range_params: true` the connector passes the date range of each chart (its own default date range, the page's or a date range control) as two **STRING** parameters in `YYYYMMDD` form:

```sql
SELECT feature, COUNT(*) AS uses
FROM `my-project.analytics.events`
WHERE event_date BETWEEN PARSE_DATE('%Y%m%d', @DS_START_DATE)
                     AND PARSE_DATE('%Y%m%d', @DS_END_DATE)
GROUP BY feature
```

On a partitioned table this filter also limits the partitions the query scans.

With `viewer_email_param: true` the connector passes the email address of the person viewing the report as the **STRING** `@DS_USER_EMAIL`, for row-level access:

```sql
SELECT region, revenue
FROM `my-project.sales.revenue`
WHERE region IN (SELECT region FROM `my-project.sales.access` WHERE email = @DS_USER_EMAIL)
```

Looker Studio asks every viewer once for consent to share their email with the report ("Grant consent"); until they allow it, the charts show "Consent required". The MCP gives that consent for the signed-in account when it adds the source, so the editor is not blocked afterwards. For the email to be the viewer's, the data source must use the owner's credentials (the default): with viewer's credentials the query runs as the viewer anyway.

Both options can be combined in one query.

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
- **Check field types.** Looker Studio guesses the type of each column and can get it wrong: a `COUNT(*)` column came in as a Date. Cast in the SQL (`CAST(COUNT(*) AS INT64) AS events`) or use `Record Count` as the metric.
- **Validation is automatic.** The SQL is dry-run before the editor opens (see [Validation](#validation)); you do not need `run_query` first.
- **The query runs on every load.** Each chart that uses the source runs the SQL in BigQuery (with Looker Studio's cache, "Data freshness"). For a query reused by many charts or reports, prefer `create_view` and connect the view.
- **Credentials.** The data source uses the credentials of the account that added it, so editors of a shared report see the data without BigQuery access of their own. Anyone who edits the SQL needs access to the billing project. `update_data_source` with `credentials: "viewer"` makes every viewer use their own access instead; Looker Studio then asks each viewer, editors included, to grant consent before it loads data (the MCP declines that prompt for you).
- **Freshness.** Data freshness defaults to 12 hours; `update_data_source` sets `15 minutes`, `1 hour`, `4 hours` or `12 hours`. Fresher data runs the query more often.
- **Linking API.** `build_report_link` sends the query as `type=CUSTOM_QUERY` with `sql`; long queries make long URLs, so keep them short there or use a view. The [Linking API](https://developers.google.com/looker-studio/integrate/linking-api) documents no parameter for the date range or viewer email options, so `build_report_link` refuses `date_range_params` and `viewer_email_param` (and a query that uses `@DS_*`). Create the report with `create_report` or `add_data_source` instead. The SQL of a link is dry-run like the others.
