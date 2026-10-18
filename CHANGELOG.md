# Changelog

## Unreleased

- `add_chart` covers all 48 chart presets of Looker Studio (pivot and table heatmaps, funnels, waterfalls, sankeys, bullets, histograms, timelines, maps…).
- Charts, controls and `update_component` take `fields` (any Setup slot by heading: column dimension, sparkline, weight metric…), `filters` (new or existing), `date_range` presets, `comparison` periods, combo `series` (bars/line, left/right axis, color) and `value_colors`.
- New tools: `add_control` (11 filter controls), `add_image` (local file or URL), `add_calculated_field`.
- `set_theme` takes `layout` settings, e.g. tab navigation between pages.
- `refresh_data_source` and `add_calculated_field` share the data source editor flow.
- `share_report` takes a list of emails, invites them one by one in a visible window (Google refuses headless invitations) and changes the role of people who already have access.
- Text boxes move with Shift+Arrow when a drag does not move them.
- Editor step errors name the element they were waiting for.

## 0.1.0 — 2026-10-17

First version.

### BigQuery
- `list_datasets`, `list_tables`, `describe_table`, `run_query` (read-only, byte cap, dry run).
- `create_view`, `delete_view` (dry-run validated).

### Looker Studio reports
- `create_report`, `add_data_source`, `refresh_data_source`, `list_reports`, `rename_report`, `share_report`, `delete_report` (name confirmation), `build_report_link`.
- Design tools: `add_chart` (17 chart types, aggregation, metric display names, breakdown, sort, title, layout, Style settings), `add_text`, `add_shape` (10 shapes), `update_component` (layout, Style/Setup settings, field labels, restacking, report-level), `delete_component`, `set_theme` (presets, theme settings, page size).
- Inspection: `list_components`, `describe_component`, `screenshot_report` (full page, view mode).
- `add_page`, `list_report_pages`.

### Infrastructure
- `login` signs in with regular Chrome into a dedicated profile; automation reuses it.
- Writes gated by config and flag, audited to `audit.ndjson`, with dry run.
