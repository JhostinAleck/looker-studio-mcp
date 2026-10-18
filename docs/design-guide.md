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
{"tool": "add_text", "text": "CampusFind", "font_size": 32, "color": "#FFFFFF", "bold": true,
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

## Finding the right setting

1. `describe_component` on the component: it prints every toggle, field and radio of the Setup and Style tabs with its current value.
2. Pass those labels to `style`/`setup`. A label that appears twice (two "Show axis title" switches, one per axis) is addressed as `"Show axis title#2"`.
3. Anything the panel did not have comes back under "Not applied" — nothing fails silently.

## Checking your work

Call `screenshot_report` after each block. It renders the page in view mode with real data, so it shows what the audience will see: wrong fields, "Too many rows", clipped labels, overlaps.
