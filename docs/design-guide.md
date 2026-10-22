# Designing dashboards with looker-studio-mcp

How to get a polished report out of the tools, not just a correct one. Everything here was checked against the live editor.

## The canvas

- Default page: **1200 × 900 px**. `set_theme` with `canvas: {width, height}` changes it (a long scrolling page: 1200 × 1600).
- `layout` is `{x, y, width, height}` in report pixels, top-left origin. Work on a **20 px grid** with a **40 px outer margin** and **20 px gutters**.
- Components stack in the order they were added: later ones are on top. `list_components` reports them back to front. Restack with `update_component` → `order: "front" | "back" | "forward" | "backward"` (the index changes; the result tells you the new one).
- A component that should appear on every page (header, logo, navigation): `update_component` → `report_level: true`.

## A layout that works

```
y=0    ┌──────────────── header band (shape 1200×100) ────────────────┐
       │  Title 32px bold            subtitle 15px muted        dot  │
y=124  ├── KPI 360×120 ──┬── KPI 360×120 ──┬── KPI 360×120 ──┤
y=268  ├──── main chart 740×380 ────────────┬── side chart 360×380 ──┤
y=672  ├──── table 1120×200 ──────────────────────────────────────────┤
y=900  └──────────────────────────────────────────────────────────────┘
x:     40               420               800                     1160
```

## Colors and type

A dark scheme that reads well on projectors and screenshots:

| Role | Value |
|---|---|
| Page background (theme `Report background color`) | `#0B1020` |
| Header band | `#111833` |
| Cards (chart/scorecard `Background`, same `Border color`) | `#151B33` |
| Accent (bars, dot) | `#7C4DFF` |
| Title text | `#FFFFFF`, 30–32 px, bold |
| Secondary text | `#9AA4C7`, 14–15 px |

For a light report: theme `Simple`, background `#F6F7FB`, cards `#FFFFFF` with `Add border shadow: true`, text `#1B1F3B`.

## Recipes

**Theme**

```json
{"tool": "set_theme", "preset": "Constellation", "settings": {"Report background color": "#0B1020"}}
```

**Header band + title**

```json
{"tool": "add_shape", "shape": "rectangle", "background": "#111833", "border_radius": 0,
 "layout": {"x": 0, "y": 0, "width": 1200, "height": 100}, "style": {"Border color": "#111833"}}
{"tool": "add_text", "text": "My dashboard", "font_size": 32, "color": "#FFFFFF", "bold": true,
 "layout": {"x": 40, "y": 14, "width": 400, "height": 50}}
```

**KPI card** — the scorecard is its own card; no shape behind it needed:

```json
{"tool": "add_chart", "type": "scorecard", "dimensions": [],
 "metrics": [{"field": "uid", "aggregation": "count_distinct", "label": "Active students"}],
 "layout": {"x": 420, "y": 124, "width": 360, "height": 120},
 "style": {"Background": "#151B33", "Border color": "#151B33", "Border radius": 16}}
```

**Ranked bars**

```json
{"tool": "add_chart", "type": "bar", "dimensions": ["feature_label"], "metrics": [{"field": "Record Count"}],
 "title": "Uses per feature", "layout": {"x": 40, "y": 268, "width": 740, "height": 380},
 "style": {"Bar color": "#7C4DFF", "Show data labels": true, "Display legend": false,
           "Background": "#151B33", "Border color": "#151B33", "Border radius": 16}}
```

**Table with readable headers**

```json
{"tool": "add_chart", "type": "table", "dimensions": ["feature_label"],
 "metrics": [{"field": "Record Count", "label": "Uses"}, {"field": "uid", "aggregation": "count_distinct", "label": "Students"}],
 "sort_by": "Record Count", "layout": {"x": 40, "y": 672, "width": 1120, "height": 200}}
{"tool": "update_component", "index": 8, "labels": {"feature_label": "Feature"}}
```

**Filter bar and logo**

```json
{"tool": "add_control", "kind": "date_range", "date_range": "Last 28 days",
 "layout": {"x": 760, "y": 30, "width": 260, "height": 40}}
{"tool": "add_control", "kind": "drop_down", "field": "platform",
 "layout": {"x": 520, "y": 30, "width": 220, "height": 40}}
{"tool": "add_image", "image": "/path/to/logo.png", "layout": {"x": 1060, "y": 20, "width": 100, "height": 60}}
```

**KPI with change vs. the previous period and a sparkline**

```json
{"tool": "add_chart", "type": "scorecard", "dimensions": [],
 "metrics": [{"field": "Record Count", "label": "Uses"}],
 "comparison": "Previous period", "fields": {"Sparkline": ["occurred_on"]},
 "style": {"Positive change color": "#2E7D32", "Negative change color": "#C62828"}}
```

**Heatmap matrix** (rows × columns, colored by value)

```json
{"tool": "add_chart", "type": "pivot_heatmap", "dimensions": ["feature_label"],
 "metrics": [{"field": "Record Count"}], "fields": {"Column dimension": ["platform"]}}
```

**Bars and a line on a second axis**

```json
{"tool": "add_chart", "type": "combo", "dimensions": ["occurred_on"],
 "metrics": [{"field": "Record Count", "label": "Uses"}, {"field": "uid", "aggregation": "count_distinct", "label": "Students"}],
 "series": [{"metric": "Uses", "type": "bars", "color": "#7C4DFF"},
            {"metric": "Students", "type": "line", "axis": "right", "color": "#FF6D00"}]}
```

**Fixed colors per value and chart filters**

```json
{"tool": "add_chart", "type": "donut", "dimensions": ["platform"], "metrics": [{"field": "Record Count"}],
 "value_colors": {"android": "#3DDC84", "ios": "#0A84FF"}}
{"tool": "add_chart", "type": "table", "dimensions": ["feature_label"], "metrics": [{"field": "Record Count"}],
 "filters": [{"name": "Android only", "field": "platform", "condition": "equals", "values": ["android"]}]}
```

**Targets and alerts**: a reference line on the trend and red cells when a value crosses it

```json
{"tool": "add_chart", "type": "line", "dimensions": ["occurred_on"], "metrics": [{"field": "Record Count"}],
 "reference_lines": [{"value": 50, "label": "Goal", "color": "#C62828"}],
 "reference_bands": [{"from": 30, "to": 50, "color": "#FFF3E0"}]}
{"tool": "add_chart", "type": "table", "dimensions": ["feature_label"], "metrics": [{"field": "Record Count"}],
 "conditional_formats": [{"rules": [[{"field": "Record Count", "condition": "lt", "value": "10"}]],
                          "background_color": "#FFEBEE", "font_color": "#B71C1C"}]}
```

**One filter for the whole page** instead of one per chart:

```json
{"tool": "set_page_settings", "scope": "page", "page": 1, "date_range_dimension": "occurred_on",
 "date_range": "Last 28 days",
 "filters": [{"name": "Mobile", "clauses": [[{"field": "platform", "condition": "in", "values": ["android", "ios"]}]]}]}
```

**Tabs between pages**: `set_theme` with `"layout": {"Navigation type": "Tab"}`.

## Finding the right setting

1. `describe_component` on the component: it prints every toggle, field and radio of the Setup and Style tabs with its current value.
2. Pass those labels to `style`/`setup`. A label that appears twice (two "Show axis title" switches, one per axis) is addressed as `"Show axis title#2"`.
3. Anything the panel did not have comes back under "Not applied" — nothing fails silently.

## Checking your work

Call `screenshot_report` after each block. It renders the page in view mode with real data, so it shows what the audience will see: wrong fields, "Too many rows", clipped labels, overlaps.

When the report is done, run `check_report`: it lists every chart that shows "No data", a configuration error or a data set error on any page, with the fields and Looker's details ([docs/check-report.md](check-report.md)).
