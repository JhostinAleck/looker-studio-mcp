# Changelog

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
