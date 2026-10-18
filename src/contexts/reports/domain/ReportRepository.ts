import type {
  BigQuerySource,
  ChartSpec,
  ComponentDetails,
  ComponentInfo,
  Layout,
  ReportSummary,
  StyleSettings,
} from './Report.js';

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
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export interface ShapeSpec {
  shape: ShapeKind;
  background?: string;
  borderColor?: string;
  borderRadius?: number;
}

export const ORDER_MOVES = ['front', 'back', 'forward', 'backward'] as const;
export type OrderMove = (typeof ORDER_MOVES)[number];

// What updateComponent can change. `order` restacks the component, which
// changes its index: the result reports the new one.
export interface ComponentChange {
  layout?: Partial<Layout>;
  style?: StyleSettings;
  setup?: StyleSettings;
  order?: OrderMove;
  // Shows the component on every page (headers, logos, navigation).
  reportLevel?: boolean;
  // Display names for a chart's fields, by current name: {"Record Count": "Total uses"}.
  labels?: Record<string, string>;
}

export interface ThemeSpec {
  // A built-in theme by name (Default, Edge, Constellation, Ocean, Simple Dark…).
  preset?: string;
  // Edit Theme fields by label, e.g. {"Report background color": "#0B1020"}.
  settings?: StyleSettings;
  canvas?: { width?: number; height?: number };
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
}
