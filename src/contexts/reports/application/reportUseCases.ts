import type {
  ArrangeAction,
  BinFieldSpec,
  BlendSpec,
  CalculatedFieldSpec,
  ComponentChange,
  GroupFieldSpec,
  ImageSpec,
  LineSpec,
  PageAction,
  ParameterSpec,
  PlaceOptions,
  ReportPage,
  ReportRepository,
  ScopeSettings,
  ShapeSpec,
  TextSpec,
  ThemeSpec,
} from '@/contexts/reports/domain/ReportRepository.js';
import {
  type ChartSpec,
  type ComponentDetails,
  type ComponentInfo,
  type ControlSpec,
  type FilterSpec,
  type Layout,
  type ReportCheck,
  type ReportSummary,
  type StyleSettings,
  HEX_COLOR_RE,
  InvalidChartError,
  parseReportId,
  validateChart,
  validateControl,
  validateDataSettings,
  validateDateRange,
  validateFilter,
  validateLayout,
  validateSettings,
} from '@/contexts/reports/domain/Report.js';
import {
  type CommunityVizSpec,
  validateCommunityViz,
} from '@/contexts/reports/domain/community.js';
import { type DataSource, validateDataSource } from '@/contexts/reports/domain/connectors.js';
import { DomainError } from '@/shared-kernel/errors/DomainError.js';

export class ReportNameMismatchError extends DomainError {
  readonly code = 'REPORT_NAME_MISMATCH';
  readonly userMessage: string;

  constructor(expected: string | null, given: string) {
    super(`confirm_name "${given}" does not match`);
    this.userMessage = expected
      ? `Not deleted: the report is called "${expected}", not "${given}".`
      : 'Not deleted: no report with that id was found in your Looker Studio.';
  }
}

export async function listReports(
  repo: ReportRepository,
  query?: string,
): Promise<ReportSummary[]> {
  const reports = await repo.listReports();
  if (!query) return reports;
  const needle = query.toLowerCase();
  return reports.filter((r) => r.name.toLowerCase().includes(needle));
}

export async function createReport(
  repo: ReportRepository,
  name: string,
  source: DataSource,
): Promise<ReportSummary> {
  return repo.createReport(name.trim(), validateDataSource(source));
}

export async function refreshDataSources(
  repo: ReportRepository,
  report: string,
  name?: string,
): Promise<string[]> {
  return repo.refreshDataSources(parseReportId(report), name?.trim() || undefined);
}

export async function addDataSource(
  repo: ReportRepository,
  report: string,
  source: DataSource,
): Promise<void> {
  return repo.addDataSource(parseReportId(report), validateDataSource(source));
}

type StyledPlace = PlaceOptions & { style?: StyleSettings };
type ChartOptions = StyledPlace & { dataSource?: string };

function checkPlace<T extends StyledPlace>(opts: T): T {
  if (opts.layout) validateLayout(opts.layout);
  if (opts.style) validateSettings(opts.style);
  return opts;
}

function checkColor(label: string, value: string | undefined): void {
  if (value !== undefined && !HEX_COLOR_RE.test(value)) {
    throw new InvalidChartError(`${label} must be a #RRGGBB color, got "${value}".`);
  }
}

export async function addChart(
  repo: ReportRepository,
  report: string,
  chart: ChartSpec,
  opts: ChartOptions = {},
): Promise<ComponentInfo> {
  return repo.addChart(parseReportId(report), validateChart(chart), checkPlace(opts));
}

export async function addText(
  repo: ReportRepository,
  report: string,
  text: TextSpec,
  opts: StyledPlace = {},
): Promise<ComponentInfo> {
  if (!text.text.trim()) throw new InvalidChartError('The text cannot be empty.');
  checkColor('color', text.color);
  checkColor('background', text.background);
  if (text.fontSize !== undefined && (text.fontSize < 6 || text.fontSize > 400)) {
    throw new InvalidChartError('font_size must be between 6 and 400.');
  }
  return repo.addText(parseReportId(report), text, checkPlace(opts));
}

export async function addShape(
  repo: ReportRepository,
  report: string,
  shape: ShapeSpec,
  opts: StyledPlace = {},
): Promise<ComponentInfo> {
  checkColor('background', shape.background);
  checkColor('border_color', shape.borderColor);
  return repo.addShape(parseReportId(report), shape, checkPlace(opts));
}

export async function addControl(
  repo: ReportRepository,
  report: string,
  control: ControlSpec,
  opts: ChartOptions = {},
): Promise<ComponentInfo> {
  return repo.addControl(parseReportId(report), validateControl(control), checkPlace(opts));
}

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp)$/i;

export async function addImage(
  repo: ReportRepository,
  report: string,
  image: ImageSpec,
  opts: StyledPlace = {},
  // Size in bytes of the file, or null when there is none.
  sizeOf: (path: string) => number | null = () => 1,
): Promise<ComponentInfo> {
  if (!IMAGE_RE.test(image.path)) {
    throw new InvalidChartError('The image must be a .png, .jpg, .gif, .svg or .webp file.');
  }
  const size = sizeOf(image.path);
  if (size === null) throw new InvalidChartError(`No file at ${image.path}.`);
  if (size === 0) throw new InvalidChartError(`${image.path} is empty.`);
  return repo.addImage(parseReportId(report), image, checkPlace(opts));
}

export async function addCalculatedField(
  repo: ReportRepository,
  report: string,
  field: CalculatedFieldSpec,
  dataSource?: string,
): Promise<void> {
  const name = field.name.trim();
  const formula = field.formula.trim();
  if (!name) throw new InvalidChartError('The field needs a name.');
  if (!formula) throw new InvalidChartError('The field needs a formula.');
  return repo.addCalculatedField(
    parseReportId(report),
    { name, formula },
    dataSource?.trim() || undefined,
  );
}

export async function listComponents(
  repo: ReportRepository,
  report: string,
  page?: number,
): Promise<ComponentInfo[]> {
  return repo.listComponents(parseReportId(report), page);
}

export async function describeComponent(
  repo: ReportRepository,
  report: string,
  index: number,
  page?: number,
): Promise<ComponentDetails> {
  return repo.describeComponent(parseReportId(report), index, page);
}

export async function updateComponent(
  repo: ReportRepository,
  report: string,
  index: number,
  change: ComponentChange,
  page?: number,
): Promise<ComponentInfo> {
  if (change.layout) validateLayout(change.layout);
  if (change.style) validateSettings(change.style);
  if (change.setup) validateSettings(change.setup);
  validateDataSettings(change);
  const labels = Object.entries(change.labels ?? {});
  if (labels.some(([from, to]) => !from.trim() || !to.trim())) {
    throw new InvalidChartError('Field labels cannot be empty.');
  }
  const data =
    Object.keys(change.fields ?? {}).length > 0 ||
    (change.filters?.length ?? 0) > 0 ||
    !!change.dateRange ||
    !!change.comparison ||
    (change.series?.length ?? 0) > 0 ||
    Object.keys(change.valueColors ?? {}).length > 0 ||
    (change.sorts?.length ?? 0) > 0 ||
    (change.referenceLines?.length ?? 0) > 0 ||
    (change.referenceBands?.length ?? 0) > 0 ||
    (change.conditionalFormats?.length ?? 0) > 0;
  if (change.button) validateControl({ kind: 'button', button: change.button });
  if (change.embedUrl !== undefined) checkUrl(change.embedUrl);
  if (
    !change.layout &&
    !change.style &&
    !change.setup &&
    !change.order &&
    change.reportLevel === undefined &&
    labels.length === 0 &&
    !change.chartType &&
    !change.button &&
    change.embedUrl === undefined &&
    !data
  ) {
    throw new InvalidChartError(
      'Nothing to change: pass layout, style, setup, labels, order, report_level, chart_type, button, embed_url or a data setting (fields, filters, date_range, comparison, series, value_colors, sorts, reference_lines, reference_bands, conditional_formats).',
    );
  }
  return repo.updateComponent(parseReportId(report), index, change, page);
}

function checkUrl(url: string): void {
  if (!/^https?:\/\/\S+$/i.test(url.trim())) {
    throw new InvalidChartError(`"${url}" is not an http(s) URL.`);
  }
}

export async function addLine(
  repo: ReportRepository,
  report: string,
  line: LineSpec,
  opts: { page?: number; style?: StyleSettings } = {},
): Promise<ComponentInfo> {
  for (const p of [line.from, line.to]) {
    if (p.x < 0 || p.y < 0) throw new InvalidChartError('Line ends must be inside the canvas.');
  }
  if (line.from.x === line.to.x && line.from.y === line.to.y) {
    throw new InvalidChartError('A line needs two different ends.');
  }
  checkColor('color', line.color);
  if (opts.style) validateSettings(opts.style);
  return repo.addLine(parseReportId(report), line, opts);
}

export async function addEmbed(
  repo: ReportRepository,
  report: string,
  url: string,
  opts: StyledPlace = {},
): Promise<ComponentInfo> {
  checkUrl(url);
  return repo.addEmbed(parseReportId(report), url.trim(), checkPlace(opts));
}

export async function duplicateComponent(
  repo: ReportRepository,
  report: string,
  index: number,
  layout?: Partial<Layout>,
  page?: number,
): Promise<ComponentInfo> {
  if (layout) validateLayout(layout);
  return repo.duplicateComponent(parseReportId(report), index, layout, page);
}

export async function arrangeComponents(
  repo: ReportRepository,
  report: string,
  indexes: number[],
  action: ArrangeAction,
  page?: number,
): Promise<ComponentInfo[]> {
  const unique = [...new Set(indexes)];
  const min = action.startsWith('distribute') ? 3 : action === 'ungroup' ? 1 : 2;
  if (unique.length < min) {
    throw new InvalidChartError(`${action} needs at least ${min} different components.`);
  }
  return repo.arrangeComponents(parseReportId(report), unique, action, page);
}

export async function managePage(
  repo: ReportRepository,
  report: string,
  page: number,
  action: PageAction,
): Promise<ReportPage[]> {
  if (!Number.isInteger(page) || page < 1) throw new InvalidChartError('page is 1-based.');
  return repo.managePage(parseReportId(report), page, action);
}

export async function setScopeSettings(
  repo: ReportRepository,
  report: string,
  scope: 'page' | 'report',
  settings: ScopeSettings,
  page?: number,
): Promise<string[]> {
  for (const filter of settings.filters ?? []) validateFilter(filter);
  if (settings.dateRange !== undefined) validateDateRange(settings.dateRange);
  if (settings.style) validateSettings(settings.style);
  if (Object.values(settings).every((v) => v === undefined || (Array.isArray(v) && !v.length))) {
    throw new InvalidChartError(
      'Nothing to set: pass data_source, filters, date_range_dimension, date_range or style.',
    );
  }
  return repo.setScopeSettings(parseReportId(report), scope, settings, page);
}

export async function manageFilter(
  repo: ReportRepository,
  report: string,
  action: 'edit' | 'duplicate' | 'delete',
  name: string,
  filter?: FilterSpec,
): Promise<void> {
  if (!name.trim()) throw new InvalidChartError('Name the filter.');
  if (action === 'edit') {
    if (!filter) throw new InvalidChartError('An edit needs the new clauses or name.');
    validateFilter(filter);
  }
  return repo.manageFilter(parseReportId(report), action, name.trim(), filter);
}

export async function addParameter(
  repo: ReportRepository,
  report: string,
  parameter: ParameterSpec,
  dataSource?: string,
): Promise<void> {
  if (!parameter.name.trim()) throw new InvalidChartError('The parameter needs a name.');
  if (parameter.id !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(parameter.id)) {
    throw new InvalidChartError('The parameter id takes letters, digits and _ only.');
  }
  return repo.addParameter(parseReportId(report), parameter, dataSource?.trim() || undefined);
}

export async function addGroupField(
  repo: ReportRepository,
  report: string,
  group: GroupFieldSpec,
  dataSource?: string,
): Promise<void> {
  if (!group.name.trim() || !group.field.trim())
    throw new InvalidChartError('The group field needs a name and the field it groups.');
  if (!group.groups.length) throw new InvalidChartError('Define at least one group.');
  for (const g of group.groups) {
    if (!g.name.trim()) throw new InvalidChartError('Every group needs a name.');
    if (!g.values.length && !/null|blank|any/i.test(g.condition))
      throw new InvalidChartError(`Group "${g.name}" needs values.`);
  }
  return repo.addGroupField(parseReportId(report), group, dataSource?.trim() || undefined);
}

export async function addBinField(
  repo: ReportRepository,
  report: string,
  bin: BinFieldSpec,
  dataSource?: string,
): Promise<void> {
  if (!bin.name.trim() || !bin.field.trim())
    throw new InvalidChartError('The bin field needs a name and the numeric field it bins.');
  if (!(bin.size > 0)) throw new InvalidChartError('The bin size must be positive.');
  if (bin.min !== undefined && bin.max !== undefined && bin.min >= bin.max)
    throw new InvalidChartError('min must be below max.');
  return repo.addBinField(parseReportId(report), bin, dataSource?.trim() || undefined);
}

export async function createBlend(
  repo: ReportRepository,
  report: string,
  blend: BlendSpec,
): Promise<void> {
  if (!blend.name.trim()) throw new InvalidChartError('The blend needs a name.');
  if (blend.tables.length < 2 || blend.tables.length > 5)
    throw new InvalidChartError('A blend joins 2 to 5 tables.');
  if (blend.joins.length !== blend.tables.length - 1)
    throw new InvalidChartError('Give one join per table after the first.');
  for (const [i, join] of blend.joins.entries()) {
    if (join.type !== 'cross' && !join.keys.length)
      throw new InvalidChartError(`Join ${i + 1} needs at least one pair of key fields.`);
  }
  for (const t of blend.tables) {
    if (!t.dimensions.length && !t.metrics.length)
      throw new InvalidChartError(`Table ${t.dataSource} needs a dimension or a metric.`);
  }
  return repo.createBlend(parseReportId(report), blend);
}

export async function deleteComponent(
  repo: ReportRepository,
  report: string,
  index: number,
  page?: number,
): Promise<void> {
  return repo.deleteComponent(parseReportId(report), index, page);
}

export async function setTheme(
  repo: ReportRepository,
  report: string,
  theme: ThemeSpec,
): Promise<void> {
  if (!theme.preset && !theme.settings && !theme.canvas && !theme.layout) {
    throw new InvalidChartError('Pass a preset, settings, layout settings or a canvas size.');
  }
  if (theme.settings) validateSettings(theme.settings);
  if (theme.layout) validateSettings(theme.layout);
  if (theme.canvas) validateLayout({ ...theme.canvas });
  return repo.setTheme(parseReportId(report), theme);
}

export async function addPage(
  repo: ReportRepository,
  report: string,
  name: string,
): Promise<ReportPage> {
  return repo.addPage(parseReportId(report), name.trim());
}

export async function renamePage(
  repo: ReportRepository,
  report: string,
  page: number,
  name: string,
): Promise<void> {
  if (!name.trim()) throw new InvalidChartError('The page name cannot be empty.');
  if (!Number.isInteger(page) || page < 1) throw new InvalidChartError('page is 1-based.');
  return repo.renamePage(parseReportId(report), page, name.trim());
}

export async function listPages(repo: ReportRepository, report: string): Promise<ReportPage[]> {
  return repo.listPages(parseReportId(report));
}

export async function renameReport(
  repo: ReportRepository,
  report: string,
  name: string,
): Promise<void> {
  return repo.renameReport(parseReportId(report), name.trim());
}

export async function shareReport(
  repo: ReportRepository,
  report: string,
  emails: string[],
  role: 'viewer' | 'editor',
  notify = true,
): Promise<void> {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (unique.length === 0) throw new InvalidChartError('Pass at least one email address.');
  const bad = unique.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad.length) throw new InvalidChartError(`Not email addresses: ${bad.join(', ')}.`);
  return repo.shareReport(parseReportId(report), unique, role, notify);
}

export async function screenshotReport(
  repo: ReportRepository,
  report: string,
  page?: number,
): Promise<string> {
  return repo.screenshot(parseReportId(report), page);
}

// Deleting needs the exact report name, so a wrong id never removes another report.
export async function deleteReport(
  repo: ReportRepository,
  report: string,
  confirmName: string,
): Promise<void> {
  const id = parseReportId(report);
  const found = (await repo.listReports()).find((r) => r.id === id);
  if (!found || found.name !== confirmName) {
    throw new ReportNameMismatchError(found?.name ?? null, confirmName);
  }
  await repo.deleteReport(id);
}

// ── Community visualizations ──

export async function addCommunityViz(
  repo: ReportRepository,
  report: string,
  viz: CommunityVizSpec,
  opts: ChartOptions = {},
): Promise<ComponentInfo> {
  return repo.addCommunityViz(parseReportId(report), validateCommunityViz(viz), checkPlace(opts));
}

// ── Report check ──

export async function checkReport(
  repo: ReportRepository,
  report: string,
  opts: { page?: number; timeoutSeconds: number },
): Promise<ReportCheck> {
  if (
    !Number.isInteger(opts.timeoutSeconds) ||
    opts.timeoutSeconds < 5 ||
    opts.timeoutSeconds > 300
  )
    throw new InvalidChartError('timeout_seconds must be a whole number between 5 and 300.');
  return repo.checkReport(parseReportId(report), {
    ...(opts.page ? { page: opts.page } : {}),
    timeoutMs: opts.timeoutSeconds * 1000,
  });
}
