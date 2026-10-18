import { z } from 'zod';

import { AGGREGATIONS, CHART_TYPES, CONTROL_KINDS } from '@/contexts/reports/domain/Report.js';
import { ORDER_MOVES, SHAPE_KINDS } from '@/contexts/reports/domain/ReportRepository.js';
import type { DataSettings } from '@/contexts/reports/domain/Report.js';

const projectId = z
  .string()
  .optional()
  .describe('Google Cloud project id. Defaults to project_id in the config.');
const datasetId = z.string().describe('BigQuery dataset id, e.g. campusfind_analytics');
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

// Data settings shared by add_chart, add_control and update_component.
const dataShape = {
  fields: z
    .record(z.string(), z.array(z.string()).min(1))
    .optional()
    .describe(
      'More Setup slots by their heading, e.g. {"Column dimension":["platform"]} (pivot heatmap), {"Sparkline":["occurred_on"]} (scorecard), {"Weight metric":["Record Count"]}, {"Start time":["occurred_at"]}. describe_component shows the headings.',
    ),
  filters: z
    .array(
      z.object({
        name: z.string().min(1).describe('Filter name; an existing filter of the report is reused'),
        field: z
          .string()
          .optional()
          .describe('Field to filter on (omit to reuse a filter by name)'),
        condition: z
          .string()
          .optional()
          .describe(
            'equals, contains, starts_with, regexp_match, regexp_contains, in, is_null, gt, gte, lt, lte, between, or the editor label ("Equal to (=)")',
          ),
        values: z.array(z.string()).optional().describe('Values; several for "in" and "between"'),
        exclude: z.boolean().default(false).describe('Drop matching rows instead of keeping them'),
      }),
    )
    .optional()
    .describe('Filters applied to this chart or control'),
  date_range: z
    .string()
    .optional()
    .describe(
      'Default date range preset: Today, Yesterday, Last 7 days, Last 14 days, Last 28 days, Last 30 days, Last month, Last quarter, Last year, This week (starts Monday), This month, This month to date, This quarter, This year, This year to date… ("Auto date range" for all dates)',
    ),
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
};

type DataInput = {
  fields?: Record<string, string[]> | undefined;
  filters?:
    | Array<{
        name: string;
        field?: string | undefined;
        condition?: string | undefined;
        values?: string[] | undefined;
        exclude: boolean;
      }>
    | undefined;
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
};

// Snake-case tool input to the domain's DataSettings.
export function toDataSettings(input: DataInput): DataSettings {
  return {
    ...(input.fields ? { fields: input.fields } : {}),
    ...(input.filters
      ? {
          filters: input.filters.map((f) => ({
            name: f.name,
            ...(f.field ? { field: f.field } : {}),
            ...(f.condition ? { condition: f.condition } : {}),
            ...(f.values ? { values: f.values } : {}),
            ...(f.exclude ? { exclude: true } : {}),
          })),
        }
      : {}),
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

const sourceShape = {
  project_id: projectId,
  dataset_id: datasetId,
  table_id: z.string().describe('Table or view the report reads'),
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
  sort_by: z.string().optional(),
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
