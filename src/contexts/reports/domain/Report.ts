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
  'scorecard',
  'time_series',
  'column',
  'stacked_column',
  'bar',
  'stacked_bar',
  'pie',
  'donut',
  'line',
  'area',
  'combo',
  'geo',
  'treemap',
  'gauge',
  'pivot_table',
  'scatter',
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

export interface ChartSpec {
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

const SINGLE_VALUE: ChartType[] = ['scorecard', 'gauge'];
const MULTI_DIMENSION: ChartType[] = ['table', 'pivot_table'];
const WITH_BREAKDOWN: ChartType[] = [
  'column',
  'stacked_column',
  'bar',
  'stacked_bar',
  'line',
  'area',
  'time_series',
  'combo',
];

// Each chart type needs a certain shape of fields; checked before touching the editor.
export function validateChart(spec: ChartSpec): ChartSpec {
  if (spec.metrics.length === 0) throw new InvalidChartError('A chart needs at least one metric.');
  if (SINGLE_VALUE.includes(spec.type)) {
    if (spec.dimensions.length > 0 || spec.metrics.length > 1) {
      throw new InvalidChartError(`A ${spec.type} shows exactly one metric and no dimensions.`);
    }
  } else if (MULTI_DIMENSION.includes(spec.type)) {
    if (spec.dimensions.length === 0) {
      throw new InvalidChartError(`A ${spec.type} needs at least one dimension.`);
    }
  } else if (spec.dimensions.length !== 1) {
    throw new InvalidChartError(`A ${spec.type} chart needs exactly one dimension.`);
  }
  if (spec.type === 'scatter' && spec.metrics.length < 2) {
    throw new InvalidChartError('A scatter chart needs two metrics (X and Y).');
  }
  if (spec.breakdown && !WITH_BREAKDOWN.includes(spec.type)) {
    throw new InvalidChartError(`A ${spec.type} chart does not take a breakdown dimension.`);
  }
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
