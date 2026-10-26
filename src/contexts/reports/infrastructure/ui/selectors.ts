import type { FieldAggregation, Freshness } from '@/contexts/reports/domain/DataSource.js';
import type { ChartType, ControlKind } from '@/contexts/reports/domain/Report.js';
import type {
  ArrangeAction,
  PageAction,
  ShapeKind,
} from '@/contexts/reports/domain/ReportRepository.js';

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
  scorecard_dimension: 'Scorecard with dimension',
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
  scorecard_dimension: SCORECARD,
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

// ── Control variants ──

// The drop-down, fixed-size list, input box, advanced filter, slider and
// checkbox all open "Drop-down list properties", and a preset filter is a button whose action is
// Filter ("Button properties"). What the control draws, and the button's
// action, tell them apart. First match wins.
export const DROP_DOWN_VARIANTS: ReadonlyArray<readonly [ControlKind, string]> = [
  ['fixed_size_list', 'list-control'],
  ['advanced_filter', 'input.advanced-filter-text-box'],
  ['input_box', 'input.simple-text-box'],
  ['slider', 'lego-slider'],
  ['checkbox', 'checkbox-control'],
];
export const PRESET_FILTER_ACTION = 'Filter';

// The panel title of the control a component really is. `drawn` lists the
// DROP_DOWN_VARIANTS selectors found in it; `buttonAction` is the checked
// "Button action type".
export function controlPanelTitle(
  title: string,
  drawn: readonly string[],
  buttonAction: string | null,
): string {
  const of = (kind: ControlKind) => `${CONTROL_LABELS[kind]} properties`;
  if (title === of('drop_down')) {
    const variant = DROP_DOWN_VARIANTS.find(([, css]) => drawn.includes(css));
    return variant ? of(variant[0]) : title;
  }
  if (title === of('button') && buttonAction === PRESET_FILTER_ACTION) return of('preset_filter');
  return title;
}

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
  // A dimension control calls its slot "Dimension".
  control: /^(Control field|Dimension)$/,
} as const;

// A Setup slot named by the caller, matched whole and case-insensitively.
export function sectionNamed(label: string): RegExp {
  return new RegExp(`^${escapeRegExp(label.trim())}$`, 'i');
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Insert menu path of each shape. Shapes, Arrow and Callout are grids of
// icons without labels; each shape is known by its Material icon.
export const SHAPE_PATHS: Record<ShapeKind, string[]> = {
  rectangle: ['Shapes', 'icon:check_box_outline_blank'],
  circle: ['Shapes', 'icon:radio_button_unchecked'],
  triangle: ['Shapes', 'icon:change_history'],
  heart: ['Shapes', 'icon:favorite_border'],
  diamond: ['Shapes', 'icon:thermostat_carbon'],
  pentagon: ['Shapes', 'icon:pentagon'],
  star: ['Shapes', 'icon:star_border'],
  hexagon: ['Shapes', 'icon:hexagon'],
  octagon: ['Shapes', 'icon:octagon'],
  cylinder: ['Shapes', 'icon:cylinder'],
  arrow_right: ['Arrow', 'icon:block_arrow_right'],
  arrow_left: ['Arrow', 'icon:block_arrow_left'],
  arrow_up: ['Arrow', 'icon:block_arrow_up'],
  arrow_down: ['Arrow', 'icon:block_arrow_down'],
  callout: ['Callout', 'icon:tooltip'],
};

// The "Chart types" grid of the properties panel lists the presets of "Add a
// chart" in this order, without labels.
export const PRESET_ORDER = [
  'Table',
  'Table with bars',
  'Table with heatmap',
  'Scorecard',
  'Scorecard with compact numbers',
  'Scorecard with dimension',
  'Time series chart',
  'Sparkline chart',
  'Smoothed time series chart',
  'Vertical bar chart',
  'Stacked vertical bar chart',
  '100% stacked vertical bar chart',
  'Bar chart',
  'Stacked bar chart',
  '100% stacked bar chart',
  'Histogram',
  'Pie chart',
  'Donut chart',
  'Bubble map',
  'Filled map',
  'Heatmap',
  'Line map',
  'Connection map',
  'Combo map',
  'Geo chart',
  'Combo chart',
  'Stacked combo chart',
  'Line chart',
  'Smoothed line chart',
  'Boxplot chart',
  'Candlestick chart',
  'Stacked area chart',
  '100% stacked area chart',
  'Area chart',
  'Scatter chart',
  'Bubble chart',
  'Pivot table',
  'Pivot table with bars',
  'Pivot table with heatmap',
  'Bullet chart',
  'Treemap',
  'Sankey',
  'Gauge',
  'Gauge with ranges',
  'Waterfall',
  'Timeline',
  'Funnel chart smoothed bar',
  'Funnel chart stepped bar',
  'Funnel chart inverted triangle',
];

// Arrange menu path of each arrange action.
export const ARRANGE_PATHS: Record<ArrangeAction, string[]> = {
  align_left: ['Align horizontally', 'Left'],
  align_center: ['Align horizontally', 'Center'],
  align_right: ['Align horizontally', 'Right'],
  align_top: ['Align vertically', 'Top'],
  align_middle: ['Align vertically', 'Middle'],
  align_bottom: ['Align vertically', 'Bottom'],
  distribute_horizontally: ['Distribute', 'Horizontally'],
  distribute_vertically: ['Distribute', 'Vertically'],
  group: ['Group'],
  ungroup: ['Ungroup'],
};

// Item of a page's menu in Page › Manage pages.
export const PAGE_MENU: Record<Exclude<PageAction, 'hide' | 'show'>, string> = {
  delete: 'Delete',
  duplicate: 'Duplicate',
  move_up: 'Move up',
  move_down: 'Move down',
  move_top: 'Move to top',
  move_bottom: 'Move to bottom',
};

export const SEL = {
  canvas: '.reportArea',
  component: '.lego-component-repeat',
  // A click on a drop-down in the editor opens its value list on <body>, drawn
  // over the control itself; an advanced filter opens its condition menu and a
  // data control its data source menu (an md-panel).
  controlPopup:
    'canvas-control-editor, .md-select-menu-container.md-active, .md-panel-outer-wrapper',
  propertiesPanel: 'properties-panel article.property-panel',
  // Page names in the Page › Manage pages panel.
  pageChip: '.nav-item-chip.page-chip .chip-text',
  panelTitle: 'properties-panel article.property-panel header .title',
  // Panel title while several components are selected.
  multipleSelection: 'Multiple Properties',
  // Field chips of the Data panel (right side) carry the field name as aria-label.
  dataPanelChip: (field: string) => `div.common-chip[aria-label="${cssEscape(field)}"]`,
  // BigQuery connector › CUSTOM QUERY: a billing project row and the SQL editor.
  billingProject: (projectId: string) =>
    `ng2-config-column-item:has(a[href*="project=${cssEscape(projectId)}&"])`,
  customQueryEditor: '.CodeMirror',
  // Name box at the top of the data source editor.
  dataSourceNameInput: 'input.mat-mdc-input-element',
  // Text formatting buttons carry no label, only their Material icon.
  iconButton: (icon: string) => `button:has(mat-icon[data-mat-icon-name="${cssEscape(icon)}"])`,
  preset: (label: string) => `preset-preview[aria-label="${cssEscape(label)}"]`,
} as const;

export function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

// ── Connectors ──────────────────────────────────────────────────────────
// "Add data to report" gallery and the forms of Looker Studio's own connectors.
export const CONNECTOR_SEL = {
  tile: (label: string) => `span.title-text:text-is("${cssEscape(label)}")`,
  // Google's OAuth popup: account chooser rows and the consent button.
  oauthAccount: (email: string) => `[data-identifier="${cssEscape(email)}"]`,
  oauthAnyAccount: '[data-identifier]',
  oauthApprove: '#submit_approve_access',
  // Google Sheets: left list ("Url"), the URL box, the worksheet column and options.
  sheetsSourceList: 'div.list-display-name',
  sheetsUrlInput: 'input[formcontrolname="urlOrSheetIDControl"]',
  sheetsWorksheet: 'div.display-property',
  sheetsOption: (control: 'hasHeader' | 'includeHiddenCells' | 'includeSpecificRange') =>
    `mat-checkbox[formcontrolname="${control}"]`,
  sheetsRangeInput: 'input[placeholder^="Example - "]',
  // PostgreSQL / MySQL "Basic" form.
  dbInput: (control: 'hostNameOrIp' | 'port' | 'database' | 'username' | 'password') =>
    `input[formcontrolname="${control}"]`,
  // Certificate rows: a file name box with a hint ("Server certificate") and an upload button.
  dbUploadButton: 'button.upload-button',
} as const;

export const SHEETS_URL_OPTION = 'Url';
export const DB_SSL_LABEL = 'Enable SSL';
export const DB_CLIENT_AUTH_LABEL = 'Enable client authentication';
export const DB_CERTIFICATE_HINT = {
  serverCertificate: 'Server certificate',
  clientCertificate: 'Client certificate',
  clientKey: 'Client private key',
} as const;

// ── Community visualizations ────────────────────────────────────────────
// Toolbar menu (featured cards), the Community Gallery panel, its "Build your
// own visualization" page and the consent dialog of third-party visualizations.
export const COMMUNITY_SEL = {
  toolbarButton: 'Community visualizations and components',
  cardName: 'div.card-name',
  exploreMore: '+ Explore more',
  buildYourOwn: 'Build your own visualization',
  manifestInput: 'input[name="manifestPath"]',
  manifestError: '.add-by-id-error',
  consentTitle: 'Grant consent',
  panelTitle: /^Community visualization/,
} as const;

// ── Custom query parameters ──

// Checkboxes under the SQL box of the BigQuery connector's CUSTOM QUERY tab.
export const CUSTOM_QUERY_OPTIONS = {
  dateRangeParams: 'Enable date range parameters',
  viewerEmailParam: 'Enable viewer email address parameter',
  // Dialog the viewer email option opens; its Allow button turns the option on.
  consentDialog: 'Grant consent',
} as const;

// "Grant consent" over the whole report, for data sources with viewer's
// credentials (and the viewer email parameter). Told apart from the community
// visualization consent, which shares its title, by the body text.
export const REPORT_CONSENT = {
  dialog: 'mat-dialog-container, [role=dialog]',
  text: /wants to use your information/i,
  allow: 'Allow',
  decline: 'Cancel',
} as const;

// ── Report check ──

// How a component shows its state. Charts and controls have a header (texts,
// shapes and images do not); while loading they show a shimmer; instead of
// data they show an error card ("Too Many Rows", "Invalid dimension", "User
// Configuration Error"…) whose "See details" opens a dialog, or "No data".
export const CHECK = {
  dataHeader: '.lego-component-header',
  loading: 'ng2-canvas-component-loading-shimmer',
  error: 'ng2-component-error',
  errorTitle: '.error-title',
  errorDescription: '.error-description',
  detailsLink: 'a.more',
  noData: '.noData',
  noDataText: 'No data',
  chartTitle: 'chart-title',
  // The "See details" dialog (AngularJS Material) repeats the card's title and
  // description, then adds Looker's message, the query error in a code block
  // and an error id.
  errorDialog: 'md-dialog.errorDialog',
  dialogParts: 'p.errorMessage, .error-code-block, .error-id p',
} as const;

// ── data sources ──
// The data source editor: header buttons, field rows and the connection page.
export const DATA_SOURCE = {
  credentialsButton: 'Change datasource credentials',
  freshnessButton: /^Data freshness/,
  editConnection: 'Go back',
  // A field row; its name is a contenteditable label.
  fieldRow: 'concept-field-entry',
  fieldName: '#datasource-field-name [contenteditable]',
  typeColumn: '.column.type',
  aggregationColumn: '.column.aggregation',
  typeDropdown: 'Dropdown to select field type',
  aggregationDropdown: 'Dropdown to select aggregation',
  // The field list's own search box (the Data panel has another).
  searchFields: 'Search fields',
  // The field type and aggregation menus are AngularJS md-menus.
  openMenu: '.md-open-menu-container',
  // The Data freshness dialog is an AngularJS md-dialog, not a mat-dialog.
  freshnessDialog: 'md-dialog.set-query-cache-policy-dialog',
  selectedOption: 'ng2-config-column-item:has(.list-option.selected) a[href]',
} as const;

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  '15 minutes': 'Every 15 minutes',
  '1 hour': 'Every hour',
  '4 hours': 'Every 4 hours',
  '12 hours': 'Every 12 hours',
};

export const CREDENTIALS_LABEL = { owner: "Owner's Credentials", viewer: "Viewer's Credentials" };

export const FIELD_AGGREGATION_LABEL: Record<FieldAggregation, string> = {
  none: 'None',
  sum: 'Sum',
  avg: 'Average',
  count: 'Count',
  count_distinct: 'Count Distinct',
  min: 'Min',
  max: 'Max',
  median: 'Median',
  std_dev: 'Standard Deviation',
  variance: 'Variance',
};

// ── Report specs ───────────────────────────────────────────────────────

// Style settings a spec keeps by default ("main"): how the component's card looks.
export const MAIN_STYLE = [
  'Background',
  'Border color',
  'Border radius',
  'Border weight',
  'Opacity',
  'Add border shadow',
  'Show data labels',
  'Display legend',
];

// Values of MAIN_STYLE that every new component already has: not worth re-applying.
export const MAIN_STYLE_NEUTRAL: Record<string, string | boolean> = {
  Opacity: '100%',
  'Border weight': 'None',
  'Add border shadow': false,
};

// Properties panel titles of the components that are neither charts nor controls.
export const PANEL_KIND = {
  text: /^Text\b/,
  shape: /^Shape\b/,
  image: /^Image\b/,
  line: /^Line properties$/,
  embed: /embed/i,
} as const;

// Setup sections a chart spec does not copy as extra `fields`: they are read
// into dimensions, metrics, breakdown and sort, or Looker Studio fills them itself.
export const SPEC_SKIPPED_SECTIONS =
  /^(Data source|Dimension|Row dimension|Metric|Primary field|Breakdown dimension|Sort( #\d+)?|Secondary sort|Date range dimension|Default date range|Filter|Row #\d+|Column #\d+)/i;

// Setup sections whose chips are opened to read their source field and aggregation.
export const SPEC_DETAILED_SECTIONS =
  /^(Dimension|Row dimension|Column dimension|Metric|Primary field|Breakdown dimension|Control field)/i;

// ── Report operations ──
// File › Make a copy, Share › Link settings, Share › Schedule delivery,
// File › Version history and File › Embed report.
export const REPORT_OPS = {
  // AngularJS dialogs (md-dialog), unlike the Angular Material ones.
  legacyDialog: 'md-dialog',
  copyDialogTitle: 'Copy this report',
  copyButton: 'Copy Report',
  // The copy form posts with an xsrf field the dialog leaves empty here; the
  // token is the RAP_XSRF_TOKEN cookie.
  copyXsrfInput: 'md-dialog input[name=xsrf]',
  xsrfCookie: 'RAP_XSRF_TOKEN',
  // Share dialog: the link access button shows the current level.
  linkAccessLabel: {
    restricted: 'Restricted',
    unlisted: 'Unlisted',
    public: 'Public',
  },
  shareMoreOptions: 'More options',
  scheduleMenuItem: 'Schedule delivery',
  scheduleTitle: 'Email delivery',
  scheduleRecipients: 'Search for person or group',
  scheduleDate: 'input.mat-datepicker-input',
  datepickerBackdrop: '.cdk-overlay-backdrop[class*=datepicker]',
  scheduled: 'This report is scheduled',
  editSchedule: 'Edit schedule',
  deleteSchedule: 'Delete schedule',
  // Rows of File › Version history (virtual-scrolled).
  versionItem: '.revision-item',
  versionName: 'input[aria-label="Revision name"], .revision-item-text-box',
  versionAuthors: '.revision-item-collaborator-name',
  currentVersion: '.current-version-label',
  versionViewport: 'cdk-virtual-scroll-viewport',
  restoreButton: 'Restore this version',
  embedDialog: 'md-dialog:has(.embedding-dialog)',
  embedEnable: 'Enable embedding',
  embedNavigation: 'Show report navigation in embedded mode',
} as const;
