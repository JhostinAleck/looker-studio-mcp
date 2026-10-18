import type { ChartType, ControlKind } from '@/contexts/reports/domain/Report.js';
import type { ShapeKind } from '@/contexts/reports/domain/ReportRepository.js';

// Every URL the editor opens carries hl=en, so these English labels hold for any account language.
export const HL = 'hl=en';

export const BASE = 'https://lookerstudio.google.com';

// aria-label of each preset in "Add a chart".
export const CHART_PRESETS: Record<ChartType, string> = {
  table: 'Table',
  table_bars: 'Table with bars',
  table_heatmap: 'Table with heatmap',
  scorecard: 'Scorecard',
  scorecard_compact: 'Scorecard with compact numbers',
  time_series: 'Time series chart',
  smoothed_time_series: 'Smoothed time series chart',
  sparkline: 'Sparkline chart',
  column: 'Vertical bar chart',
  stacked_column: 'Stacked vertical bar chart',
  stacked_100_column: '100% stacked vertical bar chart',
  bar: 'Bar chart',
  stacked_bar: 'Stacked bar chart',
  stacked_100_bar: '100% stacked bar chart',
  histogram: 'Histogram',
  pie: 'Pie chart',
  donut: 'Donut chart',
  line: 'Line chart',
  smoothed_line: 'Smoothed line chart',
  area: 'Area chart',
  stacked_area: 'Stacked area chart',
  stacked_100_area: '100% stacked area chart',
  combo: 'Combo chart',
  stacked_combo: 'Stacked combo chart',
  geo: 'Geo chart',
  bubble_map: 'Bubble map',
  filled_map: 'Filled map',
  heatmap_map: 'Heatmap',
  line_map: 'Line map',
  connection_map: 'Connection map',
  combo_map: 'Combo map',
  treemap: 'Treemap',
  gauge: 'Gauge',
  gauge_ranges: 'Gauge with ranges',
  bullet: 'Bullet chart',
  pivot_table: 'Pivot table',
  pivot_bars: 'Pivot table with bars',
  pivot_heatmap: 'Pivot table with heatmap',
  scatter: 'Scatter chart',
  bubble: 'Bubble chart',
  boxplot: 'Boxplot chart',
  candlestick: 'Candlestick chart',
  sankey: 'Sankey',
  waterfall: 'Waterfall',
  timeline: 'Timeline',
  funnel: 'Funnel chart smoothed bar',
  funnel_stepped: 'Funnel chart stepped bar',
  funnel_triangle: 'Funnel chart inverted triangle',
};

const TABLE = /^Table/;
const SCORECARD = /^Scorecard/;
const TIME_SERIES = /^(Time series|Line|Sparkline)/;
const BARS = /(Column|Bar) chart/;
const AREA = /(Area|Time series)/;
const LINE = /(Line|Combo|Time series)/;
const MAP = /(Google Maps|map)/i;
const PIVOT = /Pivot/;
const FUNNEL = /^Funnel/;

// Title of the properties panel for each kind of component, used to confirm
// that the editor inserted what was asked.
export const PANEL_TITLE_HINT: Record<ChartType, RegExp> = {
  table: TABLE,
  table_bars: TABLE,
  table_heatmap: TABLE,
  scorecard: SCORECARD,
  scorecard_compact: SCORECARD,
  time_series: TIME_SERIES,
  smoothed_time_series: TIME_SERIES,
  sparkline: TIME_SERIES,
  column: BARS,
  stacked_column: BARS,
  stacked_100_column: BARS,
  bar: BARS,
  stacked_bar: BARS,
  stacked_100_bar: BARS,
  histogram: /^Histogram/,
  pie: /(Pie|Donut)/,
  donut: /(Pie|Donut)/,
  line: LINE,
  smoothed_line: LINE,
  area: AREA,
  stacked_area: AREA,
  stacked_100_area: AREA,
  combo: LINE,
  stacked_combo: LINE,
  geo: /Geo/,
  bubble_map: MAP,
  filled_map: MAP,
  heatmap_map: MAP,
  line_map: MAP,
  connection_map: MAP,
  combo_map: MAP,
  treemap: /Treemap/,
  gauge: /Gauge/,
  gauge_ranges: /Gauge/,
  bullet: /Bullet/,
  pivot_table: PIVOT,
  pivot_bars: PIVOT,
  pivot_heatmap: PIVOT,
  scatter: /(Scatter|Bubble)/,
  bubble: /(Scatter|Bubble)/,
  boxplot: /Box/i,
  candlestick: /Candle/i,
  sankey: /Sankey/,
  waterfall: /Waterfall/,
  timeline: /Timeline/,
  funnel: FUNNEL,
  funnel_stepped: FUNNEL,
  funnel_triangle: FUNNEL,
};

// Insert menu label of each control.
export const CONTROL_LABELS: Record<ControlKind, string> = {
  drop_down: 'Drop-down list',
  fixed_size_list: 'Fixed-size list',
  input_box: 'Input box',
  advanced_filter: 'Advanced filter',
  slider: 'Slider',
  checkbox: 'Checkbox',
  preset_filter: 'Preset filter',
  date_range: 'Date range control',
  data_control: 'Data control',
  dimension_control: 'Dimension control',
  button: 'Button',
};

// The date picker's preset menu: these presets sit in a submenu named after
// its first entry; the rest are top-level items.
export const DATE_PRESET_GROUPS: Record<string, string[]> = {
  'This month': [
    'This week (starts Sunday)',
    'This week to date (starts Sunday)',
    'This week (starts Monday)',
    'This week to date (starts Monday)',
    'This month',
    'This month to date',
    'This quarter',
    'This quarter to date',
    'This year',
    'This year to date',
  ],
  'Last 7 days': [
    'Last 7 days',
    'Last 14 days',
    'Last 28 days',
    'Last 30 days',
    'Last week (starts Sunday)',
    'Last week (starts Monday)',
    'Last month',
    'Last quarter',
    'Last year',
  ],
};

export function datePresetPath(preset: string): string[] {
  const wanted = preset.trim().toLowerCase();
  for (const [group, items] of Object.entries(DATE_PRESET_GROUPS)) {
    const item = items.find((i) => i.toLowerCase() === wanted);
    if (item) return [group, item];
  }
  const top = ['Auto date range', 'Today', 'Yesterday'].find((i) => i.toLowerCase() === wanted);
  if (top) return [top];
  const known = [
    'Auto date range',
    'Today',
    'Yesterday',
    ...Object.values(DATE_PRESET_GROUPS).flat(),
  ];
  throw new Error(`"${preset}" is not a date range preset (presets: ${known.join(', ')})`);
}

// Short names for the filter editor's conditions.
export const FILTER_CONDITIONS: Record<string, string> = {
  equals: 'Equal to (=)',
  '=': 'Equal to (=)',
  contains: 'Contains',
  starts_with: 'Starts with',
  regexp_match: 'RegExp Match',
  regexp_contains: 'RegExp Contains',
  in: 'In',
  is_null: 'Is Null',
  gt: 'Greater than (>)',
  '>': 'Greater than (>)',
  gte: 'Greater than or equal to (>=)',
  '>=': 'Greater than or equal to (>=)',
  lt: 'Less than (<)',
  '<': 'Less than (<)',
  lte: 'Less than or equal to (<=)',
  '<=': 'Less than or equal to (<=)',
  between: 'Between (>=, <=)',
};

// Setup sections by heading. Anchored so "Breakdown dimension sort" or
// "Date range dimension" never pass for the slot being filled.
export const SECTION = {
  dimensions: /^(Dimension|Row dimension)/,
  metrics: /^(Metric|Primary field)/,
  breakdown: /^Breakdown dimension$/,
  sort: /^Sort( #1)?$/,
  control: /^Control field$/,
} as const;

// A Setup slot named by the caller, matched whole and case-insensitively.
export function sectionNamed(label: string): RegExp {
  return new RegExp(`^${escapeRegExp(label.trim())}$`, 'i');
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Insert › Shapes is a grid of icons without labels; each shape is known by its Material icon.
export const SHAPE_ICONS: Record<ShapeKind, string> = {
  rectangle: 'check_box_outline_blank',
  circle: 'radio_button_unchecked',
  triangle: 'change_history',
  heart: 'favorite_border',
  diamond: 'thermostat_carbon',
  pentagon: 'pentagon',
  star: 'star_border',
  hexagon: 'hexagon',
  octagon: 'octagon',
  cylinder: 'cylinder',
};

export const SEL = {
  canvas: '.reportArea',
  component: '.lego-component-repeat',
  propertiesPanel: 'properties-panel article.property-panel',
  // Page names in the Page › Manage pages panel.
  pageChip: '.nav-item-chip.page-chip .chip-text',
  panelTitle: 'properties-panel article.property-panel header .title',
  // Field chips of the Data panel (right side) carry the field name as aria-label.
  dataPanelChip: (field: string) => `div.common-chip[aria-label="${cssEscape(field)}"]`,
  // Text formatting buttons carry no label, only their Material icon.
  iconButton: (icon: string) => `button:has(mat-icon[data-mat-icon-name="${cssEscape(icon)}"])`,
  preset: (label: string) => `preset-preview[aria-label="${cssEscape(label)}"]`,
} as const;

export function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
