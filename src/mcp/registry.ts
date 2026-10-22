import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodObject, ZodRawShape } from 'zod';

import * as schemas from './schemas.js';
import { errorResult, type ToolResult, type WriteDeps } from './tool-helpers.js';
import type { BigQueryToolDeps } from './tools/bigquery-deps.js';
import type { ReportToolDeps } from './tools/reports-deps.js';
import { handleAddLine } from './tools/add-line.tool.js';
import { handleAddEmbed } from './tools/add-embed.tool.js';
import { handleDuplicateComponent } from './tools/duplicate-component.tool.js';
import { handleArrangeComponents } from './tools/arrange-components.tool.js';
import { handleManagePage } from './tools/manage-page.tool.js';
import { handleSetPageSettings } from './tools/set-page-settings.tool.js';
import { handleManageFilter } from './tools/manage-filter.tool.js';
import { handleAddParameter } from './tools/add-parameter.tool.js';
import { handleAddGroupField } from './tools/add-group-field.tool.js';
import { handleAddBinField } from './tools/add-bin-field.tool.js';
import { handleCreateBlend } from './tools/create-blend.tool.js';
import { handleAddCalculatedField } from './tools/add-calculated-field.tool.js';
import { handleAddChart } from './tools/add-chart.tool.js';
import { handleAddControl } from './tools/add-control.tool.js';
import { handleAddDataSource } from './tools/add-data-source.tool.js';
import { handleAddImage } from './tools/add-image.tool.js';
import { handleAddPage } from './tools/add-page.tool.js';
import { handleAddShape } from './tools/add-shape.tool.js';
import { handleAddText } from './tools/add-text.tool.js';
import { handleBuildReportLink } from './tools/build-report-link.tool.js';
import { handleCheckAuth, type CheckAuthDeps } from './tools/check-auth.tool.js';
import { handleCreateReport } from './tools/create-report.tool.js';
import { handleCreateView } from './tools/create-view.tool.js';
import { handleDeleteComponent } from './tools/delete-component.tool.js';
import { handleDeleteReport } from './tools/delete-report.tool.js';
import { handleDescribeComponent } from './tools/describe-component.tool.js';
import { handleDeleteView } from './tools/delete-view.tool.js';
import { handleDescribeTable } from './tools/describe-table.tool.js';
import { handleListComponents } from './tools/list-components.tool.js';
import { handleListDatasets } from './tools/list-datasets.tool.js';
import { handleListReportPages } from './tools/list-report-pages.tool.js';
import { handleListReports } from './tools/list-reports.tool.js';
import { handleListTables } from './tools/list-tables.tool.js';
import { handleRefreshDataSource } from './tools/refresh-data-source.tool.js';
import { handleRenamePage } from './tools/rename-page.tool.js';
import { handleRenameReport } from './tools/rename-report.tool.js';
import { handleRunQuery } from './tools/run-query.tool.js';
import { handleScreenshotReport } from './tools/screenshot-report.tool.js';
import { handleSetTheme } from './tools/set-theme.tool.js';
import { handleShareReport } from './tools/share-report.tool.js';
import { handleUpdateComponent } from './tools/update-component.tool.js';
import { handleAddCommunityViz } from './tools/add-community-viz.tool.js';
import { handleCheckReport } from './tools/check-report.tool.js';
import { handleListDataSources } from './tools/list-data-sources.tool.js';
import { handleRemoveDataSource } from './tools/remove-data-source.tool.js';
import { handleUpdateDataSource } from './tools/update-data-source.tool.js';
import { handleUpdateField } from './tools/update-field.tool.js';
import { handleApplyActions } from './tools/apply-actions.tool.js';
import { BATCHABLE_TOOLS } from './tools/batch-actions.js';
import { handleExportReportSpec } from './tools/export-report-spec.tool.js';
import { handleApplyReportSpec } from './tools/apply-report-spec.tool.js';
import { handleCopyReport } from './tools/copy-report.tool.js';
import { handleSetLinkSharing } from './tools/set-link-sharing.tool.js';
import { handleScheduleDelivery } from './tools/schedule-delivery.tool.js';
import { handleListDeliveries } from './tools/list-deliveries.tool.js';
import { handleRemoveDelivery } from './tools/remove-delivery.tool.js';
import { handleListVersions } from './tools/list-versions.tool.js';
import { handleRestoreVersion } from './tools/restore-version.tool.js';
import { handleGetEmbedCode } from './tools/get-embed-code.tool.js';

export interface ToolDeps extends BigQueryToolDeps, ReportToolDeps, CheckAuthDeps, WriteDeps {}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  schema: ZodObject<ZodRawShape>;
  write: boolean;
  run: (deps: ToolDeps, input: unknown) => Promise<ToolResult> | ToolResult;
}

const TOOLS: ToolDef[] = [
  {
    name: 'check_auth',
    title: 'Check authentication',
    description:
      'Check the Google API credentials (BigQuery) and the signed-in Looker Studio browser profile.\nUse first when other tools fail with auth errors.',
    schema: schemas.checkAuthSchema,
    write: false,
    run: (deps) => handleCheckAuth(deps),
  },
  {
    name: 'list_datasets',
    title: 'List BigQuery datasets',
    description: 'List the BigQuery datasets of a Google Cloud project.',
    schema: schemas.listDatasetsSchema,
    write: false,
    run: handleListDatasets,
  },
  {
    name: 'list_tables',
    title: 'List tables and views',
    description: 'List the tables and views of a BigQuery dataset.',
    schema: schemas.listTablesSchema,
    write: false,
    run: handleListTables,
  },
  {
    name: 'describe_table',
    title: 'Describe a table or view',
    description: 'Show the fields of a table or view, its row count and, for views, the SQL.',
    schema: schemas.describeTableSchema,
    write: false,
    run: handleDescribeTable,
  },
  {
    name: 'run_query',
    title: 'Run a read-only query',
    description:
      'Run one SELECT in GoogleSQL and return the rows as a table. Writes are refused.\nUse dry_run to check a query and how many bytes it scans before running it.',
    schema: schemas.runQuerySchema,
    write: false,
    run: handleRunQuery,
  },
  {
    name: 'list_reports',
    title: 'List Looker Studio reports',
    description:
      'List the Looker Studio reports of the signed-in account, optionally filtered by name.',
    schema: schemas.listReportsSchema,
    write: false,
    run: handleListReports,
  },
  {
    name: 'list_report_pages',
    title: 'List report pages',
    description: 'List the pages of a Looker Studio report.',
    schema: schemas.listReportPagesSchema,
    write: false,
    run: handleListReportPages,
  },
  {
    name: 'screenshot_report',
    title: 'Screenshot a report',
    description: 'Take a PNG of a report page in view mode, to check charts after editing.',
    schema: schemas.screenshotReportSchema,
    write: false,
    run: handleScreenshotReport,
  },
  {
    name: 'list_components',
    title: 'List page components',
    description:
      'List the charts, texts and shapes of a report page with their index, kind and layout (x, y, width, height in px).\nIndexes go back to front; other component tools take them.',
    schema: schemas.listComponentsSchema,
    write: false,
    run: handleListComponents,
  },
  {
    name: 'describe_component',
    title: 'Describe a component',
    description:
      'Show every Setup and Style setting of one component with its exact label and current value.\nUse it to learn the labels update_component and the style options accept.',
    schema: schemas.describeComponentSchema,
    write: false,
    run: handleDescribeComponent,
  },
  {
    name: 'build_report_link',
    title: 'Build a report link',
    description:
      'Build a Looker Studio Linking API URL that creates a report (blank or copied from a template) connected to BigQuery tables, views or custom queries (sql), or to Google Sheets (connector google_sheets with spreadsheet and worksheet_id, the gid). The user opens it to confirm. The Linking API has no PostgreSQL or MySQL connector.',
    schema: schemas.buildReportLinkSchema,
    write: false,
    run: handleBuildReportLink,
  },
  {
    name: 'create_view',
    title: 'Create or replace a view',
    description:
      'Save a SELECT as a BigQuery view (dry-run checked first). Views are the cleanest data source for a report: one per business question.',
    schema: schemas.createViewSchema,
    write: true,
    run: handleCreateView,
  },
  {
    name: 'delete_view',
    title: 'Delete a view',
    description: 'Delete a BigQuery view. Refuses tables.',
    schema: schemas.deleteViewSchema,
    write: true,
    run: handleDeleteView,
  },
  {
    name: 'create_report',
    title: 'Create a report',
    description:
      'Create a Looker Studio report connected to a BigQuery table or view, or to a custom query: pass sql (and optionally source_name) instead of dataset_id and table_id. Other connectors: connector google_sheets (spreadsheet, worksheet, options, range) or postgresql/mysql (host, port, database, user, password, ssl, and table_id or sql).\nThe SQL is dry-run in BigQuery first; date_range_params and viewer_email_param pass @DS_START_DATE/@DS_END_DATE and @DS_USER_EMAIL to it.',
    schema: schemas.createReportSchema,
    write: true,
    run: handleCreateReport,
  },
  {
    name: 'add_data_source',
    title: 'Add a data source',
    description:
      'Connect another BigQuery table or view to an existing report, or a custom query: pass sql instead of dataset_id and table_id. project_id is then the billing project; source_name names the data source (Looker Studio otherwise names it after the first table in the query). Other connectors: connector google_sheets (spreadsheet URL or id, worksheet, use_first_row_as_headers, include_hidden_and_filtered_cells, range) or postgresql/mysql (host, port, database, user, password, ssl, and table_id or sql).\nThe SQL is dry-run in BigQuery first; date_range_params and viewer_email_param pass @DS_START_DATE/@DS_END_DATE and @DS_USER_EMAIL to it.',
    schema: schemas.addDataSourceSchema,
    write: true,
    run: handleAddDataSource,
  },
  {
    name: 'refresh_data_source',
    title: 'Refresh data source fields',
    description:
      "Re-read the fields of the report's data sources after a column was added to a BigQuery table or view (Looker Studio caches the field list).",
    schema: schemas.refreshDataSourceSchema,
    write: true,
    run: handleRefreshDataSource,
  },
  {
    name: 'add_chart',
    title: 'Add a chart',
    description:
      'Add any of the 49 Looker Studio charts (tables with bars/heatmap, scorecards (compact, with dimension), time series, bars, pies, combos, pivot heatmaps, funnels, waterfalls, sankeys, bullets, maps, …) with dimensions, metrics (aggregation, display name), breakdown, sorts, extra Setup slots, filters (AND/OR), default date range (preset or fixed dates), comparison, combo series, value colors, reference lines and bands and conditional formatting, at an exact layout and with Style settings.\nUse "Record Count" to count rows. Check the result with screenshot_report.',
    schema: schemas.addChartSchema,
    write: true,
    run: handleAddChart,
  },
  {
    name: 'add_text',
    title: 'Add text',
    description:
      'Add a text box (titles, subtitles, notes) with font size, color, bold, background and alignment at an exact layout.',
    schema: schemas.addTextSchema,
    write: true,
    run: handleAddText,
  },
  {
    name: 'add_shape',
    title: 'Add a shape',
    description:
      'Add a shape (rectangle, circle, triangle, star, arrows, callout, …) with fill, border and corner radius. Rectangles behind charts make cards and header bands.\nShapes go on top: send them back with update_component order "back".',
    schema: schemas.addShapeSchema,
    write: true,
    run: handleAddShape,
  },
  {
    name: 'add_control',
    title: 'Add a filter control',
    description:
      'Add a control viewers filter the page with: drop-down list, fixed-size list, input box, advanced filter, slider, checkbox, preset filter, date range control, data control, dimension control or button (link to a URL or page, or a report action).\nControls filter every chart on the page that uses the same data source.',
    schema: schemas.addControlSchema,
    write: true,
    run: handleAddControl,
  },
  {
    name: 'add_image',
    title: 'Add an image',
    description:
      'Upload an image (logo, header art) from a local path or https URL and place it on the page.',
    schema: schemas.addImageSchema,
    write: true,
    run: handleAddImage,
  },
  {
    name: 'add_calculated_field',
    title: 'Add a calculated field',
    description:
      'Add a calculated field to a data source with a Looker Studio formula (ratios, CASE groupings, date parts). Charts and controls then use it by name.',
    schema: schemas.addCalculatedFieldSchema,
    write: true,
    run: handleAddCalculatedField,
  },
  {
    name: 'update_component',
    title: 'Update a component',
    description:
      'Move or resize a component, switch a chart to another type, change its Style/Setup settings, fill Setup slots, add filters, sorts, reference lines/bands or conditional formatting, set its date range or comparison, style combo series, color dimension values, rename its fields, restack it (front/back), make it report-level, set what a button does or the URL of an embed.',
    schema: schemas.updateComponentSchema,
    write: true,
    run: handleUpdateComponent,
  },
  {
    name: 'add_line',
    title: 'Add a line',
    description:
      'Draw a straight line (divider, connector, arrow) between two points of the canvas, with color, dash style and arrow heads.',
    schema: schemas.addLineSchema,
    write: true,
    run: handleAddLine,
  },
  {
    name: 'add_embed',
    title: 'Embed a web page',
    description:
      'Add a URL embed showing a web page (a form, a doc, a video) inside the report. The page must allow being embedded.',
    schema: schemas.addEmbedSchema,
    write: true,
    run: handleAddEmbed,
  },
  {
    name: 'duplicate_component',
    title: 'Duplicate a component',
    description:
      'Copy a chart, control, text or shape (Edit › Duplicate) with all its settings, and place the copy.',
    schema: schemas.duplicateComponentSchema,
    write: true,
    run: handleDuplicateComponent,
  },
  {
    name: 'arrange_components',
    title: 'Align, distribute or group',
    description:
      'Align components (left, center, right, top, middle, bottom), space them evenly (distribute) or group/ungroup them, like Arrange in the editor.',
    schema: schemas.arrangeComponentsSchema,
    write: true,
    run: handleArrangeComponents,
  },
  {
    name: 'manage_page',
    title: 'Manage a page',
    description: 'Delete, duplicate, hide/show (in view mode) or reorder a page of a report.',
    schema: schemas.managePageSchema,
    write: true,
    run: handleManagePage,
  },
  {
    name: 'set_page_settings',
    title: 'Page or report filters and dates',
    description:
      'Set filters, the default date range, the date range dimension and the default data source for a whole page (Current page settings) or the whole report (Report settings). Page scope also takes Style settings such as the page background.',
    schema: schemas.setPageSettingsSchema,
    write: true,
    run: handleSetPageSettings,
  },
  {
    name: 'manage_filter',
    title: 'Edit, copy or delete a filter',
    description:
      'Edit (rename and replace the clauses of), duplicate or delete a filter of the report, as Resource › Manage filters lists them. Charts using the filter keep it.',
    schema: schemas.manageFilterSchema,
    write: true,
    run: handleManageFilter,
  },
  {
    name: 'add_parameter',
    title: 'Add a parameter',
    description:
      'Add a parameter (text, number or boolean, with permitted values and a default) that calculated fields can read and viewers can change with a control.',
    schema: schemas.addParameterSchema,
    write: true,
    run: handleAddParameter,
  },
  {
    name: 'add_group_field',
    title: 'Add a group field',
    description:
      'Add a field that groups the values of another field into named buckets (Add a field › Add group), with an optional bucket for everything else.',
    schema: schemas.addGroupFieldSchema,
    write: true,
    run: handleAddGroupField,
  },
  {
    name: 'add_bin_field',
    title: 'Add a bin field',
    description:
      'Add a field that bins a numeric field into equal ranges (Add a field › Add bin), e.g. response times by 100 ms.',
    schema: schemas.addBinFieldSchema,
    write: true,
    run: handleAddBinField,
  },
  {
    name: 'create_blend',
    title: 'Blend data sources',
    description:
      'Blend 2 to 5 data sources of the report into one (Resource › Manage blends): pick the dimensions and metrics of each table and how it joins the tables to its left. Charts then use the blend as their data source.',
    schema: schemas.createBlendSchema,
    write: true,
    run: handleCreateBlend,
  },
  {
    name: 'delete_component',
    title: 'Delete a component',
    description: 'Delete one component of a page by index. Later indexes move down by one.',
    schema: schemas.deleteComponentSchema,
    write: true,
    run: handleDeleteComponent,
  },
  {
    name: 'set_theme',
    title: 'Set the report theme',
    description:
      'Apply a built-in theme and/or custom theme settings (background, fonts, chart colors), the page size and Layout settings such as tab navigation between pages.',
    schema: schemas.setThemeSchema,
    write: true,
    run: handleSetTheme,
  },
  {
    name: 'add_page',
    title: 'Add a page',
    description:
      'Add a page to a report (one page per business question keeps a dashboard readable).',
    schema: schemas.addPageSchema,
    write: true,
    run: handleAddPage,
  },
  {
    name: 'rename_page',
    title: 'Rename a page',
    description: 'Rename a page of a report; page names are the labels of tab navigation.',
    schema: schemas.renamePageSchema,
    write: true,
    run: handleRenamePage,
  },
  {
    name: 'rename_report',
    title: 'Rename a report',
    description: 'Change the name of a report.',
    schema: schemas.renameReportSchema,
    write: true,
    run: handleRenameReport,
  },
  {
    name: 'share_report',
    title: 'Share a report',
    description: 'Give a person access to a report as viewer or editor.',
    schema: schemas.shareReportSchema,
    write: true,
    run: handleShareReport,
  },
  {
    name: 'delete_report',
    title: 'Delete a report',
    description:
      'Move a report to the Looker Studio trash. Needs the exact report name to confirm.',
    schema: schemas.deleteReportSchema,
    write: true,
    run: handleDeleteReport,
  },
  {
    name: 'add_community_viz',
    title: 'Add a community visualization',
    description:
      'Insert a community visualization from the Community Gallery by its card name (e.g. "Gauge", "Sunburst Chart"), or your own by manifest_path (gs://...). Accepts its consent prompt, then sets data source, dimensions, metrics, other Setup slots (fields), filters, title, style and layout like add_chart.',
    schema: schemas.addCommunityVizSchema,
    write: true,
    run: handleAddCommunityViz,
  },
  {
    name: 'check_report',
    title: 'Check a report for broken charts',
    description:
      'Open every page of a report (or one page), wait for the charts to load and list the ones that show a problem instead of data: "No data", configuration errors (invalid or missing fields), data set errors (Too Many Rows, BigQuery query errors with their message), consent prompts, or still loading after timeout_seconds.\nGives page, component index, kind, title, fields and Looker\'s "See details" text. Use it after building or changing a report.',
    schema: schemas.checkReportSchema,
    write: false,
    run: handleCheckReport,
  },
  {
    name: 'list_data_sources',
    title: 'List data sources',
    description:
      'Every data source of a report: name, alias (ds0, ds1…), connector, table or custom query SQL, how many charts use it, data credentials and freshness.\nfields: true also lists each field with its type and default aggregation (check custom queries: Looker Studio can guess a type wrong).',
    schema: schemas.listDataSourcesSchema,
    write: false,
    run: handleListDataSources,
  },
  {
    name: 'remove_data_source',
    title: 'Remove a data source',
    description:
      'Remove a data source from a report, by name or alias. Refuses while charts use it unless force is true (Looker Studio would leave them broken).',
    schema: schemas.removeDataSourceSchema,
    write: true,
    run: handleRemoveDataSource,
  },
  {
    name: 'update_data_source',
    title: 'Update a data source',
    description:
      "Change a data source in place: rename it, replace a custom query's SQL (Reconnect), set data credentials (owner or viewer) and data freshness (15 minutes to 12 hours).",
    schema: schemas.updateDataSourceSchema,
    write: true,
    run: handleUpdateDataSource,
  },
  {
    name: 'update_field',
    title: 'Update a data source field',
    description:
      'Change the type (Number, Text, Date…), default aggregation and/or name of a field in the data source editor, e.g. a COUNT(*) column of a custom query that came in as a Date.',
    schema: schemas.updateFieldSchema,
    write: true,
    run: handleUpdateField,
  },
  {
    name: 'apply_actions',
    title: 'Run several edits in one visit',
    description:
      'Run a list of editing actions on one report in a single editor visit, much faster than one tool call each: actions [{tool:"add_chart", args:{…same args as add_chart, without report_id}}, …]. ' +
      `Takes ${Object.keys(BATCHABLE_TOOLS).join(', ')}.\n` +
      "Every action is validated before the browser opens. It stops at the first error unless continue_on_error; the reply has each action's result.",
    schema: schemas.applyActionsSchema,
    write: true,
    run: handleApplyActions,
  },
  {
    name: 'export_report_spec',
    title: 'Export a report spec',
    description:
      'Read a report into a JSON spec: name, theme, data sources (table or SQL), pages and, per page, every component with its kind, layout, chart type, fields, title and main style settings. apply_report_spec rebuilds it. Takes a while: it opens each component.',
    schema: schemas.exportReportSpecSchema,
    write: false,
    run: handleExportReportSpec,
  },
  {
    name: 'apply_report_spec',
    title: 'Build a report from a spec',
    description:
      'Create a report from a spec (as export_report_spec returns it, or written by hand: see docs/report-spec.md), or with report_id add what an existing report lacks: data sources, pages (by name) and components (by position). Nothing existing is changed or removed. Runs in one editor visit.',
    schema: schemas.applyReportSpecSchema,
    write: true,
    run: handleApplyReportSpec,
  },
  {
    name: 'copy_report',
    title: 'Copy a report',
    description:
      'File › Make a copy under a new name. data_sources reconnects embedded data sources of the copy to another BigQuery table/view or custom query; the others are kept. Returns the new id and URL.',
    schema: schemas.copyReportSchema,
    write: true,
    run: handleCopyReport,
  },
  {
    name: 'set_link_sharing',
    title: 'Set link sharing',
    description:
      'Share › Link settings: restricted (only people added), unlisted (anyone with the link) or public (anyone on the internet), with the role people with the link get.',
    schema: schemas.setLinkSharingSchema,
    write: true,
    run: handleSetLinkSharing,
  },
  {
    name: 'schedule_delivery',
    title: 'Schedule email delivery',
    description:
      "Share › Schedule delivery: email the report on a schedule: recipients, start date, time, repeat and pages. Replaces the report's existing schedule. The signed-in account always receives it.",
    schema: schemas.scheduleDeliverySchema,
    write: true,
    run: handleScheduleDelivery,
  },
  {
    name: 'list_deliveries',
    title: 'Show the email schedule',
    description:
      "The signed-in account's email delivery schedule of a report (recipients, pages, start, repeat, time), if any.",
    schema: schemas.listDeliveriesSchema,
    write: false,
    run: handleListDeliveries,
  },
  {
    name: 'remove_delivery',
    title: 'Delete the email schedule',
    description: "Delete the signed-in account's email delivery schedule of a report.",
    schema: schemas.removeDeliverySchema,
    write: true,
    run: handleRemoveDelivery,
  },
  {
    name: 'list_versions',
    title: 'List report versions',
    description:
      'File › Version history: the saved versions of a report, newest first, with index, name or date, and authors.',
    schema: schemas.listVersionsSchema,
    write: false,
    run: handleListVersions,
  },
  {
    name: 'restore_version',
    title: 'Restore a report version',
    description:
      'Restore a version from File › Version history, by its index or label from list_versions.',
    schema: schemas.restoreVersionSchema,
    write: true,
    run: handleRestoreVersion,
  },
  {
    name: 'get_embed_code',
    title: 'Get the embed code',
    description:
      'File › Embed report: turn embedding on if needed and return the iframe code and embed URL (size, page, navigation).',
    schema: schemas.getEmbedCodeSchema,
    write: true,
    run: handleGetEmbedCode,
  },
];

export function toolNames(writes: boolean): string[] {
  return TOOLS.filter((t) => writes || !t.write).map((t) => t.name);
}

// Write tools are only registered when writes are enabled in the config AND by flag.
export function registerAllTools(server: McpServer, deps: ToolDeps): void {
  for (const tool of TOOLS) {
    if (tool.write && !deps.writesGate.allowsWrites) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema.shape,
        annotations: {
          readOnlyHint: !tool.write,
          destructiveHint: tool.name.startsWith('delete_'),
        },
      },
      async (input: unknown) => {
        try {
          return await tool.run(deps, input);
        } catch (err) {
          return errorResult(err);
        }
      },
    );
  }
}
