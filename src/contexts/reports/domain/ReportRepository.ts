import type {
  BigQuerySource,
  ButtonSpec,
  ChartSpec,
  ChartType,
  ComponentDetails,
  ComponentInfo,
  ControlSpec,
  DataSettings,
  FilterSpec,
  Layout,
  ReportSummary,
  StyleSettings,
} from './Report.js';
import type {
  CopiedReport,
  DataSourceReplacement,
  DeliveryInfo,
  DeliverySchedule,
  EmbedInfo,
  EmbedOptions,
  LinkSharing,
  ReportVersion,
} from './reportOps.js';

export interface ReportPage {
  index: number;
  name: string;
}

export interface PlaceOptions {
  // 1-based page; defaults to the first page.
  page?: number;
  layout?: Partial<Layout>;
}

export interface TextSpec {
  text: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  background?: string;
  align?: 'left' | 'center' | 'right';
}

export const SHAPE_KINDS = [
  'rectangle',
  'circle',
  'triangle',
  'heart',
  'diamond',
  'pentagon',
  'star',
  'hexagon',
  'octagon',
  'cylinder',
  'arrow_right',
  'arrow_left',
  'arrow_up',
  'arrow_down',
  'callout',
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export interface ShapeSpec {
  shape: ShapeKind;
  background?: string;
  borderColor?: string;
  borderRadius?: number;
}

export interface ImageSpec {
  // A local PNG, JPG, GIF or SVG file.
  path: string;
  altText?: string;
}

export interface CalculatedFieldSpec {
  name: string;
  // Looker Studio formula, e.g. COUNT_DISTINCT(uid) or CASE WHEN … END.
  formula: string;
}

// A straight line between two points of the canvas (report px).
export interface LineSpec {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color?: string;
  // "Solid", "Dashed", "Dotted"…
  borderStyle?: string;
  // "None", "Circle", "Diamond" or "Pointer" (an arrow head) at each end.
  start?: string;
  end?: string;
}

export const ARRANGE_ACTIONS = [
  'align_left',
  'align_center',
  'align_right',
  'align_top',
  'align_middle',
  'align_bottom',
  'distribute_horizontally',
  'distribute_vertically',
  'group',
  'ungroup',
] as const;
export type ArrangeAction = (typeof ARRANGE_ACTIONS)[number];

export const PAGE_ACTIONS = [
  'delete',
  'duplicate',
  'hide',
  'show',
  'move_up',
  'move_down',
  'move_top',
  'move_bottom',
] as const;
export type PageAction = (typeof PAGE_ACTIONS)[number];

// Filters and the date range of a whole page (Page › Current page settings)
// or of the whole report (File › Report settings).
export interface ScopeSettings {
  dataSource?: string;
  filters?: FilterSpec[];
  dateRangeDimension?: string;
  dateRange?: string;
  // Page only: Style tab settings ("Page background", "Width (px)"…).
  style?: StyleSettings;
}

export interface ParameterSpec {
  name: string;
  id?: string;
  dataType?: 'Text' | 'Number (whole)' | 'Number (decimal)' | 'Boolean';
  // Permitted values: a list, or any value when omitted.
  values?: string[];
  defaultValue?: string;
}

export interface GroupFieldSpec {
  name: string;
  field: string;
  groups: Array<{ name: string; condition: string; values: string[]; exclude?: boolean }>;
  // Name of the group for everything else; ungrouped values stay as they are when omitted.
  otherGroup?: string;
}

export interface BinFieldSpec {
  name: string;
  field: string;
  size: number;
  min?: number;
  max?: number;
}

export interface BlendTable {
  dataSource: string;
  dimensions: string[];
  metrics: string[];
}

export interface BlendSpec {
  name: string;
  tables: BlendTable[];
  // One per table after the first: how it joins the tables to its left.
  joins: Array<{
    type?: 'left outer' | 'right outer' | 'inner' | 'full outer' | 'cross';
    // Pairs of [field on the left, field of this table].
    keys: Array<[string, string]>;
  }>;
}

export const ORDER_MOVES = ['front', 'back', 'forward', 'backward'] as const;
export type OrderMove = (typeof ORDER_MOVES)[number];

// What updateComponent can change. `order` restacks the component, which
// changes its index: the result reports the new one.
export interface ComponentChange extends DataSettings {
  layout?: Partial<Layout>;
  style?: StyleSettings;
  setup?: StyleSettings;
  order?: OrderMove;
  // Shows the component on every page (headers, logos, navigation).
  reportLevel?: boolean;
  // Display names for a chart's fields, by current name: {"Record Count": "Total uses"}.
  labels?: Record<string, string>;
  // Switches the chart to another type, keeping its fields where they fit.
  chartType?: ChartType;
  button?: ButtonSpec;
  // URL Embed components: the page they show.
  embedUrl?: string;
}

export interface ThemeSpec {
  // A built-in theme by name (Default, Edge, Constellation, Ocean, Simple Dark…).
  preset?: string;
  // Edit Theme fields by label, e.g. {"Report background color": "#0B1020"}.
  settings?: StyleSettings;
  canvas?: { width?: number; height?: number };
  // Theme and layout › Layout settings by label: {"Navigation type": "Tab"}.
  layout?: StyleSettings;
}

export interface ReportRepository {
  listReports(): Promise<ReportSummary[]>;
  createReport(name: string, source: BigQuerySource): Promise<ReportSummary>;
  addDataSource(reportId: string, source: BigQuerySource): Promise<void>;
  // Re-reads the fields of the report's data sources (all, or the one named):
  // a column added to a table or view is invisible until then. Returns the new fields.
  refreshDataSources(reportId: string, name?: string): Promise<string[]>;
  addChart(
    reportId: string,
    chart: ChartSpec,
    opts: PlaceOptions & { dataSource?: string; style?: StyleSettings },
  ): Promise<ComponentInfo>;
  addText(
    reportId: string,
    text: TextSpec,
    opts: PlaceOptions & { style?: StyleSettings },
  ): Promise<ComponentInfo>;
  addShape(
    reportId: string,
    shape: ShapeSpec,
    opts: PlaceOptions & { style?: StyleSettings },
  ): Promise<ComponentInfo>;
  addControl(
    reportId: string,
    control: ControlSpec,
    opts: PlaceOptions & { dataSource?: string; style?: StyleSettings },
  ): Promise<ComponentInfo>;
  addImage(
    reportId: string,
    image: ImageSpec,
    opts: PlaceOptions & { style?: StyleSettings },
  ): Promise<ComponentInfo>;
  // Adds a calculated field to a data source (the report's only one when `dataSource` is omitted).
  addCalculatedField(
    reportId: string,
    field: CalculatedFieldSpec,
    dataSource?: string,
  ): Promise<void>;
  addLine(
    reportId: string,
    line: LineSpec,
    opts: { page?: number; style?: StyleSettings },
  ): Promise<ComponentInfo>;
  addEmbed(
    reportId: string,
    url: string,
    opts: PlaceOptions & { style?: StyleSettings },
  ): Promise<ComponentInfo>;
  duplicateComponent(
    reportId: string,
    index: number,
    layout?: Partial<Layout>,
    page?: number,
  ): Promise<ComponentInfo>;
  arrangeComponents(
    reportId: string,
    indexes: number[],
    action: ArrangeAction,
    page?: number,
  ): Promise<ComponentInfo[]>;
  managePage(reportId: string, page: number, action: PageAction): Promise<ReportPage[]>;
  setScopeSettings(
    reportId: string,
    scope: 'page' | 'report',
    settings: ScopeSettings,
    page?: number,
  ): Promise<string[]>;
  // Edits (replaces the clauses of), duplicates or removes a filter of the report.
  manageFilter(
    reportId: string,
    action: 'edit' | 'duplicate' | 'delete',
    name: string,
    filter?: FilterSpec,
  ): Promise<void>;
  addParameter(reportId: string, parameter: ParameterSpec, dataSource?: string): Promise<void>;
  addGroupField(reportId: string, group: GroupFieldSpec, dataSource?: string): Promise<void>;
  addBinField(reportId: string, bin: BinFieldSpec, dataSource?: string): Promise<void>;
  createBlend(reportId: string, blend: BlendSpec): Promise<void>;
  listComponents(reportId: string, page?: number): Promise<ComponentInfo[]>;
  // Every setting of a component (Setup and Style tabs) with its current value.
  describeComponent(reportId: string, index: number, page?: number): Promise<ComponentDetails>;
  updateComponent(
    reportId: string,
    index: number,
    change: ComponentChange,
    page?: number,
  ): Promise<ComponentInfo>;
  deleteComponent(reportId: string, index: number, page?: number): Promise<void>;
  setTheme(reportId: string, theme: ThemeSpec): Promise<void>;
  addPage(reportId: string, name: string): Promise<ReportPage>;
  renamePage(reportId: string, page: number, name: string): Promise<void>;
  listPages(reportId: string): Promise<ReportPage[]>;
  renameReport(reportId: string, name: string): Promise<void>;
  // One invitation for every address; `notify` sends Google's sharing email.
  shareReport(
    reportId: string,
    emails: string[],
    role: 'viewer' | 'editor',
    notify: boolean,
  ): Promise<void>;
  // PNG of the report in view mode; returns the saved file path.
  screenshot(reportId: string, page?: number): Promise<string>;
  deleteReport(reportId: string): Promise<void>;

  // ── Report operations ──
  // File › Make a copy; `replacements` reconnect data sources of the copy.
  copyReport(
    reportId: string,
    name: string,
    replacements: DataSourceReplacement[],
  ): Promise<CopiedReport>;
  setLinkSharing(reportId: string, sharing: LinkSharing): Promise<LinkSharing>;
  // Creates the report's email schedule, or replaces the existing one.
  scheduleDelivery(reportId: string, schedule: DeliverySchedule): Promise<DeliveryInfo>;
  // The signed-in account's schedule of the report; null when there is none.
  getDelivery(reportId: string): Promise<DeliveryInfo | null>;
  // False when the report had no schedule.
  removeDelivery(reportId: string): Promise<boolean>;
  listVersions(reportId: string): Promise<ReportVersion[]>;
  restoreVersion(reportId: string, version: number | string): Promise<ReportVersion>;
  // Turns embedding on when it is off.
  getEmbed(reportId: string, opts: EmbedOptions): Promise<EmbedInfo>;
}
