import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodObject, ZodRawShape } from 'zod';

import * as schemas from './schemas.js';
import { errorResult, type ToolResult, type WriteDeps } from './tool-helpers.js';
import type { BigQueryToolDeps } from './tools/bigquery-deps.js';
import type { ReportToolDeps } from './tools/reports-deps.js';
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
      'Build a Looker Studio Linking API URL that creates a report (blank or copied from a template) connected to BigQuery tables. The user opens it to confirm.',
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
    description: 'Create a Looker Studio report connected to a BigQuery table or view.',
    schema: schemas.createReportSchema,
    write: true,
    run: handleCreateReport,
  },
  {
    name: 'add_data_source',
    title: 'Add a data source',
    description: 'Connect another BigQuery table or view to an existing report.',
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
      'Add any of the 48 Looker Studio charts (tables with bars/heatmap, scorecards, time series, bars, pies, combos, pivot heatmaps, funnels, waterfalls, sankeys, bullets, maps, …) with dimensions, metrics (aggregation, display name), breakdown, sort, extra Setup slots, filters, default date range, comparison, combo series and value colors, at an exact layout and with Style settings.\nUse "Record Count" to count rows. Check the result with screenshot_report.',
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
      'Add a shape (rectangle, circle, triangle, star, …) with fill, border and corner radius. Rectangles behind charts make cards and header bands.\nShapes go on top: send them back with update_component order "back".',
    schema: schemas.addShapeSchema,
    write: true,
    run: handleAddShape,
  },
  {
    name: 'add_control',
    title: 'Add a filter control',
    description:
      'Add a control viewers filter the page with: drop-down list, fixed-size list, input box, advanced filter, slider, checkbox, preset filter, date range control, data control, dimension control or button.\nControls filter every chart on the page that uses the same data source.',
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
      'Move or resize a component, change its Style/Setup settings, fill Setup slots, add filters, set its date range or comparison, style combo series, color dimension values, rename its fields, restack it (front/back) or make it report-level.',
    schema: schemas.updateComponentSchema,
    write: true,
    run: handleUpdateComponent,
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
