# Report specs

A report spec is a JSON description of a report: its name, theme, data sources and pages, and on each page its components. `export_report_spec` reads one from a report; `apply_report_spec` builds a report from one, or adds what an existing report lacks. Use it to copy a report, to keep a report in version control, or to write a dashboard by hand and build it in one call.

Both run on `apply_actions`, so a spec is built in **one editor visit** instead of one per component.

## Shape

```json
{
  "version": 1,
  "name": "Events overview",
  "theme": { "preset": "Default", "canvas": { "width": 1200, "height": 900 } },
  "data_sources": [
    { "name": "events", "project_id": "my-project", "dataset_id": "analytics", "table_id": "events" },
    {
      "name": "Events by platform",
      "project_id": "my-project",
      "sql": "SELECT platform, CAST(COUNT(*) AS INT64) AS events FROM `my-project.analytics.events` GROUP BY platform"
    }
  ],
  "parameters": [
    { "name": "Target", "id": "target", "data_type": "Number (whole)", "default_value": "10", "data_source": "events" }
  ],
  "calculated_fields": [
    { "name": "Users", "formula": "COUNT_DISTINCT(user_id)", "data_source": "events" }
  ],
  "group_fields": [
    {
      "name": "Platform group",
      "field": "platform",
      "groups": [{ "name": "Mobile", "condition": "in", "values": ["android", "ios"] }],
      "other_group": "Other",
      "data_source": "events"
    }
  ],
  "bin_fields": [
    { "name": "Events bin", "field": "events", "size": 100, "min": 0, "max": 1000, "data_source": "Events by platform" }
  ],
  "blends": [
    {
      "name": "Events and totals",
      "tables": [
        { "data_source": "events", "dimensions": ["platform"], "metrics": ["Record Count"] },
        { "data_source": "Events by platform", "dimensions": ["platform"], "metrics": ["events"] }
      ],
      "joins": [{ "type": "left outer", "keys": [["platform", "platform"]] }]
    }
  ],
  "report_settings": {
    "filters": [{ "name": "Has platform", "field": "platform", "condition": "is_null", "exclude": true }]
  },
  "pages": [
    {
      "name": "Overview",
      "settings": {
        "data_source": "events",
        "date_range_dimension": "event_date",
        "date_range": "Last 28 days",
        "style": { "Page background": "#FAFAFA" }
      },
      "components": [
        {
          "component": "shape",
          "shape": "rectangle",
          "background": "#E8EAF6",
          "layout": { "x": 0, "y": 0, "width": 1200, "height": 90 }
        },
        {
          "component": "text",
          "text": "Events overview",
          "font_size": 28,
          "bold": true,
          "italic": true,
          "layout": { "x": 40, "y": 20, "width": 600, "height": 50 }
        },
        {
          "component": "image",
          "image": "overview-images/page1-2.png",
          "layout": { "x": 1040, "y": 15, "width": 120, "height": 60 }
        },
        {
          "component": "chart",
          "type": "scorecard",
          "metrics": [{ "field": "Record Count", "label": "Events" }],
          "comparison": "Previous period",
          "data_source": "events",
          "conditional_formats": [
            { "rules": [[{ "field": "Events", "condition": "lt", "value": "100" }]], "font_color": "#B71C1C" }
          ],
          "layout": { "x": 700, "y": 110, "width": 220, "height": 120 },
          "style": { "Border radius": "8" }
        },
        {
          "component": "chart",
          "type": "combo",
          "dimensions": ["event_date"],
          "metrics": [{ "field": "Record Count", "label": "Events" }, { "field": "Users" }],
          "title": "Events per day",
          "data_source": "events",
          "date_range": "2026-09-01..2026-10-15",
          "filters": [
            {
              "name": "Mobile",
              "clauses": [
                [
                  { "field": "platform", "condition": "equals", "values": ["android"] },
                  { "field": "platform", "condition": "equals", "values": ["ios"] }
                ]
              ]
            }
          ],
          "series": [
            { "metric": "Events", "type": "bars", "axis": "left", "color": "#4285F4" },
            { "metric": "Users", "type": "line", "axis": "right", "color": "#E91E63" }
          ],
          "reference_lines": [{ "value": 500, "label": "Target", "color": "#FF0000" }],
          "reference_bands": [{ "from": 0, "to": 100, "label": "Low", "color": "#FFF3E0" }],
          "layout": { "x": 40, "y": 110, "width": 600, "height": 320 },
          "style": { "Display legend": true }
        },
        {
          "component": "chart",
          "type": "pie",
          "dimensions": ["platform"],
          "metrics": [{ "field": "Record Count" }],
          "value_colors": { "android": "#3DDC84", "ios": "#0A84FF" },
          "data_source": "events",
          "layout": { "x": 700, "y": 250, "width": 300, "height": 200 }
        },
        {
          "component": "control",
          "kind": "drop_down",
          "field": "platform",
          "filters": [{ "name": "No web", "field": "platform", "condition": "equals", "values": ["web"], "exclude": true }],
          "data_source": "events",
          "layout": { "x": 700, "y": 470, "width": 300, "height": 50 }
        }
      ]
    },
    {
      "name": "Details",
      "components": [
        {
          "component": "chart",
          "type": "table",
          "dimensions": ["platform", "Events bin"],
          "metrics": [{ "field": "events", "aggregation": "sum" }],
          "labels": { "platform": "Platform" },
          "sort_by": "events",
          "sorts": [{ "field": "platform", "ascending": true }],
          "data_source": "Events by platform",
          "layout": { "x": 40, "y": 40, "width": 500, "height": 300 }
        },
        {
          "component": "chart",
          "type": "bar",
          "dimensions": ["platform"],
          "metrics": [{ "field": "Record Count" }],
          "data_source": "Events and totals",
          "layout": { "x": 600, "y": 40, "width": 500, "height": 300 }
        },
        {
          "component": "line",
          "from": { "x": 40, "y": 360 },
          "to": { "x": 540, "y": 360 },
          "color": "#3F51B5",
          "border_style": "Dashed"
        },
        {
          "component": "embed",
          "url": "https://example.com/",
          "layout": { "x": 40, "y": 380, "width": 500, "height": 200 }
        }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `version` | Always `1`. |
| `name` | Report name. `apply_report_spec` takes `name` to give the new report another one. |
| `theme` | The arguments of `set_theme`: `preset`, `settings`, `canvas`, `layout`. |
| `data_sources` | BigQuery tables (`project_id`, `dataset_id`, `table_id`) or custom queries (`project_id` as the billing project, `sql`). `name` is the data source name charts refer to; for a table it is the table id. The **first** one creates the report. |
| `parameters` | The arguments of `add_parameter`. |
| `calculated_fields` | The arguments of `add_calculated_field`, in the order of the data source editor. |
| `group_fields`, `bin_fields` | The arguments of `add_group_field` and `add_bin_field`. |
| `blends` | The arguments of `create_blend`. A chart uses a blend by naming it as its `data_source`. |
| `report_settings` | The arguments of `set_page_settings` with `scope: "report"` (File › Report settings): `data_source`, `filters`, `date_range_dimension`, `date_range`. |
| `pages` | In order. Each has a `name`, its `settings` (the arguments of `set_page_settings` for the page: `data_source`, `filters`, `date_range_dimension`, `date_range`, `style`) and its `components`, back to front. |

Fields, parameters, groups and bins take `data_source` when the report has several.

Each component is the **arguments of the tool that adds it**, without `report_id` and `page`, plus `component`:

| `component` | Tool | Main arguments |
|---|---|---|
| `chart` | `add_chart` | `type`, `dimensions`, `metrics` (`field`, `aggregation`, `label`), `labels` (dimension display names), `breakdown`, `sort_by`, `sort_ascending`, `sorts`, `fields`, `title`, `data_source`, `filters`, `date_range`, `comparison`, `series`, `value_colors`, `reference_lines`, `reference_bands`, `conditional_formats` |
| `text` | `add_text` | `text`, `font_size`, `color`, `bold`, `italic`, `underline`, `strikethrough`, `background`, `align` |
| `shape` | `add_shape` | `shape`, `background`, `border_color`, `border_radius` |
| `control` | `add_control` | `kind`, `field`, `metric`, `data_source`, `filters`, `date_range` |
| `image` | `add_image` | `image`: a file path (relative to the spec file), an https URL (Insert › Image › By URL) or a `data:image/…;base64,` URI; `alt_text` |
| `line` | `add_line` | `from`, `to`, `color`, `border_style` |
| `embed` | `add_embed` | `url` |
| `other` | none | `panel`: a component the spec cannot rebuild; kept for reference and skipped |

Components take `layout` (report px) and `style` (Style settings by their panel label, as in the tools). Anything a tool accepts works in a spec: the spec is validated with the tool's own schema.

A filter is written in full (`field`/`condition`/`values`/`exclude`, or `clauses`: AND groups of OR clauses) wherever it is used; the first use creates it and the others reuse it by name.

## export_report_spec

```json
{ "report_id": "<report id or URL>", "style": "main", "path": "~/specs/overview.json" }
```

It opens the report once and reads:

- the report name, the theme name and the page size;
- each data source's connection (Edit Connection, left with Cancel): project, dataset and table, or the custom query. A data source that is not BigQuery is left out;
- each data source's calculated fields (formula), group fields (groups, conditions, values, the group for the rest), bin fields (size, min, max) and parameters (id, type, permitted values, default), from the data source editor;
- the blends (Resource › Manage blends): each table's data source, dimensions and metrics, each join's type and keys;
- every filter of the report with its clauses (Resource › Manage filters), so charts, controls, pages and the report carry them in full;
- File › Report settings and each page's Page › Current page settings: data source, filters of their own, date range dimension, default date range, and the page background and size;
- the pages, and on each page every component: its kind and layout; for charts the chart type (the highlighted preset of "Chart types"), dimensions and their display names, metrics (source field, aggregation and display name, from each chip's field editor), breakdown, sort when it is not the default and Sort #2…, extra Setup slots (`fields`), title, data source when the report has several, filters, a custom date range (a preset, or fixed dates `YYYY-MM-DD..YYYY-MM-DD`), comparison, the series of each metric (Style › Series: bars or line, axis, color), reference lines and bands, conditional formatting rules (each rule's editor is opened and cancelled) and the dimension value colors (once, on the first chart colored by dimension values: they belong to the report); for text its words, size, color, bold, italic, underline, strikethrough and alignment (bold and italic come from the format buttons, not from the font); for shapes the shape, fill, border and radius; for controls the kind, control field, metric, filters and date range; images (below); for embeds the External Content URL; for lines the ends, color and style.

**Images.** Looker Studio keeps every image as a file, also the ones inserted "By URL" (it downloads them), and only shows their URL cut to 30 characters. An image whose whole URL is shown is exported by URL; any other is exported as its bytes, read from the canvas: with `path`, saved next to the spec (`<name>-images/page1-2.png`) and named relative to it; without `path`, embedded as a `data:` URI up to 512 KB (a larger one is kept as `other`).

With `path` the spec is also written to that file; `apply_report_spec` takes it as `spec_path`.

`style` sets what else each component keeps from its Style tab:

| `style` | Kept |
|---|---|
| `none` | Nothing |
| `main` (default) | Background, border color, radius and weight, opacity, shadow, data labels and legend, minus the values every new component already has |
| `all` | Every toggle and box of the Style tab (a repeated label as `"Font size#2"`). Large and slow to apply. |

Not exported: color scale conditional formats (the reply says how many), custom-sized bins, range parameters, community visualizations (`other`). Report-level components are read on the page they show on. A part that cannot be read (a dialog that would not open) is left out and named in the reply.

Reading opens every component, field and filter: a two-page report of ten charts takes about ten minutes.

## apply_report_spec

```json
{ "spec_path": "~/specs/overview.json", "name": "Events overview (copy)" }
```

`spec` takes the spec itself instead of `spec_path`; its relative image paths then start from the server's working folder.

**Create** (no `report_id`): creates the report on the first data source, then in one visit applies the theme, adds the other data sources, the parameters, calculated fields, group and bin fields and blends, renames the first page, adds the other pages and every component in order, each page's settings after its components (page filters need a chart with data), and the report settings last. Components keep their stacking because they are added back to front.

**Update** (`report_id`): adds what the report lacks and changes nothing else:

- data sources whose name the report does not have;
- parameters, calculated, group and bin fields whose name their data source does not have (read from each data source editor first);
- blends whose name the report does not have;
- pages whose name the report does not have, at the end, with their settings;
- components whose box (`layout`, within 4 px; a line's box runs from end to end) no component of that page has.

The spec's theme is applied again. The settings of pages that exist and the report settings are left as they are (the reply says so). Nothing is deleted, moved or restyled: change existing components with `update_component` (or `apply_actions`).

Every action is validated before the browser opens. It stops at the first failed action unless `continue_on_error`; the reply lists each action with its result and time, and the components it skipped.

## apply_actions

`apply_report_spec` builds a list of `apply_actions` actions. To edit a report quickly without a spec, call `apply_actions` directly:

```json
{
  "report_id": "<report id or URL>",
  "actions": [
    { "tool": "add_page", "args": { "name": "Details" } },
    { "tool": "add_text", "args": { "text": "Details", "font_size": 24, "page": 2 } },
    { "tool": "update_component", "args": { "index": 0, "style": { "Background": "#F5F5F5" } } }
  ]
}
```

Actions without `page` run on the first page, as their tool does on its own. Inside the visit the editor waits for the network to go quiet instead of a fixed 5 s per step, which is most of the time saved.
