import type { ChartType } from '@/contexts/reports/domain/Report.js';
import type { ShapeKind } from '@/contexts/reports/domain/ReportRepository.js';

// Every URL the editor opens carries hl=en, so these English labels hold for any account language.
export const HL = 'hl=en';

export const BASE = 'https://lookerstudio.google.com';

// aria-label of each preset in "Add a chart".
export const CHART_PRESETS: Record<ChartType, string> = {
  table: 'Table',
  scorecard: 'Scorecard',
  time_series: 'Time series chart',
  column: 'Vertical bar chart',
  stacked_column: 'Stacked vertical bar chart',
  bar: 'Bar chart',
  stacked_bar: 'Stacked bar chart',
  pie: 'Pie chart',
  donut: 'Donut chart',
  line: 'Line chart',
  area: 'Area chart',
  combo: 'Combo chart',
  geo: 'Geo chart',
  treemap: 'Treemap',
  gauge: 'Gauge',
  pivot_table: 'Pivot table',
  scatter: 'Scatter chart',
};

// Title of the properties panel for each kind of component, used to confirm
// that the editor inserted what was asked.
export const PANEL_TITLE_HINT: Record<ChartType, RegExp> = {
  table: /^Table/,
  scorecard: /^Scorecard/,
  time_series: /^Time series/,
  column: /(Column|Bar) chart/,
  stacked_column: /(Column|Bar) chart/,
  bar: /Bar chart/,
  stacked_bar: /Bar chart/,
  pie: /(Pie|Donut)/,
  donut: /(Pie|Donut)/,
  line: /(Line|Combo|Time series)/,
  area: /(Area|Time series)/,
  combo: /(Combo|Line)/,
  geo: /Geo/,
  treemap: /Treemap/,
  gauge: /Gauge/,
  pivot_table: /Pivot/,
  scatter: /Scatter/,
};

// Setup sections by heading. Anchored so "Breakdown dimension sort" or
// "Date range dimension" never pass for the slot being filled.
export const SECTION = {
  dimensions: /^(Dimension|Row dimension)/,
  metrics: /^(Metric|Primary field)/,
  breakdown: /^Breakdown dimension$/,
  sort: /^Sort( #1)?$/,
} as const;

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
