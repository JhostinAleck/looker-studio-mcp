# Changelog

## Unreleased

- Fix: charts drawn in an iframe (bar, column, line, pie and other Vega charts) were selected with a selection box that also took, or dragged, overlapping components, so `add_chart` over a text box failed with "Multiple Properties" and a failure cleanup or `delete_component` could delete the other components too. Selection now clicks through the iframe, resizes and moves let drags pass over iframes, and deletes refuse a multiple selection and undo a Delete that removed more than one component.
- `update_data_source` dry-runs a new `sql` in `project_id` (or the config's project) before opening the editor; `copy_report` dry-runs custom query replacements and refuses non-BigQuery ones.
- New tool `add_community_viz`: community visualizations from the gallery by name or from a gs:// manifest, with the consent prompt accepted and data source, dimensions, metrics and Setup slots set like a chart.
- `create_report`, `add_data_source` and `build_report_link` take `connector`: Google Sheets (spreadsheet URL or id, worksheet, header/hidden-cells options, range; Linking API by worksheet gid) and PostgreSQL/MySQL (host, port, database, user, password, SSL, table or custom query; not verified end to end). BigQuery stays the default; passwords are redacted from the audit log.
- New tool `check_report`: lists the charts of every page (or one page) that show "No data", configuration errors, data set errors (Too Many Rows, BigQuery query errors with their message) or are still loading, with page, index, kind, fields and the "See details" text.
- Custom queries take `date_range_params` (`@DS_START_DATE`, `@DS_END_DATE`) and `viewer_email_param` (`@DS_USER_EMAIL`); the viewer email consent is given for the signed-in account. `build_report_link` refuses them: the Linking API has no parameter for them.
- `create_report`, `add_data_source` and `build_report_link` dry-run a custom query in BigQuery first and return BigQuery's error without opening the browser; only a single SELECT is accepted.
- New tool `list_data_sources`: name, alias, connector, table or custom query SQL, charts using it, data credentials and freshness of every data source; `fields: true` lists field types and aggregations.
- New tool `remove_data_source`: removes a data source by name or alias, refusing while charts use it unless `force: true`.
- New tool `update_data_source`: renames a data source, replaces a custom query's SQL (Reconnect), sets data credentials and data freshness.
- New tool `update_field`: changes a field's type, default aggregation or name in the data source editor (e.g. a `COUNT(*)` column typed as Date).
- New tool `apply_actions`: runs a list of editing actions in one editor visit, validated before the browser opens, with a result per action.
- New tool `export_report_spec`: reads a report (theme, data sources, pages, components) into a JSON spec.
- New tool `apply_report_spec`: builds a report from a spec, or adds the missing pages and components to an existing one (docs/report-spec.md).
- New tool `copy_report`: File › Make a copy under a new name, optionally reconnecting embedded data sources of the copy to another table, view or custom query; returns the new id and URL.
- New tool `set_link_sharing`: Share › Link settings to restricted, unlisted (anyone with the link) or public, with the role of people with the link.
- New tool `schedule_delivery`: Share › Schedule delivery (recipients, start date, time, repeat, pages); creates or replaces the report's schedule.
- New tool `list_deliveries`: shows the report's email delivery schedule.
- New tool `remove_delivery`: deletes the report's email delivery schedule.
- New tool `list_versions`: File › Version history, newest first, with index, name or date and authors.
- New tool `restore_version`: restores a version by index or label.
- New tool `get_embed_code`: File › Embed report: turns embedding on if needed and returns the iframe code and embed URL (size, page, navigation).
- `create_report`, `add_data_source` and `build_report_link` take a custom query: `sql` instead of `dataset_id` and `table_id`, with `project_id` as the billing project. `source_name` names the data source; without it Looker Studio names it after the first table in the query.
- Filters take several clauses (`clauses`: AND groups of OR clauses). Filter values are typed with the editor's suggestions off: with them on, a typed value that the editor could not suggest was dropped and the filter was saved empty.
- `date_range` takes fixed dates (`2026-10-01..2026-10-15`).
- Charts and `update_component` take `sorts` (Sort #2…), `reference_lines`, `reference_bands` and `conditional_formats`; pivots sort their first row dimension by `sort_by`.
- `update_component` takes `chart_type` (switch a chart to another type), `button` and `embed_url`; `add_control` takes `button` (link to a URL or a page, or a report action).
- New preset `scorecard_dimension`; `add_shape` draws block arrows and callouts.
- New tools: `add_line`, `add_embed`, `duplicate_component`, `arrange_components`, `manage_page`, `set_page_settings` (page and report filters and dates), `manage_filter`, `add_parameter`, `add_group_field`, `add_bin_field`, `create_blend`.
- `rename_page` renames the only page of a report (through a temporary second page).
- Menus prefer an exact label: Insert › Line no longer opens "Line map".
- `add_chart` covers all 48 chart presets of Looker Studio (pivot and table heatmaps, funnels, waterfalls, sankeys, bullets, histograms, timelines, maps…).
- Charts, controls and `update_component` take `fields` (any Setup slot by heading: column dimension, sparkline, weight metric…), `filters` (new or existing), `date_range` presets, `comparison` periods, combo `series` (bars/line, left/right axis, color) and `value_colors`.
- New tools: `add_control` (11 filter controls), `add_image` (local file or URL), `add_calculated_field`.
- Pivot tables sort rows by their first dimension and get extra Setup slots before metrics are renamed (a pivot built with a relabeled metric lost its column field and showed "Invalid configuration").
- `update_component` finds the component again after `report_level`, which moves it to the top of the stack.
- Connecting a BigQuery table asks for the dataset list again when it does not load.
- `rename_page` names existing pages (the labels of tab navigation).
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
