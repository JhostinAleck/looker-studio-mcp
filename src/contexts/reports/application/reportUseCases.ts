import type {
  CalculatedFieldSpec,
  ComponentChange,
  ImageSpec,
  PlaceOptions,
  ReportPage,
  ReportRepository,
  ShapeSpec,
  TextSpec,
  ThemeSpec,
} from '@/contexts/reports/domain/ReportRepository.js';
import {
  type BigQuerySource,
  type ChartSpec,
  type ComponentDetails,
  type ComponentInfo,
  type ControlSpec,
  type ReportSummary,
  type StyleSettings,
  HEX_COLOR_RE,
  InvalidChartError,
  parseReportId,
  validateChart,
  validateControl,
  validateDataSettings,
  validateLayout,
  validateSettings,
} from '@/contexts/reports/domain/Report.js';
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
  source: BigQuerySource,
): Promise<ReportSummary> {
  return repo.createReport(name.trim(), source);
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
  source: BigQuerySource,
): Promise<void> {
  return repo.addDataSource(parseReportId(report), source);
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
    Object.keys(change.valueColors ?? {}).length > 0;
  if (
    !change.layout &&
    !change.style &&
    !change.setup &&
    !change.order &&
    change.reportLevel === undefined &&
    labels.length === 0 &&
    !data
  ) {
    throw new InvalidChartError(
      'Nothing to change: pass layout, style, setup, labels, order, report_level or a data setting (fields, filters, date_range, comparison, series, value_colors).',
    );
  }
  return repo.updateComponent(parseReportId(report), index, change, page);
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
