import { z } from 'zod';

import { AGGREGATIONS, CHART_TYPES, CONTROL_KINDS } from '@/contexts/reports/domain/Report.js';
import {
  ARRANGE_ACTIONS,
  ORDER_MOVES,
  PAGE_ACTIONS,
  SHAPE_KINDS,
} from '@/contexts/reports/domain/ReportRepository.js';
import type { ButtonSpec, DataSettings, FilterSpec } from '@/contexts/reports/domain/Report.js';

const projectId = z
  .string()
  .optional()
  .describe('Google Cloud project id. Defaults to project_id in the config.');
const datasetId = z.string().describe('BigQuery dataset id, e.g. analytics');
const reportId = z.string().describe('Report id or any URL of the report');
const page = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('1-based page; defaults to the first page');
const index = z
  .number()
  .int()
  .nonnegative()
  .describe('Component index, as list_components shows it');
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .describe('#RRGGBB');

// The canvas is 1200x900 px by default (set_theme canvas changes it); x/y is the top-left corner.
const layout = z
  .object({
    x: z.number().int().nonnegative().optional(),
    y: z.number().int().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .describe('Position and size in report px (canvas 1200x900 by default)');

const settings = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .describe(
    'Properties-panel settings by their exact label, e.g. {"Bar color":"#7C4DFF","Show data labels":true,"Font size":"14px"}. ' +
      'Colors take #RRGGBB, switches true/false, dropdowns their option text. Repeat a label as "Label#2" for its second occurrence. ' +
      'describe_component lists every label of a component.',
  );

const conditionText =
  'equals, contains, starts_with, regexp_match, regexp_contains, in, is_null, gt, gte, lt, lte, between, or the editor label ("Equal to (=)")';

const clause = z.object({
  field: z.string().min(1),
  condition: z.string().min(1).describe(conditionText),
  values: z.array(z.string()).optional().describe('Values; several for "in" and "between"'),
  exclude: z.boolean().default(false).describe('Drop matching rows instead of keeping them'),
});

const filter = z.object({
  name: z.string().min(1).describe('Filter name; an existing filter of the report is reused'),
  field: z.string().optional().describe('Field to filter on (omit to reuse a filter by name)'),
  condition: z.string().optional().describe(conditionText),
  values: z.array(z.string()).optional().describe('Values; several for "in" and "between"'),
  exclude: z.boolean().default(false).describe('Drop matching rows instead of keeping them'),
  clauses: z
    .array(z.array(clause).min(1))
    .optional()
    .describe(
      'Several conditions instead of field/condition/values: groups joined by AND, clauses inside a group joined by OR. [[A, B], [C]] = (A OR B) AND C',
    ),
});

const dateRange = z
  .string()
  .optional()
  .describe(
    'Default date range: a preset (Today, Yesterday, Last 7 days, Last 14 days, Last 28 days, Last 30 days, Last month, Last quarter, Last year, This week (starts Monday), This month, This month to date, This quarter, This year, This year to date… "Auto date range" for all dates) or fixed dates "2026-10-01..2026-10-15"',
  );

// Data settings shared by add_chart, add_control and update_component.
const dataShape = {
  fields: z
    .record(z.string(), z.array(z.string()).min(1))
    .optional()
    .describe(
      'More Setup slots by their heading, e.g. {"Column dimension":["platform"]} (pivot heatmap), {"Sparkline":["occurred_on"]} (scorecard), {"Weight metric":["Record Count"]}, {"Start time":["occurred_at"]}. describe_component shows the headings.',
    ),
  filters: z.array(filter).optional().describe('Filters applied to this chart or control'),
  date_range: dateRange,
  comparison: z
    .string()
    .optional()
    .describe(
      'Comparison date range: "Previous period", "Previous year" or "None" (scorecards, tables)',
    ),
  series: z
    .array(
      z.object({
        metric: z.string().describe('Metric as the chart names it (its display name)'),
        type: z.enum(['line', 'bars']).optional(),
        axis: z.enum(['left', 'right']).optional(),
        color: color.optional(),
      }),
    )
    .optional()
    .describe('Per-metric series of combo/line charts: bars or line, left or right axis, color'),
  value_colors: z
    .record(z.string(), color)
    .optional()
    .describe('Fixed color per dimension value, e.g. {"android":"#3DDC84","ios":"#0A84FF"}'),
  sorts: z
    .array(z.object({ field: z.string().min(1), ascending: z.boolean().default(false) }))
    .optional()
    .describe('Tables: sorts after the first one (Sort #2, Sort #3…)'),
  reference_lines: z
    .array(
      z.object({
        value: z.number().optional().describe('Constant value of the line, e.g. a target'),
        label: z.string().optional(),
        color: color.optional(),
        type: z
          .string()
          .optional()
          .describe('"Constant value" (default), "Metric", "Parameter"… as the panel lists them'),
        axis: z.string().optional().describe('"Left Y-axis", "Right Y-axis", "Bottom X-axis"…'),
      }),
    )
    .optional()
    .describe('Reference lines on bar, line, combo and scatter charts'),
  reference_bands: z
    .array(
      z.object({
        from: z.number(),
        to: z.number(),
        label: z.string().optional(),
        color: color.optional(),
      }),
    )
    .optional()
    .describe('Shaded bands between two values, e.g. an acceptable range'),
  conditional_formats: z
    .array(
      z.object({
        rules: z
          .array(
            z
              .array(
                z.object({
                  field: z.string().min(1),
                  condition: z
                    .string()
                    .describe('equals, not_equals, gt, gte, lt, lte or the editor label'),
                  value: z.string().optional(),
                }),
              )
              .min(1),
          )
          .min(1)
          .describe('Groups joined by AND, rules inside a group by OR'),
        apply_to: z
          .string()
          .optional()
          .describe('Tables: "Entire row" or a column name (defaults to the panel default)'),
        font_color: color.optional(),
        background_color: color.optional(),
      }),
    )
    .optional()
    .describe(
      'Color cells, rows or a scorecard when the rules match (Style › Conditional formatting)',
    ),
};

const button = z
  .object({
    action: z.enum(['link', 'report_action']),
    url: z.string().optional().describe('link: the URL to open'),
    page: z.string().optional().describe('link: the name of a page of this report'),
    new_tab: z.boolean().default(false),
    report_action: z
      .enum(['Invite people', 'Get report link', 'Download report', 'Reset filters'])
      .optional(),
  })
  .describe('What a button control does: open a link or page, or run a report action');

export function toButton(b: z.infer<typeof button>): ButtonSpec {
  return {
    action: b.action,
    ...(b.url ? { url: b.url } : {}),
    ...(b.page ? { page: b.page } : {}),
    ...(b.new_tab ? { newTab: true } : {}),
    ...(b.report_action ? { reportAction: b.report_action } : {}),
  };
}

type FilterInput = z.infer<typeof filter>;

type DataInput = {
  fields?: Record<string, string[]> | undefined;
  filters?: FilterInput[] | undefined;
  date_range?: string | undefined;
  comparison?: string | undefined;
  series?:
    | Array<{
        metric: string;
        type?: 'line' | 'bars' | undefined;
        axis?: 'left' | 'right' | undefined;
        color?: string | undefined;
      }>
    | undefined;
  value_colors?: Record<string, string> | undefined;
  sorts?: Array<{ field: string; ascending: boolean }> | undefined;
  reference_lines?:
    | Array<{
        value?: number | undefined;
        label?: string | undefined;
        color?: string | undefined;
        type?: string | undefined;
        axis?: string | undefined;
      }>
    | undefined;
  reference_bands?:
    | Array<{ from: number; to: number; label?: string | undefined; color?: string | undefined }>
    | undefined;
  conditional_formats?:
    | Array<{
        rules: Array<Array<{ field: string; condition: string; value?: string | undefined }>>;
        apply_to?: string | undefined;
        font_color?: string | undefined;
        background_color?: string | undefined;
      }>
    | undefined;
};

// Zod leaves absent keys as undefined; the domain wants them absent.
function defined<T extends object>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

export function toFilter(f: FilterInput): FilterSpec {
  return {
    name: f.name,
    ...(f.field ? { field: f.field } : {}),
    ...(f.condition ? { condition: f.condition } : {}),
    ...(f.values ? { values: f.values } : {}),
    ...(f.exclude ? { exclude: true } : {}),
    ...(f.clauses
      ? {
          clauses: f.clauses.map((group) =>
            group.map((c) => ({
              field: c.field,
              condition: c.condition,
              ...(c.values ? { values: c.values } : {}),
              ...(c.exclude ? { exclude: true } : {}),
            })),
          ),
        }
      : {}),
  };
}

// Snake-case tool input to the domain's DataSettings.
export function toDataSettings(input: DataInput): DataSettings {
  return {
    ...(input.fields ? { fields: input.fields } : {}),
    ...(input.filters ? { filters: input.filters.map(toFilter) } : {}),
    ...(input.date_range ? { dateRange: input.date_range } : {}),
    ...(input.comparison ? { comparison: input.comparison } : {}),
    ...(input.series
      ? {
          series: input.series.map((x) => ({
            metric: x.metric,
            ...(x.type ? { type: x.type } : {}),
            ...(x.axis ? { axis: x.axis } : {}),
            ...(x.color ? { color: x.color } : {}),
          })),
        }
      : {}),
    ...(input.value_colors ? { valueColors: input.value_colors } : {}),
    ...(input.sorts ? { sorts: input.sorts } : {}),
    ...(input.reference_lines ? { referenceLines: input.reference_lines.map(defined) } : {}),
    ...(input.reference_bands ? { referenceBands: input.reference_bands.map(defined) } : {}),
    ...(input.conditional_formats
      ? {
          conditionalFormats: input.conditional_formats.map((f) => ({
            rules: f.rules.map((group) => group.map(defined)),
            ...(f.apply_to ? { applyTo: f.apply_to } : {}),
            ...(f.font_color ? { fontColor: f.font_color } : {}),
            ...(f.background_color ? { backgroundColor: f.background_color } : {}),
          })),
        }
      : {}),
  };
}

export const checkAuthSchema = z.object({});

export const listDatasetsSchema = z.object({ project_id: projectId });

export const listTablesSchema = z.object({ project_id: projectId, dataset_id: datasetId });

export const describeTableSchema = z.object({
  project_id: projectId,
  dataset_id: datasetId,
  table_id: z.string().describe('Table or view id'),
});

export const runQuerySchema = z.object({
  project_id: projectId,
  sql: z.string().min(1).describe('A single SELECT (or WITH … SELECT) in GoogleSQL'),
  max_rows: z.number().int().positive().max(10_000).optional(),
  dry_run: z.boolean().default(false).describe('Only validate and estimate the bytes scanned'),
});

export const createViewSchema = z.object({
  project_id: projectId,
  dataset_id: datasetId,
  view_id: z.string().describe('Name of the view to create or replace'),
  sql: z.string().min(1).describe('SELECT that defines the view'),
  description: z.string().optional(),
});

export const deleteViewSchema = z.object({
  project_id: projectId,
  dataset_id: datasetId,
  view_id: z.string(),
});

export const listReportsSchema = z.object({
  query: z.string().optional().describe('Only reports whose name contains this text'),
});

// A data source is a table/view (dataset_id + table_id) or a custom query (sql).
const sourceShape = {
  project_id: z
    .string()
    .optional()
    .describe(
      'Google Cloud project id (for sql: the billing project). Defaults to project_id in the config.',
    ),
  dataset_id: datasetId.optional().describe('Dataset of table_id'),
  table_id: z.string().optional().describe('Table or view the report reads'),
  sql: z
    .string()
    .min(1)
    .optional()
    .describe('Custom query (GoogleSQL SELECT) to use instead of a table or view'),
  source_name: z
    .string()
    .min(1)
    .optional()
    .describe('Name of the custom query data source in the report (only with sql)'),
};

export const createReportSchema = z.object({
  name: z.string().min(1).describe('Report name'),
  ...sourceShape,
});

export const addDataSourceSchema = z.object({ report_id: reportId, ...sourceShape });

export const refreshDataSourceSchema = z.object({
  report_id: reportId,
  name: z
    .string()
    .optional()
    .describe('Data source name (e.g. the view id); all of them when omitted'),
});

export const addChartSchema = z.object({
  report_id: reportId,
  type: z.enum(CHART_TYPES),
  dimensions: z.array(z.string()).default([]).describe('Field names used as dimensions'),
  metrics: z
    .array(
      z.object({
        field: z.string().describe('Field name, or "Record Count"'),
        aggregation: z.enum(AGGREGATIONS).optional(),
        label: z
          .string()
          .optional()
          .describe('Display name, e.g. "Total uses" instead of "Record Count"'),
      }),
    )
    .default([])
    .describe('Metrics; histograms and timelines take none'),
  breakdown: z
    .string()
    .optional()
    .describe('Breakdown dimension (stacked bars, one line per value)'),
  sort_by: z
    .string()
    .optional()
    .describe('Sort field; pivots sort their first row dimension by it'),
  sort_ascending: z.boolean().default(false),
  title: z.string().optional(),
  layout: layout.optional(),
  style: settings.optional().describe('Style tab settings applied after the chart is placed'),
  page,
  data_source: z.string().optional().describe('Data source name when the report has several'),
  ...dataShape,
});

export const addControlSchema = z.object({
  report_id: reportId,
  kind: z.enum(CONTROL_KINDS),
  field: z
    .string()
    .optional()
    .describe('Dimension the control filters by (not for date_range, data_control, button)'),
  metric: z.string().optional().describe('Metric shown next to each value (drop-downs, lists)'),
  button: button.optional(),
  layout: layout.optional(),
  style: settings
    .optional()
    .describe(
      'Style tab settings, e.g. {"Fixed-size":true,"Single-select":true,"Background":"#151B33"}',
    ),
  page,
  data_source: z.string().optional().describe('Data source name when the report has several'),
  ...dataShape,
});

export const addImageSchema = z.object({
  report_id: reportId,
  image: z
    .string()
    .min(1)
    .describe('Local path or https URL of a .png/.jpg/.gif/.svg/.webp (logos, header art)'),
  alt_text: z.string().optional(),
  layout: layout.optional(),
  style: settings.optional().describe('e.g. {"Border radius":12,"Opacity":"80%"}'),
  page,
});

export const addCalculatedFieldSchema = z.object({
  report_id: reportId,
  name: z.string().min(1).describe('Field name as it will appear in the data panel'),
  formula: z
    .string()
    .min(1)
    .describe(
      'Looker Studio formula, e.g. COUNT_DISTINCT(uid), SUM(a)/SUM(b), CASE WHEN platform = "android" THEN "Android" ELSE "Other" END',
    ),
  data_source: z.string().optional().describe('Data source name when the report has several'),
});

export const addTextSchema = z.object({
  report_id: reportId,
  text: z.string().min(1),
  font_size: z.number().int().min(6).max(400).optional(),
  color: color.optional(),
  bold: z.boolean().default(false),
  background: color.optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  layout: layout.optional(),
  style: settings
    .optional()
    .describe('More text settings, e.g. {"Font family":"Roboto","Line height":"1.5"}'),
  page,
});

export const addShapeSchema = z.object({
  report_id: reportId,
  shape: z.enum(SHAPE_KINDS),
  background: color.optional(),
  border_color: color.optional(),
  border_radius: z.number().int().nonnegative().max(200).optional(),
  layout: layout.optional(),
  style: settings
    .optional()
    .describe(
      'More shape settings, e.g. {"Opacity":"50%","Border weight":"0","Add border shadow":true}',
    ),
  page,
});

export const listComponentsSchema = z.object({ report_id: reportId, page });

export const describeComponentSchema = z.object({ report_id: reportId, index, page });

export const updateComponentSchema = z.object({
  report_id: reportId,
  index,
  layout: layout.optional(),
  style: settings.optional().describe('Style tab settings'),
  setup: settings
    .optional()
    .describe('Setup tab settings (not field chips; use add_chart for those)'),
  labels: z
    .record(z.string(), z.string().min(1))
    .optional()
    .describe(
      'Rename chart fields by current name, e.g. {"Record Count":"Total uses","feature_label":"Feature"}',
    ),
  order: z
    .enum(ORDER_MOVES)
    .optional()
    .describe('Restack it: front, back, forward, backward. Changes its index.'),
  report_level: z
    .boolean()
    .optional()
    .describe(
      'true shows it on every page (headers, logos). It goes to the top of the stack: make a background band report-level first, or send it back afterwards.',
    ),
  chart_type: z
    .enum(CHART_TYPES)
    .optional()
    .describe('Switch the chart to another type, keeping the fields that fit'),
  button: button.optional(),
  embed_url: z.string().optional().describe('URL embeds: the page they show'),
  page,
  ...dataShape,
});

export const deleteComponentSchema = z.object({ report_id: reportId, index, page });

export const setThemeSchema = z.object({
  report_id: reportId,
  preset: z
    .string()
    .optional()
    .describe(
      'Built-in theme: Default, Edge, Constellation, Groovy, Insight, Ocean, Harvest, Eucalyptus, Pop!, Fog, Lagoon, Executive, Woodsy, Royalty, Sienna, Material, Muted, Simple, Simple Dark',
    ),
  settings: settings
    .optional()
    .describe(
      'Theme settings after the preset, e.g. {"Report background color":"#0B1020","Primary font family":"Roboto","Chart title color":"#FFFFFF"}',
    ),
  canvas: z
    .object({
      width: z.number().int().min(200).max(4000),
      height: z.number().int().min(200).max(10000),
    })
    .optional()
    .describe('Page size in px'),
  layout: settings
    .optional()
    .describe(
      'Theme and layout › Layout settings, e.g. {"Navigation type":"Tab","Header visibility":"Always show"}',
    ),
});

export const addPageSchema = z.object({ report_id: reportId, name: z.string().min(1) });

export const renamePageSchema = z.object({
  report_id: reportId,
  page: z.number().int().positive().describe('1-based page'),
  name: z.string().min(1),
});

export const listReportPagesSchema = z.object({ report_id: reportId });

export const renameReportSchema = z.object({ report_id: reportId, name: z.string().min(1) });

export const shareReportSchema = z.object({
  report_id: reportId,
  emails: z
    .array(z.email())
    .min(1)
    .describe('Google accounts to invite (Gmail or Google Workspace)'),
  role: z.enum(['viewer', 'editor']).default('viewer'),
  notify: z.boolean().default(true).describe("Send Google's sharing email to each person"),
});

export const screenshotReportSchema = z.object({ report_id: reportId, page });

export const deleteReportSchema = z.object({
  report_id: reportId,
  confirm_name: z.string().describe('Exact name of the report, to confirm the deletion'),
});

export const buildReportLinkSchema = z.object({
  report_name: z.string().min(1),
  template_report_id: z.string().optional().describe('Report to copy; blank report when omitted'),
  sources: z
    .array(
      z.object({
        ...sourceShape,
        alias: z.string().optional().describe('Data source alias in the template (ds0, ds1, …)'),
        name: z.string().optional(),
      }),
    )
    .min(1),
});

export const addLineSchema = z.object({
  report_id: reportId,
  from: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }),
  to: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }),
  color: color.optional(),
  border_style: z.string().optional().describe('"Solid", "Dashed", "Dotted"…'),
  start: z
    .string()
    .optional()
    .describe('Line start: "None", "Circle", "Diamond" or "Pointer" (an arrow head)'),
  end: z
    .string()
    .optional()
    .describe('Line end: "None", "Circle", "Diamond" or "Pointer" (an arrow head)'),
  style: settings.optional(),
  page,
});

export const addEmbedSchema = z.object({
  report_id: reportId,
  url: z.string().min(1).describe('http(s) page to show (it must allow being embedded)'),
  layout: layout.optional(),
  style: settings.optional(),
  page,
});

export const duplicateComponentSchema = z.object({
  report_id: reportId,
  index,
  layout: layout.optional().describe('Where to put the copy'),
  page,
});

export const arrangeComponentsSchema = z.object({
  report_id: reportId,
  indexes: z.array(index).min(1).describe('Components to arrange, as list_components shows them'),
  action: z
    .enum(ARRANGE_ACTIONS)
    .describe('Align (2+), distribute evenly (3+), group (2+) or ungroup a group'),
  page,
});

export const managePageSchema = z.object({
  report_id: reportId,
  page: z.number().int().positive().describe('1-based page'),
  action: z
    .enum(PAGE_ACTIONS)
    .describe(
      'delete, duplicate, hide/show (in view mode), move_up, move_down, move_top, move_bottom',
    ),
});

export const setPageSettingsSchema = z.object({
  report_id: reportId,
  scope: z
    .enum(['page', 'report'])
    .describe('page: Page › Current page settings; report: File › Report settings (every page)'),
  page: page.describe('Page for scope "page"; defaults to the first page'),
  data_source: z.string().optional().describe('Default data source of the page or report'),
  filters: z.array(filter).optional().describe('Filters applied to every chart of the page/report'),
  date_range_dimension: z.string().optional().describe('Date field the date range filters'),
  date_range: dateRange,
  style: settings
    .optional()
    .describe('Page only: Style tab, e.g. {"Page background":"#0B1020","Height (px)":1400}'),
});

export const manageFilterSchema = z.object({
  report_id: reportId,
  action: z.enum(['edit', 'duplicate', 'delete']),
  name: z.string().min(1).describe('Current filter name, as Resource › Manage filters lists it'),
  filter: filter.optional().describe('edit: the new name and clauses (they replace the old ones)'),
});

export const addParameterSchema = z.object({
  report_id: reportId,
  name: z.string().min(1),
  id: z.string().optional().describe('Parameter id used in formulas (letters, digits, _)'),
  data_type: z.enum(['Text', 'Number (whole)', 'Number (decimal)', 'Boolean']).optional(),
  values: z.array(z.string()).optional().describe('Permitted values; any value when omitted'),
  default_value: z.string().optional(),
  data_source: z.string().optional().describe('Data source name when the report has several'),
});

export const addGroupFieldSchema = z.object({
  report_id: reportId,
  name: z.string().min(1).describe('Name of the new field'),
  field: z.string().min(1).describe('Field whose values are grouped'),
  groups: z
    .array(
      z.object({
        name: z.string().min(1),
        condition: z.string().default('in').describe(conditionText),
        values: z.array(z.string()).default([]),
        exclude: z.boolean().default(false),
      }),
    )
    .min(1),
  other_group: z.string().optional().describe('Name for every value no group takes'),
  data_source: z.string().optional().describe('Data source name when the report has several'),
});

export const addBinFieldSchema = z.object({
  report_id: reportId,
  name: z.string().min(1).describe('Name of the new field'),
  field: z.string().min(1).describe('Numeric field to bin'),
  size: z.number().positive().describe('Width of each bin'),
  min: z.number().optional(),
  max: z.number().optional(),
  data_source: z.string().optional().describe('Data source name when the report has several'),
});

export const createBlendSchema = z.object({
  report_id: reportId,
  name: z.string().min(1),
  tables: z
    .array(
      z.object({
        data_source: z.string().min(1),
        dimensions: z.array(z.string()).default([]),
        metrics: z.array(z.string()).default([]),
      }),
    )
    .min(2)
    .max(5)
    .describe('Tables left to right; the blend exposes their dimensions and metrics'),
  joins: z
    .array(
      z.object({
        type: z
          .enum(['left outer', 'right outer', 'inner', 'full outer', 'cross'])
          .default('left outer'),
        keys: z
          .array(z.tuple([z.string(), z.string()]))
          .default([])
          .describe('[field on the left, field of this table] pairs'),
      }),
    )
    .describe('One per table after the first'),
});

// ── Batch ──

export const applyActionsSchema = z.object({
  report_id: reportId,
  actions: z
    .array(
      z.object({
        tool: z
          .string()
          .min(1)
          .describe('An editing tool: add_chart, add_text, update_component, add_page, …'),
        args: z
          .record(z.string(), z.unknown())
          .default({})
          .describe("That tool's arguments, without report_id"),
      }),
    )
    .min(1)
    .max(200)
    .describe('Run in order; pages are reached with the page argument of each action'),
  continue_on_error: z
    .boolean()
    .default(false)
    .describe('Run the remaining actions after one fails (it stops at the first error otherwise)'),
});

// ── Report specs ──

// A component of a spec page: the arguments of the tool that adds it, without
// report_id and page, tagged with `component`.
const specArgs = { report_id: true, page: true } as const;
export const specComponentSchema = z.discriminatedUnion('component', [
  addChartSchema.omit(specArgs).extend({ component: z.literal('chart') }),
  addTextSchema.omit(specArgs).extend({ component: z.literal('text') }),
  addShapeSchema.omit(specArgs).extend({ component: z.literal('shape') }),
  addControlSchema.omit(specArgs).extend({ component: z.literal('control') }),
  addImageSchema.omit(specArgs).extend({ component: z.literal('image') }),
  addLineSchema.omit(specArgs).extend({ component: z.literal('line') }),
  addEmbedSchema.omit(specArgs).extend({ component: z.literal('embed') }),
  z
    .object({ component: z.literal('other'), panel: z.string(), layout: layout.optional() })
    .describe('A component the spec cannot rebuild (kept for reference, skipped when applied)'),
]);

export const specDataSourceSchema = z.object({
  name: z.string().min(1).optional().describe('Data source name in the report'),
  project_id: z.string().min(1).describe('Project of the table, or billing project of sql'),
  dataset_id: z.string().optional(),
  table_id: z.string().optional(),
  sql: z.string().min(1).optional().describe('Custom query instead of dataset_id and table_id'),
});

export const reportSpecSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().min(1).describe('Report name'),
  theme: setThemeSchema
    .omit({ report_id: true })
    .optional()
    .describe('set_theme arguments: preset, settings, canvas, layout'),
  data_sources: z
    .array(specDataSourceSchema)
    .default([])
    .describe('The first one creates the report; the others are added'),
  calculated_fields: z.array(addCalculatedFieldSchema.omit({ report_id: true })).optional(),
  pages: z
    .array(
      z.object({
        name: z.string().min(1),
        components: z
          .array(specComponentSchema)
          .default([])
          .describe('Back to front, as list_components lists them'),
      }),
    )
    .min(1),
});

export const exportReportSpecSchema = z.object({
  report_id: reportId,
  style: z
    .enum(['none', 'main', 'all'])
    .default('main')
    .describe(
      'Style settings kept per component: none, main (background, border, legend, data labels) or all',
    ),
});

export const applyReportSpecSchema = z.object({
  spec: reportSpecSchema.describe('A report spec, as export_report_spec returns it'),
  report_id: reportId
    .optional()
    .describe('Update this report (add missing pages and components) instead of creating one'),
  name: z.string().min(1).optional().describe('Name of the new report; defaults to spec.name'),
  continue_on_error: z.boolean().default(false),
});
