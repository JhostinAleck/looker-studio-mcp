# Checking a report

`check_report` opens a report in the editor, waits for the charts of each page to load and lists every chart or control that shows something other than data. Use it after building or changing a report, or after a change to a table, view or custom query that charts depend on.

```json
{ "report_id": "<report id or URL>", "page": 2, "timeout_seconds": 30 }
```

| Field | Meaning |
|---|---|
| `report_id` | Report id or any URL of the report. |
| `page` | 1-based page to check. Every page when omitted. |
| `timeout_seconds` | How long to wait per page for charts to load (5 to 300, default 30). Charts still loading after that are reported as `loading`. |

## Result

A count of the charts and controls that are fine, then one line per problem:

```
Checked 2 pages: 3 of 7 charts and controls OK.

4 with problems:
- page 1 "Overview", #0 Table "Uses by feature" (Dimension: feature, Metric: Record Count, Filter: Android only): **no data**: No data
- page 1 "Overview", #1 Time series (Dimension - X axis: occurred_at, Metric - Y axis: Record Count): **data set**: Too Many Rows: Due to the number of rows, the chart cannot be rendered.
  Details: Sorry, please try other metrics or dimensions with fewer rows, try a different data source, or add a filter.
- page 1 "Overview", #2 Bar chart (Dimension - Y axis: Invalid dimension, Metric - X axis: Record Count): **configuration**: Invalid dimension: This chart has an invalid dimension
  Details: To update the chart, select a valid combination of dimensions and metrics in the properties panel
- page 2 "Detail", #1 Table (Dimension: feature, Metric: one): **data set**: User Configuration Error: This data source was improperly configured.
  Details: The query returned an error. / Division by zero: 1 / 0 / Error ID: ec0aac3d
```

Each line gives the page (number and name), the component index (the one `list_components`, `describe_component` and `update_component` take), the kind, the chart title when it shows one, the fields in its Setup slots, the problem and the message on the chart. `Details` is the text of the chart's "See details" dialog: for a query that failed in BigQuery it holds BigQuery's error message.

| Problem | What the chart shows | Usual fix |
|---|---|---|
| `no data` | "No data" | A filter, a date range or a page/report filter that matches no rows. Check values with `run_query`. |
| `configuration` | "Invalid dimension", "Invalid metric", "Invalid configuration", "Missing fields"… | A field the chart uses is gone (a column dropped from the table or the custom query) or the combination is not valid for the chart type. Replace the field with `update_component`. |
| `data set` | "Too Many Rows", "User Configuration Error", "Data Set Configuration Error", "System error" | Too many rows: aggregate (a time series on a raw timestamp needs a `DATE(...)` column). Query errors: fix the SQL or the view; `Details` has BigQuery's message. |
| `consent` | "Consent required" | A viewer email source the account has not allowed yet: open the report and click Allow. |
| `loading` | The loading shimmer, after `timeout_seconds` | A slow query. Check its cost with `run_query` and `dry_run`, or raise the timeout. |

A scorecard whose filter matches no rows shows `0` (Record Count), not "No data", so it counts as fine. Texts, shapes, lines and images have no data and are not counted.

## What to know

- It runs in the editor, like `list_components`, so the account needs edit access. It changes nothing.
- It takes a few seconds per page plus a few per problem: the "See details" dialog and the Setup panel of each broken chart are read one by one.
- Messages are those of the English editor (`hl=en`).
