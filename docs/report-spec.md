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
  "calculated_fields": [
    { "name": "Users", "formula": "COUNT_DISTINCT(user_id)", "data_source": "events" }
  ],
  "pages": [
    {
      "name": "Overview",
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
          "layout": { "x": 40, "y": 20, "width": 600, "height": 50 }
        },
        {
          "component": "chart",
          "type": "scorecard",
          "metrics": [{ "field": "Record Count", "label": "Events" }],
          "data_source": "events",
          "layout": { "x": 700, "y": 110, "width": 220, "height": 120 },
          "style": { "Border radius": "8" }
        },
        {
          "component": "chart",
          "type": "stacked_bar",
          "dimensions": ["feature"],
          "metrics": [{ "field": "Record Count", "label": "Uses" }],
          "breakdown": "platform",
          "title": "Uses by feature",
          "data_source": "events",
          "layout": { "x": 40, "y": 110, "width": 600, "height": 320 },
          "style": { "Display legend": true }
        },
        {
          "component": "control",
          "kind": "drop_down",
          "field": "platform",
          "data_source": "events",
          "layout": { "x": 700, "y": 250, "width": 300, "height": 50 }
        }
      ]
    },
    {
      "name": "Details",
      "components": [
        {
          "component": "chart",
          "type": "table",
          "dimensions": ["platform"],
          "metrics": [{ "field": "events", "aggregation": "sum" }],
          "data_source": "Events by platform",
          "layout": { "x": 40, "y": 40, "width": 500, "height": 300 }
        },
        { "component": "line", "from": { "x": 40, "y": 360 }, "to": { "x": 540, "y": 360 } }
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
| `calculated_fields` | The arguments of `add_calculated_field`. Never exported; write them by hand. |
| `pages` | In order. Each has a `name` and its `components`, back to front. |

Each component is the **arguments of the tool that adds it**, without `report_id` and `page`, plus `component`:

| `component` | Tool | Main arguments |
|---|---|---|
| `chart` | `add_chart` | `type`, `dimensions`, `metrics` (`field`, `aggregation`, `label`), `breakdown`, `sort_by`, `sort_ascending`, `fields`, `title`, `data_source`, filters, date range… |
| `text` | `add_text` | `text`, `font_size`, `color`, `bold`, `background`, `align` |
| `shape` | `add_shape` | `shape`, `background`, `border_color`, `border_radius` |
| `control` | `add_control` | `kind`, `field`, `metric`, `data_source` |
| `image` | `add_image` | `image` (an https URL) |
| `line` | `add_line` | `from`, `to`, `color`, `border_style` |
| `embed` | `add_embed` | `url` |
| `other` | none | `panel`: a component the spec cannot rebuild; kept for reference and skipped |

Components take `layout` (report px) and `style` (Style settings by their panel label, as in the tools). Anything a tool accepts works in a spec: the spec is validated with the tool's own schema.

## export_report_spec

```json
{ "report_id": "<report id or URL>", "style": "main" }
```

It opens the report once and reads:

- the report name, the theme name and the page size;
- each data source's connection (Edit Connection, left with Cancel): project, dataset and table, or the custom query. A data source that is not BigQuery is left out;
- the pages, and on each page every component: its kind and layout; for charts the chart type (the highlighted preset of "Chart types"), dimensions, metrics (source field, aggregation and display name, from each chip's field editor), breakdown, sort when it is not the default, extra Setup slots (`fields`), title, and data source when the report has several; for text its words, size, color, weight and alignment; for shapes the shape, fill, border and radius; for controls the kind, control field and metric; the URL of images and embeds; the ends of lines.

`style` sets what else each component keeps from its Style tab:

| `style` | Kept |
|---|---|
| `none` | Nothing |
| `main` (default) | Background, border color, radius and weight, opacity, shadow, data labels and legend, minus the values every new component already has |
| `all` | Every toggle and box of the Style tab (a repeated label as `"Font size#2"`). Large and slow to apply. |

Not exported: filters, date ranges, comparisons, conditional formatting, reference lines, series styles, value colors, display names of dimensions, calculated fields, parameters, blends, and uploaded images (they have no URL; exported as `other`). Report-level components are read on the page they show on. Add the rest to the spec by hand with the tools' arguments.

Reading opens every component: a page of ten charts takes a few minutes.

## apply_report_spec

```json
{ "spec": { "…": "…" }, "name": "Events overview (copy)" }
```

**Create** (no `report_id`): creates the report on the first data source, then in one visit applies the theme, adds the other data sources and calculated fields, renames the first page, adds the other pages and every component in order. Components keep their stacking because they are added back to front.

**Update** (`report_id`): adds what the report lacks and changes nothing else:

- data sources whose name the report does not have;
- calculated fields (all of them: one whose name exists fails that action);
- pages whose name the report does not have, at the end;
- components whose box (`layout`, within 4 px) no component of that page has. Lines have no box and are always added.

The spec's theme is applied again. Nothing is deleted, moved or restyled: change existing components with `update_component` (or `apply_actions`).

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
