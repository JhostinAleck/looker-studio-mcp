import { DomainError } from '@/shared-kernel/errors/DomainError.js';

export interface ReportSummary {
  id: string;
  name: string;
  url: string;
}

export interface BigQueryTableSource {
  projectId: string;
  datasetId: string;
  tableId: string;
}

// A data source defined by SQL instead of a table. `projectId` is the billing
// project the query runs in; `name` replaces the name Looker Studio picks.
export interface BigQueryQuerySource {
  projectId: string;
  sql: string;
  name?: string;
  // Connector options that pass @DS_START_DATE / @DS_END_DATE (the report's
  // date range) and @DS_USER_EMAIL (the viewer) to the query.
  dateRangeParams?: boolean;
  viewerEmailParam?: boolean;
}

export type BigQuerySource = BigQueryTableSource | BigQueryQuerySource;

export function isQuerySource(source: BigQuerySource): source is BigQueryQuerySource {
  return 'sql' in source;
}

// Short label for logs and tool replies.
export function describeSource(source: BigQuerySource): string {
  if (!isQuerySource(source)) return `${source.projectId}.${source.datasetId}.${source.tableId}`;
  const sql = source.sql.replace(/\s+/g, ' ').trim();
  return `custom query on ${source.projectId}: ${sql.length > 60 ? `${sql.slice(0, 57)}...` : sql}`;
}

// ── Custom query parameters ──

export class QueryParameterError extends DomainError {
  readonly code = 'QUERY_PARAMETER_OFF';
  readonly userMessage: string;

  constructor(parameter: string, option: string) {
    super(`@${parameter} used without ${option}`);
    this.userMessage = `The query uses @${parameter}, which Looker Studio only passes with ${option}: true.`;
  }
}

const usesParameter = (sql: string, name: string) => new RegExp(`@${name}\\b`, 'i').test(sql);

// Stand-ins for the values the connector passes (dates as YYYYMMDD strings),
// used to dry-run the query. A parameter the SQL uses with its option off would
// make every chart fail, so it is refused here.
export function sampleQueryParameters(source: BigQueryQuerySource): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [name, value] of [
    ['DS_START_DATE', '20260101'],
    ['DS_END_DATE', '20260131'],
  ] as const) {
    if (source.dateRangeParams) params[name] = value;
    else if (usesParameter(source.sql, name))
      throw new QueryParameterError(name, 'date_range_params');
  }
  if (source.viewerEmailParam) params.DS_USER_EMAIL = 'viewer@example.com';
  else if (usesParameter(source.sql, 'DS_USER_EMAIL'))
    throw new QueryParameterError('DS_USER_EMAIL', 'viewer_email_param');
  return params;
}

export const CHART_TYPES = [
  'table',
  'table_bars',
  'table_heatmap',
  'scorecard',
  'scorecard_compact',
  'scorecard_dimension',
  'time_series',
  'smoothed_time_series',
  'sparkline',
  'column',
  'stacked_column',
  'stacked_100_column',
  'bar',
  'stacked_bar',
  'stacked_100_bar',
  'histogram',
  'pie',
  'donut',
  'line',
  'smoothed_line',
  'area',
  'stacked_area',
  'stacked_100_area',
  'combo',
  'stacked_combo',
  'geo',
  'bubble_map',
  'filled_map',
  'heatmap_map',
  'line_map',
  'connection_map',
  'combo_map',
  'treemap',
  'gauge',
  'gauge_ranges',
  'bullet',
  'pivot_table',
  'pivot_bars',
  'pivot_heatmap',
  'scatter',
  'bubble',
  'boxplot',
  'candlestick',
  'sankey',
  'waterfall',
  'timeline',
  'funnel',
  'funnel_stepped',
  'funnel_triangle',
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const AGGREGATIONS = [
  'sum',
  'avg',
  'count',
  'count_distinct',
  'min',
  'max',
  'none',
] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export interface MetricSpec {
  // A field of the data source, or "Record Count".
  field: string;
  aggregation?: Aggregation;
  // Display name shown in the chart instead of the field name.
  label?: string;
}

// One condition: `field` `condition` `values`, kept (include) or dropped.
export interface FilterClause {
  field: string;
  // The label of the editor's condition list ("Equal to (=)", "Contains",
  // "In", "Greater than (>)"…) or a short alias: equals, contains, in, gt, lt…
  condition: string;
  values?: string[];
  exclude?: boolean;
}

// A named filter. One clause through `field`/`condition`/`values`/`exclude`,
// or several through `clauses`: groups joined by AND, clauses inside a group
// joined by OR. With only `name`, an existing filter of the report is reused.
export interface FilterSpec {
  name: string;
  field?: string;
  condition?: string;
  values?: string[];
  exclude?: boolean;
  clauses?: FilterClause[][];
}

// The clauses of a filter, as AND groups of OR clauses.
export function filterClauses(filter: FilterSpec): FilterClause[][] {
  if (filter.clauses?.length) return filter.clauses;
  if (!filter.field || !filter.condition) return [];
  return [
    [
      {
        field: filter.field,
        condition: filter.condition,
        ...(filter.values ? { values: filter.values } : {}),
        ...(filter.exclude ? { exclude: true } : {}),
      },
    ],
  ];
}

export interface SortSpec {
  field: string;
  ascending?: boolean;
}

// A horizontal (or vertical) line at a value, e.g. a target.
export interface ReferenceLine {
  value?: number;
  label?: string;
  color?: string;
  // "Constant value" (default), "Metric", "Parameter"… as the editor lists them.
  type?: string;
  // "Left Y-axis", "Right Y-axis", "Bottom X-axis"… as the editor lists them.
  axis?: string;
}

// A shaded band between two values, e.g. an acceptable range.
export interface ReferenceBand {
  from: number;
  to: number;
  label?: string;
  color?: string;
}

// Colors cells, rows or a scorecard when its rules match (AND groups of OR rules).
export interface ConditionalFormat {
  rules: Array<Array<{ field: string; condition: string; value?: string }>>;
  // "Entire row" or a column of the table; scorecards ignore it.
  applyTo?: string;
  fontColor?: string;
  backgroundColor?: string;
}

// How a metric of a combo/line chart is drawn.
export interface SeriesSpec {
  metric: string;
  type?: 'line' | 'bars';
  axis?: 'left' | 'right';
  color?: string;
}

// Data settings shared by charts and controls, set at creation or later.
export interface DataSettings {
  // Extra Setup slots by heading: {"Column dimension": ["platform"], "Sparkline": ["occurred_on"]}.
  fields?: Record<string, string[]>;
  filters?: FilterSpec[];
  // A preset of the date picker: "Last 28 days", "This month", "Yesterday"…
  dateRange?: string;
  // Scorecards and tables: "Previous period" or "Previous year".
  comparison?: string;
  series?: SeriesSpec[];
  // Fixed colors per dimension value (pie slices, bars…): {"android": "#7C4DFF"}.
  valueColors?: Record<string, string>;
  // Tables: sorts after the first one ("Sort #2", "Sort #3"…).
  sorts?: SortSpec[];
  referenceLines?: ReferenceLine[];
  referenceBands?: ReferenceBand[];
  conditionalFormats?: ConditionalFormat[];
}

// A fixed date range: "2026-10-01..2026-10-15".
export const FIXED_RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

export interface ChartSpec extends DataSettings {
  type: ChartType;
  dimensions: string[];
  metrics: MetricSpec[];
  // Field to sort by, descending unless `sortAscending`.
  sortBy?: string;
  sortAscending?: boolean;
  // A breakdown dimension (stacked bars, one line per value…).
  breakdown?: string;
  title?: string;
  // Display names of dimensions (and the breakdown) by field name.
  labels?: Record<string, string>;
}

export const CONTROL_KINDS = [
  'drop_down',
  'fixed_size_list',
  'input_box',
  'advanced_filter',
  'slider',
  'checkbox',
  'preset_filter',
  'date_range',
  'data_control',
  'dimension_control',
  'button',
] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

export interface ButtonSpec {
  // "link" opens `url` or the page named `page`; "report_action" runs one of
  // Invite people, Get report link, Download report, Reset filters.
  action: 'link' | 'report_action';
  url?: string;
  page?: string;
  newTab?: boolean;
  reportAction?: 'Invite people' | 'Get report link' | 'Download report' | 'Reset filters';
  label?: string;
}

export interface ControlSpec extends DataSettings {
  kind: ControlKind;
  // The dimension the control filters by ("Control field").
  field?: string;
  // Drop-downs and lists can show a metric next to each value.
  metric?: string;
  button?: ButtonSpec;
}

// Position and size in report pixels (the canvas is 1200×900 unless changed).
export interface Layout {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Panel settings by their visible label: true/false flips a toggle, "#RRGGBB"
// sets a color, anything else picks a dropdown option or fills a box.
export type StyleSettings = Record<string, string | number | boolean>;

export interface ComponentInfo {
  index: number;
  // Properties panel title, e.g. "Bar chart properties".
  kind: string;
  layout: Layout;
  // Settings that were asked for but the panel did not have.
  warnings?: string[];
}

// One control of a properties panel, as listed by describe_component.
export interface SettingInfo {
  kind: 'toggle' | 'field' | 'radio';
  label: string;
  value: string;
}

export interface ComponentDetails {
  kind: string;
  layout: Layout;
  setup: SettingInfo[];
  style: SettingInfo[];
}

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export const RECORD_COUNT = 'Record Count';

export const REPORT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidReportIdError extends DomainError {
  readonly code = 'INVALID_REPORT_ID';
  readonly userMessage: string;

  constructor(value: string) {
    super(`"${value}" is not a Looker Studio report id`);
    this.userMessage = `"${value}" is not a Looker Studio report id (a UUID like 1a2b3c4d-…, the part after /reporting/ in the report URL).`;
  }
}

export class InvalidChartError extends DomainError {
  readonly code = 'INVALID_CHART';
  constructor(readonly userMessage: string) {
    super(userMessage);
  }
}

// Accepts the bare id or any report URL (…/reporting/<id>/page/…).
export function parseReportId(value: string): string {
  const match = /\/reporting\/([0-9a-f-]{36})/i.exec(value);
  const id = match?.[1] ?? value.trim();
  if (!REPORT_ID_RE.test(id)) throw new InvalidReportIdError(value);
  return id.toLowerCase();
}

export function reportUrl(id: string, mode: 'view' | 'edit' = 'view'): string {
  return `https://lookerstudio.google.com/reporting/${id}${mode === 'edit' ? '/edit' : ''}`;
}

type Range = readonly [min: number, max: number];
interface ChartShape {
  dimensions: Range;
  metrics: Range;
  breakdown?: boolean;
}
const ANY: Range = [0, Infinity];
const ONE: Range = [1, 1];
const SOME: Range = [1, Infinity];
const SINGLE_VALUE: ChartShape = { dimensions: [0, 0], metrics: ONE };
const BY_ONE: ChartShape = { dimensions: ONE, metrics: SOME };
const SERIES: ChartShape = { dimensions: ONE, metrics: SOME, breakdown: true };
const TABULAR: ChartShape = { dimensions: SOME, metrics: SOME };
const PIVOT: ChartShape = { dimensions: SOME, metrics: SOME };
// Maps, timelines and candlesticks fill their own slots through `fields`.
const FREE: ChartShape = { dimensions: ANY, metrics: ANY };

// The fields each chart type takes; checked before touching the editor.
const SHAPES: Record<ChartType, ChartShape> = {
  table: TABULAR,
  table_bars: TABULAR,
  table_heatmap: TABULAR,
  scorecard: SINGLE_VALUE,
  scorecard_compact: SINGLE_VALUE,
  // Shows the top value of one dimension; sort_by picks the metric that ranks it.
  scorecard_dimension: { dimensions: ONE, metrics: [0, 0] },
  time_series: SERIES,
  smoothed_time_series: SERIES,
  sparkline: SERIES,
  column: SERIES,
  stacked_column: SERIES,
  stacked_100_column: SERIES,
  bar: SERIES,
  stacked_bar: SERIES,
  stacked_100_bar: SERIES,
  histogram: { dimensions: ONE, metrics: [0, 0], breakdown: true },
  pie: BY_ONE,
  donut: BY_ONE,
  line: SERIES,
  smoothed_line: SERIES,
  area: SERIES,
  stacked_area: SERIES,
  stacked_100_area: SERIES,
  combo: SERIES,
  stacked_combo: SERIES,
  geo: BY_ONE,
  bubble_map: FREE,
  filled_map: FREE,
  heatmap_map: FREE,
  line_map: FREE,
  connection_map: FREE,
  combo_map: FREE,
  treemap: { dimensions: SOME, metrics: ONE },
  gauge: SINGLE_VALUE,
  gauge_ranges: SINGLE_VALUE,
  bullet: { dimensions: [0, 0], metrics: SOME },
  pivot_table: PIVOT,
  pivot_bars: PIVOT,
  pivot_heatmap: PIVOT,
  scatter: { dimensions: ONE, metrics: [2, 3] },
  bubble: { dimensions: ONE, metrics: [2, 3] },
  boxplot: FREE,
  candlestick: FREE,
  sankey: { dimensions: [2, Infinity], metrics: ONE },
  waterfall: BY_ONE,
  timeline: FREE,
  funnel: BY_ONE,
  funnel_stepped: BY_ONE,
  funnel_triangle: BY_ONE,
};

function describeRange([min, max]: Range, noun: string): string {
  if (min === max) return `exactly ${min} ${noun}${min === 1 ? '' : 's'}`;
  if (max === Infinity) return `at least ${min} ${noun}${min === 1 ? '' : 's'}`;
  return `${min} to ${max} ${noun}s`;
}

export function validateChart(spec: ChartSpec): ChartSpec {
  const shape = SHAPES[spec.type];
  const [dMin, dMax] = shape.dimensions;
  const [mMin, mMax] = shape.metrics;
  const nd = spec.dimensions.length;
  const nm = spec.metrics.length;
  if (shape === FREE) {
    if (nd + nm === 0 && Object.keys(spec.fields ?? {}).length === 0) {
      throw new InvalidChartError(
        `A ${spec.type} chart needs fields: pass dimensions/metrics or its Setup slots in \`fields\`.`,
      );
    }
  } else {
    if (nd < dMin || nd > dMax) {
      throw new InvalidChartError(
        `A ${spec.type} chart takes ${describeRange(shape.dimensions, 'dimension')}.`,
      );
    }
    if (nm < mMin || nm > mMax) {
      throw new InvalidChartError(
        `A ${spec.type} chart takes ${describeRange(shape.metrics, 'metric')}.`,
      );
    }
  }
  if (spec.breakdown && !shape.breakdown) {
    throw new InvalidChartError(`A ${spec.type} chart does not take a breakdown dimension.`);
  }
  validateDataSettings(spec);
  return spec;
}

export function validateDataSettings(data: DataSettings): DataSettings {
  for (const [section, fields] of Object.entries(data.fields ?? {})) {
    if (!section.trim()) throw new InvalidChartError('Setup slot names cannot be empty.');
    if (fields.some((f) => !f.trim())) {
      throw new InvalidChartError(`Field names for "${section}" cannot be empty.`);
    }
  }
  for (const filter of data.filters ?? []) validateFilter(filter);
  for (const series of data.series ?? []) {
    if (!series.metric.trim()) throw new InvalidChartError('Every series needs its metric.');
    if (series.color !== undefined && !HEX_COLOR_RE.test(series.color)) {
      throw new InvalidChartError(`Series color "${series.color}" is not a #RRGGBB color.`);
    }
  }
  for (const [value, color] of Object.entries(data.valueColors ?? {})) {
    if (!HEX_COLOR_RE.test(color)) {
      throw new InvalidChartError(`Color "${color}" for "${value}" is not a #RRGGBB color.`);
    }
  }
  if (data.dateRange !== undefined) validateDateRange(data.dateRange);
  for (const sort of data.sorts ?? []) {
    if (!sort.field.trim()) throw new InvalidChartError('Every sort needs its field.');
  }
  for (const line of data.referenceLines ?? []) checkColor('reference line color', line.color);
  for (const band of data.referenceBands ?? []) {
    checkColor('reference band color', band.color);
    if (!(band.from < band.to)) {
      throw new InvalidChartError(
        `A reference band needs from < to (got ${band.from}..${band.to}).`,
      );
    }
  }
  for (const format of data.conditionalFormats ?? []) {
    if (!format.rules.length || format.rules.some((g) => !g.length)) {
      throw new InvalidChartError('A conditional format needs at least one rule in every group.');
    }
    if (!format.fontColor && !format.backgroundColor) {
      throw new InvalidChartError('A conditional format needs font_color or background_color.');
    }
    checkColor('font_color', format.fontColor);
    checkColor('background_color', format.backgroundColor);
  }
  return data;
}

function checkColor(label: string, value: string | undefined): void {
  if (value !== undefined && !HEX_COLOR_RE.test(value)) {
    throw new InvalidChartError(`${label} "${value}" is not a #RRGGBB color.`);
  }
}

export function validateFilter(filter: FilterSpec): FilterSpec {
  if (!filter.name.trim()) throw new InvalidChartError('Every filter needs a name.');
  if (filter.field !== undefined && !filter.condition) {
    throw new InvalidChartError(`Filter "${filter.name}" has a field but no condition.`);
  }
  if (filter.field === undefined && (filter.condition || filter.values?.length)) {
    throw new InvalidChartError(`Filter "${filter.name}" has a condition but no field.`);
  }
  if (filter.clauses && filter.field) {
    throw new InvalidChartError(
      `Filter "${filter.name}": pass field/condition or clauses, not both.`,
    );
  }
  for (const group of filter.clauses ?? []) {
    if (!group.length) throw new InvalidChartError(`Filter "${filter.name}" has an empty group.`);
    for (const c of group) {
      if (!c.field.trim() || !c.condition.trim()) {
        throw new InvalidChartError(
          `Every clause of "${filter.name}" needs a field and a condition.`,
        );
      }
    }
  }
  return filter;
}

export function validateDateRange(range: string): string {
  if (!range.trim()) throw new InvalidChartError('date_range cannot be empty.');
  const fixed = FIXED_RANGE_RE.exec(range.trim());
  if (fixed) {
    const [from, to] = [fixed[1]!, fixed[2]!];
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to) {
      throw new InvalidChartError(`"${range}" is not a valid YYYY-MM-DD..YYYY-MM-DD range.`);
    }
  }
  return range;
}

export function validateControl(spec: ControlSpec): ControlSpec {
  const fieldless: ControlKind[] = ['date_range', 'data_control', 'button', 'preset_filter'];
  if (spec.button && spec.kind !== 'button') {
    throw new InvalidChartError('Only a button control takes `button` settings.');
  }
  if (spec.button?.action === 'link' && !spec.button.url && !spec.button.page) {
    throw new InvalidChartError('A link button needs a url or a page.');
  }
  if (spec.button?.action === 'report_action' && !spec.button.reportAction) {
    throw new InvalidChartError('A report_action button needs report_action.');
  }
  if (!fieldless.includes(spec.kind) && !spec.field?.trim()) {
    throw new InvalidChartError(`A ${spec.kind} control needs the field it filters by.`);
  }
  if (spec.kind !== 'date_range' && spec.comparison) {
    throw new InvalidChartError('Only charts take a comparison date range.');
  }
  validateDataSettings(spec);
  return spec;
}

export function validateLayout(layout: Partial<Layout>): Partial<Layout> {
  for (const [key, value] of Object.entries(layout)) {
    if (value === undefined) continue;
    const min = key === 'width' || key === 'height' ? 10 : 0;
    if (!Number.isFinite(value) || value < min || value > 20_000) {
      throw new InvalidChartError(
        `${key} must be a number between ${min} and 20000 report pixels.`,
      );
    }
  }
  return layout;
}

export function validateSettings(settings: StyleSettings): StyleSettings {
  for (const [label, value] of Object.entries(settings)) {
    if (!label.trim()) throw new InvalidChartError('Setting labels cannot be empty.');
    if (typeof value === 'string' && value.startsWith('#') && !HEX_COLOR_RE.test(value)) {
      throw new InvalidChartError(`"${value}" for "${label}" is not a #RRGGBB color.`);
    }
  }
  return settings;
}

// ── Report check ──

// What a chart shows instead of its data, sorted by who has to fix it.
export type ChartProblemKind =
  | 'no_data' // the query returned no rows (often a filter or date range)
  | 'configuration' // the chart setup: invalid or missing fields
  | 'data_set' // the data source or its query: BigQuery errors, too many rows
  | 'consent' // the viewer has not allowed viewer's credentials or the viewer email parameter
  | 'loading' // still loading when the check gave up
  | 'error';

export interface ChartProblem {
  page: number;
  pageName?: string;
  // Component index on its page, as list_components gives it.
  index: number;
  kind: string;
  title?: string;
  fields?: string[];
  // The data source in the chart's Setup panel.
  dataSource?: string;
  problem: ChartProblemKind;
  // The message on the chart, e.g. "Too Many Rows: Due to the number of rows…".
  message: string;
  // The "See details" dialog: Looker's explanation and, for queries, BigQuery's error.
  details?: string;
}

export interface ReportCheck {
  pages: Array<{ index: number; name?: string }>;
  // Charts and controls looked at (texts, shapes and images have no data).
  components: number;
  problems: ChartProblem[];
  // The editor showed the viewer consent prompt and the check declined it.
  consentDeclined?: boolean;
}

// Sorts the title of a chart error into a problem kind.
export function classifyChartError(title: string): ChartProblemKind {
  const t = title.toLowerCase();
  if (/no data/.test(t)) return 'no_data';
  if (/consent/.test(t)) return 'consent';
  if (/too many rows|data ?set|data source|system error|query|bigquery|user configuration/.test(t))
    return 'data_set';
  if (/invalid|configuration|missing|field|dimension|metric/.test(t)) return 'configuration';
  return 'error';
}

// What the check read from one chart. `points` is the number of data points a
// Vega chart drew (bar, column, line…): with no rows these charts draw empty
// axes, not "No data"; undefined when it could not be read.
export interface ChartReading {
  loading: boolean;
  noData: boolean;
  error?: { title: string; description: string };
  points?: number;
}

export function chartProblem(
  r: ChartReading,
  timeoutMs: number,
): Pick<ChartProblem, 'problem' | 'message'> | null {
  if (r.loading)
    return { problem: 'loading', message: `Still loading after ${timeoutMs / 1000} s` };
  if (r.error)
    return {
      problem: classifyChartError(r.error.title),
      message: [r.error.title, r.error.description].filter(Boolean).join(': '),
    };
  if (r.noData) return { problem: 'no_data', message: 'No data' };
  if (r.points === 0) return { problem: 'no_data', message: 'No data: the chart draws empty axes' };
  return null;
}

// ── Report specs ──

// "rgb(12, 34, 56)", "rgba(…, 1)" or "#abcdef" to "#0C2238"; null for
// transparent or anything else.
export function cssColorToHex(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return `#${[m[1], m[2], m[3]]
    .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

// ── Report specs ──

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The date picker's text as a date_range: "Sep 1, 2026 - Oct 15, 2026" is a
// fixed range; a preset reads "Last 28 days (exclude today)". The default
// ("Auto date range") is no range at all.
export function dateRangeFromLabel(label: string): string | undefined {
  const text = label.replace(/\s+/g, ' ').trim();
  if (!text || /^auto( date range)?$/i.test(text)) return undefined;
  const fixed = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) - ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(
    text,
  );
  if (fixed) {
    const iso = (m: string, d: string, y: string) =>
      `${y}-${String(MONTHS.indexOf(m) + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (MONTHS.includes(fixed[1]!) && MONTHS.includes(fixed[4]!))
      return `${iso(fixed[1]!, fixed[2]!, fixed[3]!)}..${iso(fixed[4]!, fixed[5]!, fixed[6]!)}`;
  }
  return text.replace(/\s*\(exclude today\)$/i, '');
}
