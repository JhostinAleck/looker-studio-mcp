import { DomainError } from '@/shared-kernel/errors/DomainError.js';

export interface ReportSummary {
  id: string;
  name: string;
  url: string;
}

export interface BigQuerySource {
  projectId: string;
  datasetId: string;
  tableId: string;
}

export const CHART_TYPES = [
  'table',
  'table_bars',
  'table_heatmap',
  'scorecard',
  'scorecard_compact',
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

// A filter clause: `field` `condition` `values`, kept (include) or dropped.
// With only `name`, an existing filter of the report is reused.
export interface FilterSpec {
  name: string;
  field?: string;
  // The label of the filter editor's condition list ("Equal to (=)", "Contains",
  // "In", "Greater than (>)"…) or a short alias: equals, contains, in, gt, lt…
  condition?: string;
  values?: string[];
  exclude?: boolean;
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
}

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

export interface ControlSpec extends DataSettings {
  kind: ControlKind;
  // The dimension the control filters by ("Control field").
  field?: string;
  // Drop-downs and lists can show a metric next to each value.
  metric?: string;
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
  for (const filter of data.filters ?? []) {
    if (!filter.name.trim()) throw new InvalidChartError('Every filter needs a name.');
    if (filter.field !== undefined && !filter.condition) {
      throw new InvalidChartError(`Filter "${filter.name}" has a field but no condition.`);
    }
    if (filter.field === undefined && (filter.condition || filter.values?.length)) {
      throw new InvalidChartError(`Filter "${filter.name}" has a condition but no field.`);
    }
  }
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
  if (data.dateRange !== undefined && !data.dateRange.trim()) {
    throw new InvalidChartError('date_range cannot be empty.');
  }
  return data;
}

export function validateControl(spec: ControlSpec): ControlSpec {
  const fieldless: ControlKind[] = ['date_range', 'data_control', 'button', 'preset_filter'];
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
