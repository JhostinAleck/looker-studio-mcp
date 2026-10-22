# Custom queries

A data source can be a SQL query instead of a table or view. `create_report`, `add_data_source` and `build_report_link` take it the same way.

## Usage

Pass `sql` instead of `dataset_id` and `table_id`:

```json
{
  "report_id": "ea5c49bf-2a70-4210-bbd1-a54a7af50b42",
  "sql": "SELECT platform, CAST(COUNT(*) AS INT64) AS events FROM `campusfind-26ac2.campusfind_analytics.bq_feature_usage` GROUP BY platform",
  "source_name": "Events by platform"
}
```

| Field | Meaning |
|---|---|
| `sql` | A GoogleSQL `SELECT`. Use fully qualified table names (`project.dataset.table`). |
| `project_id` | The **billing project** the query runs in. Defaults to `project_id` in the config. It must be in the account's billing project list in the BigQuery connector. |
| `source_name` | Name of the data source in the report. Only with `sql`. |

Giving `sql` together with `dataset_id` or `table_id`, or `source_name` without `sql`, is an error.

Once added, a custom query is an ordinary data source: charts, controls, filters, calculated fields, parameters and blends pick it by name with `data_source`, and `refresh_data_source` re-reads its fields after the SQL's columns change.

## What to know

- **Always pass `source_name`.** Without it Looker Studio names the data source after the first table in the query, so it looks like the real view and `data_source` can pick the wrong one.
- **Check field types.** Looker Studio guesses the type of each column and can get it wrong: a `COUNT(*)` column came in as a Date. Cast in the SQL (`CAST(COUNT(*) AS INT64) AS events`) or use `Record Count` as the metric.
- **Validate the SQL first.** If Looker Studio rejects the query, the step times out with a screenshot instead of a clear message. Run it with `run_query` and `dry_run: true` before adding it.
- **The query runs on every load.** Each chart that uses the source runs the SQL in BigQuery (with Looker Studio's cache, "Data freshness"). For a query reused by many charts or reports, prefer `create_view` and connect the view.
- **Credentials.** The data source uses the credentials of the account that added it, so editors of a shared report see the data without BigQuery access of their own. Anyone who edits the SQL needs access to the billing project.
- **No date range or viewer email parameters.** The connector's "Enable date range parameters" and "Enable viewer email address parameter" options stay off.
- **Linking API.** `build_report_link` sends the query as `type=CUSTOM_QUERY` with `sql`; long queries make long URLs, so keep them short there or use a view.
