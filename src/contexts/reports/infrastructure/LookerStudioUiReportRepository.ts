import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Locator, Page } from 'playwright';

import type { BrowserSession } from '@/contexts/authentication/domain/BrowserSession.js';
import type {
  ArrangeAction,
  BinFieldSpec,
  ComponentSnapshot,
  DataSourceSnapshot,
  ReportSnapshot,
  StyleDepth,
  BlendSpec,
  CalculatedFieldSpec,
  ComponentChange,
  GroupFieldSpec,
  ImageSpec,
  LineSpec,
  OrderMove,
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
  type ChartProblem,
  type ReportCheck,
  chartProblem,
} from '@/contexts/reports/domain/Report.js';
import {
  type DataSourceChange,
  type DataSourceField,
  type DataSourceInfo,
  type DataSourceRow,
  type FieldChange,
  DataSourceInUseError,
  DataSourceNotFoundError,
  chartsUsing,
  fieldTypePath,
  findDataSource,
  isUsed,
  parseConnectionChanges,
  parseConsoleLink,
  parseFreshness,
} from '@/contexts/reports/domain/DataSource.js';
import {
  type CopiedReport,
  type DataSourceReplacement,
  type DeliveryInfo,
  type DeliverySchedule,
  type EmbedInfo,
  type EmbedOptions,
  type LinkSharing,
  type ReportVersion,
  type DeliveryControl,
  type DeliveryFilter,
  REPEAT_OPTION,
  WEEKDAYS,
  findVersion,
  pickDeliveryControl,
  scheduleDateLabel,
  scheduleTimeLabel,
  timeZoneOffset,
} from '@/contexts/reports/domain/reportOps.js';
import {
  type Aggregation,
  type ChartSpec,
  type ChartType,
  type ComponentDetails,
  type ControlKind,
  type MetricSpec,
  type SettingInfo,
  type ComponentInfo,
  type ControlSpec,
  type DataSettings,
  type FilterClause,
  type FilterSpec,
  type Layout,
  type ReportSummary,
  type StyleSettings,
  cssColorToHex,
  describeSource,
  filterClauses,
  isQuerySource,
  reportUrl,
} from '@/contexts/reports/domain/Report.js';
import {
  type CommunityVizSpec,
  describeCommunityViz,
} from '@/contexts/reports/domain/community.js';
import { type DataSource, sourceName } from '@/contexts/reports/domain/connectors.js';
import type { Logger } from '@/shared-kernel/logging/Logger.js';

import { EditorStepError, LookerStudioEditor } from './ui/LookerStudioEditor.js';
import {
  ARRANGE_PATHS,
  BASE,
  CHART_PRESETS,
  COMMUNITY_SEL,
  CONTROL_LABELS,
  CREDENTIALS_LABEL,
  DATA_SOURCE,
  FIELD_AGGREGATION_LABEL,
  FRESHNESS_LABEL,
  FILTER_CONDITIONS,
  HL,
  MAIN_STYLE,
  MAIN_STYLE_NEUTRAL,
  PAGE_MENU,
  PANEL_KIND,
  PANEL_TITLE_HINT,
  PRESET_ORDER,
  REPORT_OPS,
  scheduleEveryOption,
  SECTION,
  SEL,
  SHAPE_PATHS,
  SPEC_DETAILED_SECTIONS,
  SPEC_SKIPPED_SECTIONS,
  cssEscape,
  escapeRegExp,
  sectionNamed,
} from './ui/selectors.js';

export interface LookerStudioUiOptions {
  browser: BrowserSession<Page>;
  stepTimeoutMs: number;
  screenshotsDir: string;
  logger: Logger;
}

const AGGREGATION_LABEL: Record<Aggregation, string> = {
  sum: 'Sum',
  avg: 'Average',
  count: 'Count',
  count_distinct: 'Count Distinct',
  min: 'Min',
  max: 'Max',
  none: 'None',
};

const ORDER_LABEL: Record<OrderMove, string> = {
  front: 'Bring to front',
  back: 'Send to back',
  forward: 'Bring forward',
  backward: 'Send backward',
};

const PIVOTS: ChartType[] = ['pivot_table', 'pivot_bars', 'pivot_heatmap'];

const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  scorecard: { width: 220, height: 120 },
  text: { width: 400, height: 50 },
};

// An editor kept open by inOneVisit for the calls made inside it.
interface EditorVisit {
  reportId: string;
  editor: LookerStudioEditor;
  restores: Array<() => Promise<void>>;
  // A failed action can leave a dialog or panel open: the next one reloads the editor.
  dirty: boolean;
}

// Looker Studio has no API to edit reports, so this adapter drives the editor
// in the signed-in Chrome profile, one action per page visit (or several, inside inOneVisit).
export class LookerStudioUiReportRepository implements ReportRepository {
  private readonly visit = new AsyncLocalStorage<EditorVisit>();

  constructor(private readonly opts: LookerStudioUiOptions) {}

  private edit<T>(
    reportId: string,
    work: (editor: LookerStudioEditor) => Promise<T>,
    opts: { visible?: boolean; timeZone?: string } = {},
  ): Promise<T> {
    const visit = this.visit.getStore();
    if (visit?.reportId === reportId) return this.inVisit(visit, work);
    const { timeZone, ...pageOpts } = opts;
    return this.opts.browser.withPage(async (page) => {
      // Some dialogs (Schedule delivery) take the browser's time zone.
      if (timeZone) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setTimezoneOverride', { timezoneId: timeZone });
      }
      const editor = await LookerStudioEditor.openReport(page, reportId, this.opts.stepTimeoutMs);
      // Pointer work only reaches what is on screen: make the whole page fit.
      const restore = await this.fitWindowTo(page, page.locator(SEL.canvas).first());
      try {
        const result = await work(editor);
        // Lets autosave finish before the tab closes.
        await editor.settleBeforeClose();
        return result;
      } catch (err) {
        // Keep what the editor showed when a step failed, to debug it.
        mkdirSync(this.opts.screenshotsDir, { recursive: true });
        const shot = join(this.opts.screenshotsDir, `error-${reportId}-${Date.now()}.png`);
        await page.screenshot({ path: shot }).then(
          () => this.opts.logger.warn(`editor step failed; screenshot at ${shot}`),
          () => undefined,
        );
        throw err;
      } finally {
        await restore();
      }
    }, pageOpts);
  }

  async listReports(): Promise<ReportSummary[]> {
    return this.opts.browser.withPage(async (page) => {
      await page.goto(`${BASE}/navigation/reporting?${HL}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
      await page
        .locator('a[href*="/reporting/"]')
        .first()
        .waitFor({ timeout: 10_000 })
        .catch(() => undefined);
      const rows = await page.locator('a[href*="/reporting/"]').evaluateAll((links) =>
        links.map((a) => ({
          href: a.getAttribute('href') ?? '',
          name: (a as HTMLElement).innerText.trim(),
        })),
      );
      const seen = new Map<string, ReportSummary>();
      for (const row of rows) {
        const id = /\/reporting\/([0-9a-f-]{36})/i.exec(row.href)?.[1]?.toLowerCase();
        if (id && row.name && !seen.has(id))
          seen.set(id, { id, name: row.name, url: reportUrl(id) });
      }
      return [...seen.values()];
    });
  }

  async createReport(name: string, source: DataSource): Promise<ReportSummary> {
    return this.opts.browser.withPage(async (page) => {
      const editor = await LookerStudioEditor.openNew(page, this.opts.stepTimeoutMs);
      await editor.connectSource(source);
      const sourceLabel = sourceName(source);
      if (sourceLabel) await this.renameNewestSource(editor, sourceLabel);
      await editor.rename(name);
      const id = (await editor.saveNew()).toLowerCase();
      return { id, name, url: reportUrl(id) };
    });
  }

  // Resource › Manage added data sources › Edit › REFRESH FIELDS › Apply › Done.
  async refreshDataSources(reportId: string, name?: string): Promise<string[]> {
    return this.edit(reportId, async (editor) => {
      const page = editor.page;
      await editor.clickMenu('Resource', ['Manage added data sources']);
      await this.waitForSourceRows(editor);
      const sources = await this.listedSources(editor);
      await this.closeSourcesPanel(editor);
      const targets = name ? sources.filter((s) => s === name) : sources;
      if (targets.length === 0) {
        throw new EditorStepError(
          `no data source named "${name}" (the report has ${sources.join(', ') || 'none'})`,
        );
      }
      const added: string[] = [];
      for (const source of targets) {
        await this.openSourceEditor(editor, source);
        await editor.step(`refresh the fields of ${source}`, async () => {
          await page.getByRole('button', { name: 'REFRESH FIELDS' }).click();
          const dialog = page.locator('mat-dialog-container', {
            hasText: 'Apply Connection Changes',
          });
          const changed = await dialog.waitFor({ timeout: 15_000 }).then(
            () => true,
            () => false,
          );
          if (changed) {
            const text = (await dialog.innerText()).replace(/\s+/g, ' ');
            const fields = /New Fields (.*?) (?:Removed Fields|Cancel)/.exec(text)?.[1];
            if (fields) added.push(...fields.split(' ').filter(Boolean));
            await dialog.getByRole('button', { name: 'Apply' }).click();
            await editor.settle(1500);
          }
          // Nothing changed: Looker Studio says so and waits for Continue.
          const same = page.locator('mat-dialog-container', {
            hasText: 'No connection changes were found',
          });
          if (await same.isVisible().catch(() => false)) {
            await same.getByRole('button', { name: 'Continue' }).click();
            await editor.settle(800);
          }
          await page
            .getByRole('button', { name: 'Done' })
            .first()
            .click({ timeout: this.opts.stepTimeoutMs });
          await editor.settle(800);
          // Back in the Data sources panel, which covers the menu the next source needs.
          await this.closeSourcesPanel(editor);
        });
      }
      return added;
    });
  }

  async addDataSource(reportId: string, source: DataSource): Promise<void> {
    await this.edit(reportId, async (editor) => {
      await editor.page.getByRole('button', { name: 'Add data', exact: true }).first().click();
      await editor.connectSource(source);
      const sourceLabel = sourceName(source);
      if (sourceLabel) await this.renameNewestSource(editor, sourceLabel);
    });
  }

  private async goToPage(editor: LookerStudioEditor, page?: number): Promise<void> {
    // A fresh editor opens on the first page; one shared by a batch stays
    // where the last action left it.
    if (this.visit.getStore()) {
      if ((await this.pageNow(editor)) === (page && page > 1 ? page : 1)) return;
    } else if (!page || page <= 1) return;
    await editor.clickMenu('Page', ['First page']);
    for (let i = 1; i < (page ?? 1); i++) {
      const before = editor.page.url();
      await editor.clickMenu('Page', ['Next page']);
      if (editor.page.url() === before) throw new EditorStepError(`the report has no page ${page}`);
    }
    await editor.waitForEditor();
  }

  // Below the lowest component, or the top-left corner of an empty page.
  // Where to drop a new component. New components come in at up to 400x300
  // with their top-left at the click; the spot keeps that box on the canvas and
  // on screen so its resize handle can be grabbed. finish() then moves it.
  private async spotFor(
    editor: LookerStudioEditor,
    layout?: Partial<Layout>,
  ): Promise<{ x: number; y: number }> {
    const wanted =
      layout?.x !== undefined && layout.y !== undefined
        ? { x: layout.x, y: layout.y }
        : await this.freeSpot(editor);
    const g = await editor.geometry();
    const screenBottom = await editor.page.evaluate(() => window.innerHeight);
    const visibleHeight = Math.min(g.height, (screenBottom - g.originY) / g.scale);
    return {
      x: Math.max(0, Math.min(wanted.x, g.width - 420)),
      y: Math.max(0, Math.min(wanted.y, Math.floor(visibleHeight) - 320)),
    };
  }

  private async freeSpot(editor: LookerStudioEditor): Promise<{ x: number; y: number }> {
    const layouts = await editor.layouts();
    const bottom = Math.max(0, ...layouts.map((l) => l.y + l.height));
    const g = await editor.geometry();
    return { x: 40, y: Math.min(bottom + 20, Math.max(0, g.height - 120)) };
  }

  private async finish(
    editor: LookerStudioEditor,
    index: number,
    layout: Partial<Layout> | undefined,
    warnings: string[],
  ): Promise<ComponentInfo> {
    let final = (await editor.layouts())[index]!;
    if (layout && Object.keys(layout).length > 0) {
      // An image keeping its aspect ratio collapses to 0x0 when its handle is
      // dragged sideways: let it stretch while resizing, then restore it.
      const resizing = layout.width !== undefined || layout.height !== undefined;
      const image = resizing && /^Image/.test(await editor.select(index));
      const aspect = image ? await editor.toggleState('Preserve Aspect Ratio') : null;
      if (aspect) await editor.applySettings({ 'Preserve Aspect Ratio': false });
      final = await editor.applyLayout(index, layout);
      if (aspect) {
        await editor.select(index);
        await editor.applySettings({ 'Preserve Aspect Ratio': true });
      }
      // Looker Studio snaps some sizes (and keeps shapes inside the canvas); say so.
      const off = (Object.keys(layout) as Array<keyof Layout>).filter(
        (k) => Math.abs(final[k] - layout[k]!) > 2,
      );
      if (off.length)
        warnings.push(
          `layout ${off.map((k) => `${k} ${final[k]} instead of ${layout[k]}`).join(', ')}`,
        );
    }
    const kind = await editor.select(index);
    await editor.deselect();
    return { index, kind, layout: final, ...(warnings.length ? { warnings } : {}) };
  }

  async addChart(
    reportId: string,
    chart: ChartSpec,
    opts: PlaceOptions & { dataSource?: string; style?: StyleSettings },
  ): Promise<ComponentInfo> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, opts.page);
      const spot = await this.spotFor(editor, opts.layout);
      const preset = CHART_PRESETS[chart.type];
      const index = await editor.placeAt(spot.x, spot.y, async () => {
        await editor.page.getByRole('button', { name: 'Add a chart' }).click();
        const card = editor.page.locator('.preview-container', {
          has: editor.page.locator(SEL.preset(preset)),
        });
        await card.first().click({ timeout: this.opts.stepTimeoutMs });
      });
      const title = await editor.select(index);
      if (!PANEL_TITLE_HINT[chart.type].test(title)) {
        await editor.undo();
        throw new EditorStepError(
          `expected a ${chart.type} chart but the editor inserted "${title || 'unknown'}"; it was undone.`,
        );
      }

      // A half-configured chart is worse than none: remove it if a step fails.
      try {
        return await this.configureChart(editor, index, chart, opts);
      } catch (err) {
        await editor.remove(index).catch(() => undefined);
        throw err;
      }
    });
  }

  private async configureChart(
    editor: LookerStudioEditor,
    index: number,
    chart: ChartSpec,
    opts: PlaceOptions & { dataSource?: string; style?: StyleSettings },
  ): Promise<ComponentInfo> {
    if (opts.dataSource) await editor.chooseDataSource(opts.dataSource);
    if (chart.type === 'scorecard_dimension') {
      // Its only slot is "Primary field", already switched to Dimension.
      await editor.setSectionFields(/^Primary field$/, chart.dimensions, 'the dimension');
    } else if (chart.type === 'time_series' || chart.dimensions.length > 0) {
      await editor.setSectionFields(SECTION.dimensions, chart.dimensions, 'the dimensions');
    }
    if (chart.metrics.length > 0) {
      await editor.setSectionFields(
        SECTION.metrics,
        chart.metrics.map((m) => m.field),
        'the metrics',
      );
    }
    // Extra slots go in while fields still carry their own names: chips are
    // matched by display name, and a relabel first lost a pivot's column field.
    // A pivot sorts its rows by an unrelated field until told otherwise, which
    // the editor reports as "Invalid configuration".
    const fields: Record<string, string[]> = {
      ...(PIVOTS.includes(chart.type) && chart.dimensions[0]
        ? { 'Row #1': [chart.dimensions[0]] }
        : {}),
      ...chart.fields,
    };
    await this.applyFields(editor, fields);
    for (const [i, metric] of chart.metrics.entries()) {
      if (!metric.aggregation && metric.label === undefined) continue;
      await editor.editMetric(i, {
        ...(metric.aggregation ? { aggregation: AGGREGATION_LABEL[metric.aggregation] } : {}),
        ...(metric.label !== undefined ? { label: metric.label } : {}),
      });
    }
    if (chart.breakdown) {
      await editor.setSectionFields(
        SECTION.breakdown,
        [chart.breakdown],
        'the breakdown dimension',
      );
    }
    const warnings: string[] = [];
    if (chart.sortBy && PIVOTS.includes(chart.type)) {
      // Pivots sort each row and column dimension on its own: "Row #1" is the first.
      await editor.setSectionFields(sectionNamed('Row #1'), [chart.sortBy], 'the row sort field');
      warnings.push(
        ...(await editor.applySettings({
          [`${chart.sortAscending ? 'Ascending' : 'Descending'}#1`]: true,
        })),
      );
    } else if (chart.sortBy && chart.type === 'scorecard_dimension') {
      // Its Sort section starts empty: "Add sort" opens the field picker.
      warnings.push(
        ...(await editor.addSorts([{ field: chart.sortBy, ascending: !!chart.sortAscending }])),
      );
    } else if (chart.sortBy) {
      await editor.setSectionFields(SECTION.sort, [chart.sortBy], 'the sort field');
      warnings.push(
        ...(await editor.applySettings({
          [chart.sortAscending ? 'Ascending' : 'Descending']: true,
        })),
      );
    }

    warnings.push(...(await this.applyData(editor, { ...chart, fields: {} })));

    const style: StyleSettings = {
      ...(chart.title ? { 'Show title': true } : {}),
      ...(opts.style ?? {}),
    };
    if (Object.keys(style).length > 0) {
      await editor.openTab('Style');
      warnings.push(...(await editor.applySettings(style)));
      if (chart.title) warnings.push(...(await this.setChartTitle(editor, chart.title)));
    }
    return this.finish(editor, index, opts.layout, warnings);
  }

  // Setup slots, filters, dates, series and value colors of a chart or control.
  private async applyFields(
    editor: LookerStudioEditor,
    fields: Record<string, string[]>,
  ): Promise<void> {
    for (const [section, names] of Object.entries(fields)) {
      await editor.setSectionFields(sectionNamed(section), names, `the "${section}" slot`);
    }
  }

  private async applyData(editor: LookerStudioEditor, data: DataSettings): Promise<string[]> {
    const warnings: string[] = [];
    await this.applyFields(editor, data.fields ?? {});
    warnings.push(...(await this.addFilters(editor, data.filters ?? [])));
    if (data.dateRange) await editor.setDateRange(data.dateRange);
    if (data.comparison) await editor.setComparison(data.comparison);
    if (data.series?.length) warnings.push(...(await editor.setSeries(data.series)));
    if (data.valueColors && Object.keys(data.valueColors).length > 0) {
      await editor.setValueColors(data.valueColors);
    }
    if (data.sorts?.length) warnings.push(...(await editor.addSorts(data.sorts)));
    if (data.referenceLines?.length || data.referenceBands?.length) {
      warnings.push(
        ...(await editor.addReferences(data.referenceLines ?? [], data.referenceBands ?? [])),
      );
    }
    for (const format of data.conditionalFormats ?? []) {
      await editor.addConditionalFormat({
        ...format,
        rules: format.rules.map((group) =>
          group.map((rule) => ({ ...rule, condition: this.condition(rule.condition) })),
        ),
      });
    }
    return warnings;
  }

  private async addFilters(
    editor: LookerStudioEditor,
    filters: FilterSpec[],
    scope?: string,
  ): Promise<string[]> {
    const warnings: string[] = [];
    for (const filter of filters) {
      const clauses = this.clauses(filter);
      const created = await editor.addFilter({ name: filter.name, clauses }, scope);
      if (!created && clauses.length)
        warnings.push(`filter "${filter.name}" already existed and was reused as it is`);
    }
    return warnings;
  }

  private clauses(filter: FilterSpec): FilterClause[][] {
    return filterClauses(filter).map((group) =>
      group.map((c) => ({ ...c, condition: this.condition(c.condition) })),
    );
  }

  private condition(condition: string): string {
    return FILTER_CONDITIONS[condition.trim().toLowerCase()] ?? condition;
  }

  async addControl(
    reportId: string,
    control: ControlSpec,
    opts: PlaceOptions & { dataSource?: string; style?: StyleSettings },
  ): Promise<ComponentInfo> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, opts.page);
      const spot = await this.spotFor(editor, opts.layout);
      const label = CONTROL_LABELS[control.kind];
      const index = await editor.placeAt(spot.x, spot.y, () => editor.clickMenu('Insert', [label]));
      await editor.select(index);
      try {
        if (opts.dataSource) await editor.chooseDataSource(opts.dataSource);
        if (control.field)
          await editor.setSectionFields(SECTION.control, [control.field], 'the control field');
        if (control.metric)
          await editor.setSectionFields(SECTION.metrics, [control.metric], 'the metric');
        const warnings = await this.applyData(editor, control);
        if (control.button) warnings.push(...(await editor.setButton(control.button)));
        if (opts.style && Object.keys(opts.style).length > 0) {
          await editor.openTab('Style');
          warnings.push(...(await editor.applySettings(opts.style)));
        }
        return await this.finish(editor, index, opts.layout, warnings);
      } catch (err) {
        await editor.remove(index).catch(() => undefined);
        throw err;
      }
    });
  }

  async addImage(
    reportId: string,
    image: ImageSpec,
    opts: PlaceOptions & { style?: StyleSettings },
  ): Promise<ComponentInfo> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, opts.page);
      const spot = await this.spotFor(editor, opts.layout);
      // A clicked image comes in at 0x0, out of reach: drag its box out, and
      // undo and drag again if the editor took the drag for a click.
      const size = { width: 200, height: 150 };
      let index: number;
      for (let attempt = 1; ; attempt++) {
        index = await editor.placeAt(
          spot.x,
          spot.y,
          () => editor.clickMenu('Insert', ['Image']),
          size,
        );
        const box = (await editor.layouts())[index]!;
        if (box.width > 0 && box.height > 0) break;
        await editor.undo();
        if (attempt === 3) throw new EditorStepError('the image box could not be drawn');
      }
      await editor.select(index);
      await editor.openTab('Setup');
      const file = image.path.split(/[\\/]/).pop()!;
      await editor.step(`upload ${file}`, async () => {
        const chooser = editor.page.waitForEvent('filechooser', {
          timeout: this.opts.stepTimeoutMs,
        });
        await editor.page
          .locator(SEL.propertiesPanel)
          .getByText('Select a file', { exact: true })
          .first()
          .click();
        await (await chooser).setFiles(image.path);
        await editor.page
          .locator(SEL.propertiesPanel)
          .getByText(file, { exact: true })
          .first()
          .waitFor({ timeout: this.opts.stepTimeoutMs });
      });
      await editor.settle(1500);
      const warnings = image.altText
        ? await editor.applySettings({ 'Alt text': image.altText })
        : [];
      if (opts.style && Object.keys(opts.style).length > 0) {
        await editor.openTab('Style');
        warnings.push(...(await editor.applySettings(opts.style)));
      }
      return this.finish(editor, index, opts.layout, warnings);
    });
  }

  async addCalculatedField(
    reportId: string,
    field: CalculatedFieldSpec,
    dataSource?: string,
  ): Promise<void> {
    await this.edit(reportId, async (editor) => {
      const page = editor.page;
      await this.openSourceEditor(editor, dataSource);
      await editor.step(`add the calculated field ${field.name}`, async () => {
        await page.getByRole('button', { name: 'Add a field' }).last().click();
        await page.getByText('Add calculated field', { exact: true }).last().click();
        const name = page.locator('input[formcontrolname="fieldNameInputControl"]');
        await name.waitFor({ timeout: this.opts.stepTimeoutMs });
        await name.fill(field.name);
        // The formula box is CodeMirror 5: typing would auto-close quotes and
        // brackets, so set the text through its API.
        const set = await page.evaluate((formula) => {
          const host = document.querySelector('ng2-code-mirror-formula .CodeMirror') as
            (Element & { CodeMirror?: { setValue(v: string): void; focus(): void } }) | null;
          if (!host?.CodeMirror) return false;
          host.CodeMirror.setValue(formula);
          host.CodeMirror.focus();
          return true;
        }, field.formula);
        if (!set) throw new Error('the formula box was not found');
        await editor.settle(800);
        const save = page.getByRole('button', { name: 'Save', exact: true }).last();
        if (await save.isDisabled()) {
          // The editor explains the problem under the formula box.
          const text = await page
            .locator('.new-calculated-fields-container')
            .innerText()
            .catch(() => '');
          const error = text
            .split('\n')
            .find((l) => /error|invalid|unknown|expect|syntax|not found/i.test(l));
          throw new Error(`the formula was not accepted${error ? `: ${error.trim()}` : ''}`);
        }
        await save.click();
        await editor.settle(1500);
        await page
          .getByRole('button', { name: 'Done', exact: true })
          .first()
          .click({ timeout: this.opts.stepTimeoutMs });
        await editor.settle(800);
      });
    });
  }

  // Resource › Manage added data sources › Edit, for `name` or the only source.
  private async openSourceEditor(editor: LookerStudioEditor, name?: string): Promise<void> {
    const page = editor.page;
    await editor.clickMenu('Resource', ['Manage added data sources']);
    await this.waitForSourceRows(editor);
    const sources = await this.listedSources(editor);
    const source = name ?? (sources.length === 1 ? sources[0] : undefined);
    if (!source || !sources.includes(source)) {
      throw new EditorStepError(
        name
          ? `no data source named "${name}" (the report has ${sources.join(', ') || 'none'})`
          : `the report has several data sources; name one of: ${sources.join(', ')}`,
      );
    }
    await editor.step(`edit the data source ${source}`, async () => {
      // The row buttons are upper-cased by CSS; find "Edit" by text in the row.
      const point = await page.evaluate((wanted) => {
        const row = [...document.querySelectorAll('tr, [role=row]')].find(
          (r) => r.querySelector('td, [role=cell]')?.textContent?.trim() === wanted,
        );
        const button = [...(row?.querySelectorAll('button') ?? [])].find((b) =>
          /^edit$/i.test(b.textContent?.trim() ?? ''),
        );
        if (!button) return null;
        const r = button.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, source);
      if (!point) throw new Error('its Edit button was not found');
      await page.mouse.click(point.x, point.y);
      await page
        .getByRole('button', { name: 'REFRESH FIELDS' })
        .waitFor({ timeout: this.opts.stepTimeoutMs });
    });
  }

  // Looker Studio names a custom query after the first table it reads. The
  // newest data source has the highest alias (dsN) in Manage added data sources.
  private async renameNewestSource(editor: LookerStudioEditor, name: string): Promise<void> {
    const page = editor.page;
    await editor.clickMenu('Resource', ['Manage added data sources']);
    await this.waitForSourceRows(editor);
    await editor.step(`name the new data source "${name}"`, async () => {
      const found = await page.evaluate(() => {
        let best: { n: number; name: string; x: number; y: number } | null = null;
        for (const row of document.querySelectorAll('tr, [role=row]')) {
          const cells = [...row.querySelectorAll('td, [role=cell]')];
          const alias = /^ds(\d+)$/.exec(cells.at(-1)?.textContent?.trim() ?? '');
          const button = [...row.querySelectorAll('button')].find((b) =>
            /^edit$/i.test(b.textContent?.trim() ?? ''),
          );
          if (!alias || !button) continue;
          const n = Number(alias[1]);
          if (best && best.n >= n) continue;
          const r = button.getBoundingClientRect();
          const current = cells[0]?.textContent?.trim() ?? '';
          best = { n, name: current, x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        return best;
      });
      if (!found) throw new Error('the new data source is not in the list');
      await page.mouse.click(found.x, found.y);
      await page
        .getByRole('button', { name: 'REFRESH FIELDS' })
        .waitFor({ timeout: this.opts.stepTimeoutMs });
      const box = page.locator(SEL.dataSourceNameInput).filter({ visible: true });
      const index = await box.evaluateAll(
        (inputs, current) => inputs.findIndex((i) => (i as HTMLInputElement).value === current),
        found.name,
      );
      if (index < 0) throw new Error('the data source name box was not found');
      await box.nth(index).fill(name);
      await box.nth(index).press('Enter');
      await editor.settle(800);
      await page.getByRole('button', { name: 'Done' }).first().click();
      await editor.settle(800);
    });
    await this.closeSourcesPanel(editor);
  }

  // Escape no longer closes the Data sources panel, and the open panel covers
  // the menu bar: close it with its CLOSE button.
  // The Data sources panel can spin for a minute on a report that was just
  // created or changed: give its rows longer than a normal step.
  private async waitForSourceRows(editor: LookerStudioEditor): Promise<void> {
    await editor.page
      .locator('tr, [role=row]')
      .nth(1)
      .waitFor({ timeout: this.opts.stepTimeoutMs * 3 });
  }

  private async closeSourcesPanel(editor: LookerStudioEditor): Promise<void> {
    const close = editor.page.getByRole('button', { name: /^close$/i }).first();
    if (await close.isVisible().catch(() => false)) await close.click();
    await editor.settle(800);
  }

  private listedSources(editor: LookerStudioEditor): Promise<string[]> {
    return editor.page.evaluate(() =>
      [...document.querySelectorAll('tr, [role=row]')]
        .slice(1)
        .map((r) => r.querySelector('td, [role=cell]')?.textContent?.trim() ?? '')
        .filter(Boolean),
    );
  }

  // With "Show title" on, the Style tab shows a text box for the title.
  private async setChartTitle(editor: LookerStudioEditor, title: string): Promise<string[]> {
    for (const label of ['Title', 'Chart title', 'Title text']) {
      const missing = await editor.applySettings({ [label]: title });
      if (missing.length === 0) return [];
    }
    const box = editor.page
      .locator(`${SEL.propertiesPanel} input[placeholder*="itle"], ${SEL.propertiesPanel} textarea`)
      .first();
    if (await box.count()) {
      await box.fill(title);
      await box.press('Enter');
      return [];
    }
    return ['title (no title box found in the Style tab)'];
  }

  async addText(
    reportId: string,
    text: TextSpec,
    opts: PlaceOptions & { style?: StyleSettings },
  ): Promise<ComponentInfo> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, opts.page);
      const spot = await this.spotFor(editor, opts.layout);
      const index = await editor.placeAt(spot.x, spot.y, async () => {
        await editor.page.getByRole('button', { name: 'Text', exact: true }).first().click();
      });
      await editor.page.keyboard.type(text.text);
      await editor.deselect();
      await editor.select(index);

      const warnings: string[] = [];
      if (text.fontSize) {
        const size = editor.page
          .locator(`${SEL.propertiesPanel} input[aria-label="font size selector"]`)
          .first();
        await size.fill(String(text.fontSize));
        await size.press('Enter');
      }
      const settings: StyleSettings = {
        ...(text.color ? { 'Font color': text.color } : {}),
        ...(text.background ? { Background: text.background } : {}),
        ...opts.style,
      };
      warnings.push(...(await editor.applySettings(settings)));
      if (text.bold) {
        const bold = editor.page
          .locator(`${SEL.propertiesPanel} ${SEL.iconButton('format_bold')}`)
          .first();
        if (await bold.count()) await bold.click();
        else warnings.push('bold');
      }
      if (text.align && text.align !== 'left') {
        const alignButton = editor.page
          .locator(`${SEL.propertiesPanel} button[aria-label="Left"]`)
          .first();
        if (await alignButton.count()) {
          await alignButton.click();
          await editor.pickMenuItem(`icon:format_align_${text.align}`).catch(async () => {
            warnings.push('align');
            await editor.page.keyboard.press('Escape');
          });
        } else warnings.push('align');
      }
      const layout = { ...DEFAULT_SIZE.text, ...opts.layout };
      return this.finish(editor, index, layout, warnings);
    });
  }

  async addShape(
    reportId: string,
    shape: ShapeSpec,
    opts: PlaceOptions & { style?: StyleSettings },
  ): Promise<ComponentInfo> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, opts.page);
      const spot = await this.spotFor(editor, opts.layout);
      const path = SHAPE_PATHS[shape.shape];
      const index = await editor.placeAt(spot.x, spot.y, () => editor.clickMenu('Insert', path));
      await editor.select(index);
      const warnings = await this.applyWithFallback(editor, [
        [shape.background, ['Background color', 'Background', 'Fill color']],
        [shape.borderColor, ['Border color']],
        [shape.borderRadius, ['Border radius']],
      ]);
      if (opts.style) warnings.push(...(await editor.applySettings(opts.style)));
      return this.finish(editor, index, opts.layout, warnings);
    });
  }

  // Tries each candidate label until one exists in the panel.
  private async applyWithFallback(
    editor: LookerStudioEditor,
    entries: Array<[string | number | undefined, string[]]>,
  ): Promise<string[]> {
    const warnings: string[] = [];
    for (const [value, labels] of entries) {
      if (value === undefined) continue;
      let done = false;
      for (const label of labels) {
        if ((await editor.applySettings({ [label]: value })).length === 0) {
          done = true;
          break;
        }
      }
      if (!done) warnings.push(labels[0]!);
    }
    return warnings;
  }

  async addLine(
    reportId: string,
    line: LineSpec,
    opts: { page?: number; style?: StyleSettings },
  ): Promise<ComponentInfo> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, opts.page);
      // A line is drawn by dragging from one end to the other.
      const index = await editor.placeAt(
        line.from.x,
        line.from.y,
        () => editor.clickMenu('Insert', ['Line']),
        {
          width: line.to.x - line.from.x,
          height: line.to.y - line.from.y,
        },
      );
      // A fresh line keeps the drawing tool's state: deselect before selecting it.
      await editor.deselect();
      if (!/^Line/.test(await editor.select(index)))
        throw new EditorStepError('the new line could not be selected');
      const warnings = await editor.applySettings({
        ...(line.color ? { 'Stroke color': line.color } : {}),
        ...(line.borderStyle ? { 'Border style': line.borderStyle } : {}),
        ...opts.style,
      });
      if (line.start || line.end) await editor.setLineEnds(line.start, line.end);
      return this.finish(editor, index, undefined, warnings);
    });
  }

  async addEmbed(
    reportId: string,
    url: string,
    opts: PlaceOptions & { style?: StyleSettings },
  ): Promise<ComponentInfo> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, opts.page);
      const spot = await this.spotFor(editor, opts.layout);
      const index = await editor.placeAt(spot.x, spot.y, () =>
        editor.clickMenu('Insert', ['URL Embed']),
      );
      await editor.select(index);
      const warnings = await this.setEmbedUrl(editor, url);
      if (opts.style) {
        await editor.openTab('Style');
        warnings.push(...(await editor.applySettings(opts.style)));
      }
      return this.finish(editor, index, opts.layout, warnings);
    });
  }

  private async setEmbedUrl(editor: LookerStudioEditor, url: string): Promise<string[]> {
    await editor.openTab('Setup');
    const box = editor.page.locator(`${SEL.propertiesPanel} input`).first();
    if (!(await box.count())) return ['External Content URL'];
    await box.fill(url);
    await box.press('Enter');
    await editor.settle(1500);
    return [];
  }

  async duplicateComponent(
    reportId: string,
    index: number,
    layout?: Partial<Layout>,
    page?: number,
  ): Promise<ComponentInfo> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, page);
      await editor.select(index);
      const before = await editor.layouts();
      await editor.clickMenu('Edit', ['Duplicate']);
      await editor.settle(1000);
      const after = await editor.layouts();
      const known = new Set(before.map((l) => JSON.stringify(l)));
      const copy = after.findIndex((l) => !known.has(JSON.stringify(l)));
      if (after.length !== before.length + 1 || copy < 0)
        throw new EditorStepError(`component ${index} was not duplicated`);
      return this.finish(editor, copy, layout, []);
    });
  }

  async arrangeComponents(
    reportId: string,
    indexes: number[],
    action: ArrangeAction,
    page?: number,
  ): Promise<ComponentInfo[]> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, page);
      const boxes = await editor.layouts();
      const picked = indexes.map((i) => boxes[i]);
      if (picked.some((b) => !b))
        throw new EditorStepError(`the page has ${boxes.length} components`);
      await editor.selectMany(indexes);
      await editor.clickMenu('Arrange', ARRANGE_PATHS[action]);
      await editor.settle(1000);
      await editor.deselect();
      const after = await editor.layouts();
      if (action === 'group' || action === 'ungroup') {
        return after.map((layout, index) => ({ index, kind: 'component', layout }));
      }
      return indexes.map((index) => ({ index, kind: 'component', layout: after[index]! }));
    });
  }

  async managePage(reportId: string, page: number, action: PageAction): Promise<ReportPage[]> {
    return this.edit(reportId, async (editor) => {
      if (action === 'delete' || action === 'duplicate') {
        await this.goToPage(editor, page);
        const before = editor.page.url();
        await editor.clickMenu('Page', [action === 'delete' ? 'Delete page' : 'Duplicate page']);
        await editor.page
          .getByRole('button', { name: /^(Delete|Yes|OK)$/i })
          .last()
          .click({ timeout: 3_000 })
          .catch(() => undefined);
        await editor.page
          .waitForURL((url) => url.toString() !== before, { timeout: this.opts.stepTimeoutMs })
          .catch(() => undefined);
        await editor.waitForEditor();
        return this.readPages(editor);
      }
      await editor.step(`${action.replace('_', ' ')} page ${page}`, async () => {
        if (!(await this.openPagesPanel(editor))) throw new Error('the report has a single page');
        const chips = editor.page.locator('.nav-item-chip.page-chip');
        const count = await chips.count();
        if (page < 1 || page > count) throw new Error(`the report has ${count} pages`);
        const chip = chips.nth(page - 1);
        await chip.hover();
        await editor.settle(300);
        const visibility = action === 'hide' || action === 'show';
        await editor.walkMenu(
          () => chip.locator('nav-item-action-menu button').click({ force: true }),
          [visibility ? 'Control visibility' : PAGE_MENU[action]],
        );
        await editor.settle(800);
        if (visibility) {
          // A dialog: always show, show by parameter, or always hide in view mode.
          const dialog = editor.page.locator('mat-dialog-container').last();
          await dialog
            .getByText(
              action === 'hide'
                ? 'Always hide the page for all viewers in the view mode'
                : 'Always show the page for all viewers in the view mode',
            )
            .click();
          await dialog.getByRole('button', { name: 'Confirm' }).click();
          await editor.settle(800);
        }
      });
      const pages = await this.readPages(editor);
      return pages;
    });
  }

  async setScopeSettings(
    reportId: string,
    scope: 'page' | 'report',
    settings: ScopeSettings,
    page?: number,
  ): Promise<string[]> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, page);
      await editor.deselect();
      if (scope === 'page') await editor.clickMenu('Page', ['Current page settings']);
      else await editor.clickMenu('File', ['Report settings']);
      await editor.settle(800);
      const heading = scope === 'page' ? 'Current Page Settings' : 'Report Settings';
      const tag = await this.scopeFor(editor, heading, `${scope}-settings`);
      const warnings: string[] = [];
      if (settings.dataSource) {
        await editor.step(`choose data source ${settings.dataSource}`, async () => {
          await editor.page.locator(tag).getByText('Select a data source').first().click();
          await editor.page
            .locator('.cdk-overlay-container')
            .getByText(settings.dataSource!, { exact: true })
            .first()
            .click({ timeout: this.opts.stepTimeoutMs });
        });
        await editor.settle(1200);
      }
      if (settings.dateRangeDimension) {
        await editor.setSectionFields(
          /^Date range dimension$/,
          [settings.dateRangeDimension],
          'the date range dimension',
        );
      }
      if (settings.dateRange) await editor.setDateRange(settings.dateRange);
      warnings.push(...(await this.addFilters(editor, settings.filters ?? [], tag)));
      if (settings.style && Object.keys(settings.style).length > 0) {
        if (scope === 'report') warnings.push('style (report settings have no Style tab)');
        else {
          await editor.page.locator(tag).getByText('Style', { exact: true }).first().click();
          await editor.settle(500);
          warnings.push(...(await editor.applySettings(settings.style, tag)));
        }
      }
      return warnings;
    });
  }

  // Resource › Manage filters lists every filter with Edit, Duplicate and Remove.
  async manageFilter(
    reportId: string,
    action: 'edit' | 'duplicate' | 'delete',
    name: string,
    filter?: FilterSpec,
  ): Promise<void> {
    await this.edit(reportId, async (editor) => {
      const page = editor.page;
      await editor.clickMenu('Resource', ['Manage filters']);
      const rows = page.locator('.resource-table-body .row');
      await rows
        .first()
        .waitFor({ timeout: this.opts.stepTimeoutMs })
        .catch(() => undefined);
      const names = (
        await page.locator('.resource-table-body .row .column:first-child .text').allInnerTexts()
      ).map((n) => n.trim());
      if (!names.includes(name)) {
        throw new EditorStepError(
          `the report has no filter named "${name}" (it has ${names.join(', ') || 'none'})`,
        );
      }
      const row = rows.filter({ has: page.getByText(name, { exact: true }) }).first();
      const button = { edit: 'Edit', duplicate: 'Duplicate', delete: 'Close' }[action];
      await editor.step(`${action} the filter "${name}"`, async () => {
        await row.locator(`[role=button][aria-label="${button}"]`).click();
        await editor.settle(1500);
        if (action === 'delete') {
          await page.getByRole('button', { name: 'Remove Filter' }).click();
          await editor.settle(1500);
        }
        if (action !== 'edit') return;
        await editor.rewriteFilter(
          filter ? this.clauses(filter) : [],
          filter?.name && filter.name !== name ? filter.name : undefined,
        );
      });
      await page
        .getByRole('button', { name: /^close$/i })
        .first()
        .click()
        .catch(() => undefined);
    });
  }

  // A parameter is added from the Data panel and kept in the data source.
  async addParameter(
    reportId: string,
    parameter: ParameterSpec,
    dataSource?: string,
  ): Promise<void> {
    await this.edit(reportId, async (editor) => {
      const page = editor.page;
      if (dataSource) await this.openSourceEditor(editor, dataSource);
      await editor.step(`add the parameter ${parameter.name}`, async () => {
        await page.getByRole('button', { name: 'Add a parameter' }).last().click();
        const name = page.locator('input[formcontrolname="displayName"]');
        await name.waitFor({ timeout: this.opts.stepTimeoutMs });
        await name.fill(parameter.name);
        if (parameter.id) await page.locator('input[formcontrolname="name"]').fill(parameter.id);
        if (parameter.dataType && parameter.dataType !== 'Text') {
          await editor.chooseOption(
            page.locator('mat-select[formcontrolname="dataType"]'),
            parameter.dataType,
          );
        }
        if (parameter.values?.length) {
          await page.getByText('List of values', { exact: true }).click();
          await editor.settle(600);
          for (const [i, value] of parameter.values.entries()) {
            const boxes = page.locator('input[formcontrolname="value"]');
            if ((await boxes.count()) <= i) {
              await page.getByRole('button', { name: 'Add another value' }).click();
              await editor.settle(400);
            }
            await boxes.nth(i).fill(value);
          }
        }
        if (parameter.defaultValue !== undefined) {
          // The default is a box (any value) or a list (permitted values),
          // under an unlabeled "Default Value" heading.
          const tag = await page.evaluate(() => {
            const label = [...document.querySelectorAll<HTMLElement>('*')].find(
              (e) => e.children.length === 0 && e.textContent?.trim() === 'Default Value',
            );
            for (let box = label?.parentElement; box; box = box.parentElement) {
              const control = box.querySelector('input, mat-select');
              if (control) {
                control.setAttribute('data-mcp-default', '1');
                return control.tagName;
              }
            }
            return null;
          });
          const control = page.locator('[data-mcp-default="1"]');
          if (tag === 'MAT-SELECT') await editor.chooseOption(control, parameter.defaultValue);
          else if (tag) {
            await control.fill(parameter.defaultValue);
            await control.press('Tab');
          } else throw new Error('the Default Value box was not found');
        }
        await this.saveFieldForm(editor);
      });
    });
  }

  async addGroupField(reportId: string, group: GroupFieldSpec, dataSource?: string): Promise<void> {
    await this.edit(reportId, async (editor) => {
      const page = editor.page;
      await this.openSourceEditor(editor, dataSource);
      await editor.step(`add the group field ${group.name}`, async () => {
        await this.openFieldForm(
          editor,
          'Add group',
          group.name,
          'Selected field to group by',
          group.field,
        );
        for (const [i, g] of group.groups.entries()) {
          if (i > 0) {
            await page.getByRole('button', { name: 'Add group' }).last().click();
            await editor.settle(600);
          }
          await page.locator('input[formcontrolname="groupName"]').nth(i).fill(g.name);
          if (g.exclude) {
            await editor.chooseOption(
              page.locator('mat-select[formcontrolname="includeOrExclude"]').nth(i),
              'Exclude',
            );
          }
          await editor.chooseOption(
            page.locator('mat-select[formcontrolname="condition"]').nth(i),
            this.condition(g.condition),
          );
          await this.typeValues(editor, i, this.condition(g.condition), g.values);
        }
        if (group.otherGroup) {
          const check = page
            .locator('mat-checkbox')
            .filter({ hasText: 'Group remaining values as' })
            .locator('input[type=checkbox]');
          await check.check({ force: true });
          await editor.settle(600);
          const other = page
            .locator('mat-form-field')
            .filter({ hasText: /Group name for remain/ })
            .locator('textarea, input')
            .first()
            .or(page.getByPlaceholder(/^Group name for remain/));
          await other.waitFor({ timeout: this.opts.stepTimeoutMs }).catch(() => {
            throw new Error('the box for the remaining values did not appear');
          });
          await other.fill(group.otherGroup);
        }
        await this.saveFieldForm(editor);
      });
    });
  }

  // Value inputs of the i-th group: chips (Enter) for "In", a single box otherwise.
  private async typeValues(
    editor: LookerStudioEditor,
    group: number,
    condition: string,
    values: string[],
  ): Promise<void> {
    const box = editor.page
      .locator('form, .group-container, [formarrayname]')
      .last()
      .locator('input:not([formcontrolname])')
      .nth(group);
    const input = (await box.count())
      ? box
      : editor.page.locator('input:not([formcontrolname])').last();
    if (/^in$/i.test(condition)) {
      for (const value of values) {
        await input.click();
        await editor.page.keyboard.type(value, { delay: 10 });
        await editor.page.keyboard.press('Enter');
        await editor.settle(250);
      }
    } else {
      await input.fill(values[0] ?? '');
      await input.press('Tab');
    }
  }

  async addBinField(reportId: string, bin: BinFieldSpec, dataSource?: string): Promise<void> {
    await this.edit(reportId, async (editor) => {
      const page = editor.page;
      await this.openSourceEditor(editor, dataSource);
      await editor.step(`add the bin field ${bin.name}`, async () => {
        await this.openFieldForm(
          editor,
          'Add bin',
          bin.name,
          'Selected field to bin by',
          bin.field,
        );
        const fill = async (label: string, value: number | undefined) => {
          if (value === undefined) return;
          const box = page.getByLabel(label).or(page.getByPlaceholder(label)).first();
          await box.fill(String(value));
          await box.press('Tab');
        };
        await fill('Bin Size', bin.size);
        await fill('Bin min value', bin.min);
        await fill('Bin max value', bin.max);
        await this.saveFieldForm(editor);
      });
    });
  }

  // Add a field › Add group / Add bin: the new field's name and its source field.
  private async openFieldForm(
    editor: LookerStudioEditor,
    item: string,
    name: string,
    picker: string,
    field: string,
  ): Promise<void> {
    const page = editor.page;
    await page.getByRole('button', { name: 'Add a field' }).last().click();
    await editor.settle(600);
    await page.getByText(item, { exact: true }).last().click();
    const nameBox = page.locator('input[formcontrolname="newFieldName"]');
    await nameBox.waitFor({ timeout: this.opts.stepTimeoutMs });
    await nameBox.fill(name);
    await page.getByText(picker, { exact: true }).click();
    await editor.settle(600);
    await page.keyboard.type(field, { delay: 20 });
    await editor.settle(600);
    const hit = page
      .locator('.display-name-highlighted')
      .filter({ hasText: new RegExp(`^\\s*${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) })
      .last();
    if (!(await hit.count())) throw new Error(`the data source has no field "${field}"`);
    await hit.click();
    await editor.settle(800);
  }

  private async saveFieldForm(editor: LookerStudioEditor): Promise<void> {
    const page = editor.page;
    const save = page.getByRole('button', { name: 'Save', exact: true }).last();
    await editor.settle(500);
    if (await save.isDisabled()) {
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
      throw new Error('the form would not save (check the names and values)');
    }
    await save.click();
    await editor.settle(1500);
    await page
      .getByRole('button', { name: 'Done', exact: true })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
    await editor.settle(800);
  }

  // Resource › Manage blends › Add a blend: one table per data source, joined left to right.
  async createBlend(reportId: string, blend: BlendSpec): Promise<void> {
    await this.edit(reportId, async (editor) => {
      const page = editor.page;
      await editor.clickMenu('Resource', ['Manage blends']);
      await editor.step(`create the blend ${blend.name}`, async () => {
        await page
          .getByText(/add a blend/i)
          .first()
          .click({ timeout: this.opts.stepTimeoutMs });
        await editor.settle(2500);
        await page
          .getByRole('button', { name: 'No thanks' })
          .click({ timeout: 3_000 })
          .catch(() => undefined);
        for (const [i, table] of blend.tables.entries()) {
          if (i === 0) {
            await this.chooseBlendSource(editor, 0, table.dataSource);
          } else {
            await page.getByRole('button', { name: 'Add another table' }).click();
            await editor.settle(1500);
            await this.clickListedSource(editor, table.dataSource);
            await editor.settle(2500);
          }
          await this.setBlendFields(editor, i, 'Dimensions', table.dimensions);
          await this.setBlendFields(editor, i, 'Metrics', table.metrics);
          if (i > 0) await this.configureJoin(editor, i, blend.joins[i - 1]!);
        }
        await page
          .getByPlaceholder('Blend name')
          .or(page.getByLabel('Blend name'))
          .first()
          .fill(blend.name);
        const save = page.getByRole('button', { name: 'Save', exact: true }).last();
        if (await save.isDisabled()) {
          const why =
            (await page
              .getByText(/incomplete|invalid/i)
              .first()
              .textContent()
              .catch(() => '')) ?? '';
          throw new Error(`the blend would not save${why ? `: ${why.trim()}` : ''}`);
        }
        await save.click();
        await editor.settle(2000);
        await page
          .getByRole('button', { name: /close/i })
          .first()
          .click({ timeout: 5_000 })
          .catch(() => undefined);
      });
    });
  }

  // Table panels of the blend editor, left to right: from the "Table N"
  // header up to the column that holds its "Add metric".
  private async blendTable(editor: LookerStudioEditor, i: number): Promise<Locator> {
    const found = await editor.page.evaluate((n) => {
      const header = [...document.querySelectorAll<HTMLElement>('*')].find(
        (e) => e.children.length === 0 && e.textContent?.trim() === `Table ${n}`,
      );
      for (let box = header?.parentElement; box; box = box.parentElement) {
        const adds = [...box.querySelectorAll('*')].filter(
          (e) => e.children.length === 0 && e.textContent?.trim() === 'Add metric',
        );
        if (adds.length > 1) return false;
        if (adds.length === 1) {
          box.setAttribute('data-mcp-table', String(n));
          return true;
        }
      }
      return false;
    }, i + 1);
    if (!found) throw new EditorStepError(`blend table ${i + 1} was not found`);
    return editor.page.locator(`[data-mcp-table="${i + 1}"]`);
  }

  private async chooseBlendSource(
    editor: LookerStudioEditor,
    i: number,
    name: string,
  ): Promise<void> {
    const table = await this.blendTable(editor, i);
    const current = (await table.innerText()).includes(name);
    if (current) return;
    await table
      .locator('button, mat-select, [role=combobox]')
      .filter({ hasText: /\S/ })
      .first()
      .click();
    await editor.settle(1000);
    await this.clickListedSource(editor, name);
    await editor.settle(2000);
  }

  private async clickListedSource(editor: LookerStudioEditor, name: string): Promise<void> {
    const point = await editor.page.evaluate((wanted) => {
      const header = [...document.querySelectorAll<HTMLElement>('*')].find(
        (e) => e.children.length === 0 && e.textContent?.trim() === 'Added data sources',
      );
      let box = header?.parentElement ?? null;
      const leaf = (root: Element) =>
        [...root.querySelectorAll<HTMLElement>('*')].find(
          (e) =>
            e.children.length === 0 &&
            e.textContent?.trim() === wanted &&
            e.getBoundingClientRect().width > 0,
        );
      while (box && !leaf(box)) box = box.parentElement;
      const hit = box ? leaf(box) : undefined;
      if (!hit) return null;
      const r = hit.getBoundingClientRect();
      return { x: r.x + 10, y: r.y + r.height / 2 };
    }, name);
    if (!point) throw new Error(`the report has no data source named "${name}"`);
    await editor.page.mouse.click(point.x, point.y);
  }

  // "Add dimension"/"Add metric" of a blend table open the same field picker as charts.
  private async setBlendFields(
    editor: LookerStudioEditor,
    i: number,
    section: 'Dimensions' | 'Metrics',
    fields: string[],
  ): Promise<void> {
    const table = await this.blendTable(editor, i);
    const add = section === 'Dimensions' ? 'Add dimension' : 'Add metric';
    const have = await table
      .locator('.common-chip [aria-label]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    for (const field of fields) {
      if (have.includes(field)) continue;
      await table.getByText(add, { exact: true }).first().click();
      const search = editor.page
        .locator('.cdk-overlay-container input[placeholder="Search"]')
        .last();
      await search.waitFor({ timeout: this.opts.stepTimeoutMs });
      await search.fill(field);
      await editor.settle(500);
      const hit = editor.page
        .locator('.cdk-overlay-container .display-name-highlighted')
        .filter({
          hasText: new RegExp(`^\\s*${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`),
        })
        .last();
      if (!(await hit.count())) throw new Error(`table ${i + 1} has no field "${field}"`);
      await hit.click();
      await editor.settle(800);
      await editor.page.keyboard.press('Escape');
    }
  }

  private async configureJoin(
    editor: LookerStudioEditor,
    i: number,
    join: BlendSpec['joins'][number],
  ): Promise<void> {
    const page = editor.page;
    await page
      .getByText('Configure merge', { exact: true })
      .nth(i - 1)
      .click();
    const dialog = page.locator('mat-dialog-container').filter({ hasText: 'Merge configuration' });
    await dialog.waitFor({ timeout: this.opts.stepTimeoutMs });
    await dialog
      .locator(`button[aria-label="Join type ${join.type ?? 'left outer'}"]`)
      .click({ force: true });
    await editor.settle(500);
    for (const [left, right] of join.keys) {
      // The editor pre-fills pairs of fields with the same name.
      const text = (await dialog.textContent()) ?? '';
      if (text.includes(`${left}Table`) && text.includes(`${right}Table`)) continue;
      for (const [side, field] of [
        [0, left],
        [1, right],
      ] as const) {
        await dialog.getByText('Add field', { exact: true }).nth(side).click();
        const search = page.locator('.cdk-overlay-container input[placeholder="Search"]').last();
        await search.waitFor({ timeout: this.opts.stepTimeoutMs });
        await search.fill(field);
        await editor.settle(500);
        await page
          .locator('.cdk-overlay-container .display-name-highlighted')
          .filter({
            hasText: new RegExp(`^\\s*${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`),
          })
          .last()
          .click();
        await editor.settle(700);
      }
    }
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await editor.settle(1500);
  }

  async listComponents(reportId: string, page?: number): Promise<ComponentInfo[]> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, page);
      const layouts = await editor.layouts();
      const out: ComponentInfo[] = [];
      for (const [index, layout] of layouts.entries()) {
        const kind = await editor.select(index).catch(() => 'covered component');
        out.push({ index, kind, layout });
      }
      await editor.deselect();
      return out;
    });
  }

  async describeComponent(
    reportId: string,
    index: number,
    page?: number,
  ): Promise<ComponentDetails> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, page);
      const kind = await editor.select(index);
      await editor.openTab('Setup');
      const setup = await editor.listSettings();
      await editor.openTab('Style');
      const style = await editor.listSettings();
      return { kind, layout: (await editor.layouts())[index]!, setup, style };
    });
  }

  async updateComponent(
    reportId: string,
    index: number,
    change: ComponentChange,
    page?: number,
  ): Promise<ComponentInfo> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, page);
      await editor.select(index);
      const warnings: string[] = [];
      // Both restack the components (a report-level one goes to the top of
      // the stack): find this one again by its box afterwards.
      const restack = async (menu: string[]) => {
        const box = (await editor.layouts())[index]!;
        await editor.clickMenu('Arrange', menu);
        index = (await editor.layouts()).findIndex(
          (l) => l.x === box.x && l.y === box.y && l.width === box.width && l.height === box.height,
        );
        if (index < 0)
          throw new EditorStepError(
            'the component moved while restacking it; list the components again.',
          );
        await editor.select(index);
      };
      if (change.reportLevel !== undefined) {
        await restack([change.reportLevel ? 'Make report-level' : 'Make page-level']);
      }
      if (change.order) await restack(['Order', ORDER_LABEL[change.order]]);
      if (change.chartType) {
        const preset = CHART_PRESETS[change.chartType];
        const title = await editor.switchChartType(preset, PRESET_ORDER.indexOf(preset));
        if (!PANEL_TITLE_HINT[change.chartType].test(title))
          throw new EditorStepError(`the chart became "${title}" instead of a ${change.chartType}`);
      }
      if (change.button) warnings.push(...(await editor.setButton(change.button)));
      if (change.embedUrl) warnings.push(...(await this.setEmbedUrl(editor, change.embedUrl)));
      for (const [from, to] of Object.entries(change.labels ?? {})) {
        await editor.relabelField(from, to);
      }
      warnings.push(...(await this.applyData(editor, change)));
      if (change.setup && Object.keys(change.setup).length > 0) {
        await editor.openTab('Setup');
        warnings.push(...(await editor.applySettings(change.setup)));
      }
      if (change.style && Object.keys(change.style).length > 0) {
        await editor.openTab('Style');
        warnings.push(...(await editor.applySettings(change.style)));
      }
      return this.finish(editor, index, change.layout, warnings);
    });
  }

  async deleteComponent(reportId: string, index: number, page?: number): Promise<void> {
    await this.edit(reportId, async (editor) => {
      await this.goToPage(editor, page);
      await editor.remove(index);
    });
  }

  // Tags the panel that holds `heading`, so settings only touch that panel.
  private async scopeFor(
    editor: LookerStudioEditor,
    heading: string,
    tag: string,
  ): Promise<string> {
    const found = await editor.page.evaluate(
      ({ heading, tag }) => {
        const title = [...document.querySelectorAll<HTMLElement>('*')].find(
          (e) =>
            e.children.length === 0 && e.offsetParent !== null && e.textContent?.trim() === heading,
        );
        const panel =
          title?.closest('article, aside, section, .property-panel') ??
          title?.parentElement?.parentElement;
        if (!panel) return false;
        panel.setAttribute('data-mcp-scope', tag);
        return true;
      },
      { heading, tag },
    );
    if (!found) throw new EditorStepError(`the "${heading}" panel did not open`);
    return `[data-mcp-scope="${tag}"]`;
  }

  async setTheme(reportId: string, theme: ThemeSpec): Promise<void> {
    await this.edit(reportId, async (editor) => {
      await editor.deselect();
      await editor.page.getByRole('button', { name: 'Theme and layout' }).click();
      await editor.settle(600);
      const scope = await this.scopeFor(editor, 'Theme and Layout', 'theme');
      if (theme.preset) {
        await editor.step(`apply the ${theme.preset} theme`, async () => {
          await editor.page
            .locator(scope)
            .getByText(theme.preset!, { exact: true })
            .first()
            .click();
        });
        await editor.settle();
      }
      if (theme.settings && Object.keys(theme.settings).length > 0) {
        await editor.page.locator(scope).getByRole('button', { name: 'Customize' }).click();
        await editor.settle(600);
        const editScope = await this.scopeFor(editor, 'Edit Theme', 'edit-theme');
        const missing = await editor.applySettings(theme.settings, editScope);
        if (missing.length)
          throw new EditorStepError(`the theme has no settings named: ${missing.join(', ')}`);
        await editor.page
          .getByRole('button', { name: 'Close Edit Theme' })
          .click()
          .catch(() => undefined);
      }
      if (theme.canvas || theme.layout) {
        await editor.page
          .getByRole('button', { name: 'Theme and layout' })
          .click()
          .catch(() => undefined);
        const layoutScope = await this.scopeFor(editor, 'Theme and Layout', 'layout');
        await editor.page.locator(layoutScope).getByText('Layout', { exact: true }).first().click();
        await editor.settle(500);
        const settings: StyleSettings = {
          ...theme.layout,
          ...(theme.canvas?.width ? { 'Width (px)': theme.canvas.width } : {}),
          ...(theme.canvas?.height ? { 'Height (px)': theme.canvas.height } : {}),
        };
        const missing = await editor.applySettings(settings, layoutScope);
        if (missing.length)
          throw new EditorStepError(`the Layout tab has no settings named: ${missing.join(', ')}`);
      }
    });
  }

  async addPage(reportId: string, name: string): Promise<ReportPage> {
    return this.edit(reportId, async (editor) => {
      // New pages go after the current one: start from the last page to append.
      await editor.clickMenu('Page', ['Last page']).catch(() => undefined);
      const before = editor.page.url();
      // The toolbar's Add page button turns into page navigation once there are two pages.
      await editor.clickMenu('Page', ['New page']);
      await editor.page.waitForURL((url) => url.toString() !== before, {
        timeout: this.opts.stepTimeoutMs,
      });
      await editor.waitForEditor();
      await this.renameCurrentPage(editor, name);
      const pages = await this.readPages(editor);
      return pages.find((p) => p.name === name) ?? { index: pages.length, name };
    });
  }

  async renamePage(reportId: string, page: number, name: string): Promise<void> {
    await this.edit(reportId, async (editor) => {
      await this.goToPage(editor, page);
      await this.renameCurrentPage(editor, name);
    });
  }

  // The page being edited, from the toolbar's "Page 2 of 3".
  private async currentPageNumber(editor: LookerStudioEditor): Promise<number> {
    const label = await editor.page
      .getByText(/^Page \d+ of \d+$/)
      .first()
      .textContent({ timeout: 3_000 })
      .catch(() => null);
    return Number(/^Page (\d+)/.exec(label?.trim() ?? '')?.[1] ?? 1);
  }

  // Page › Manage pages lists the pages as chips; double-clicking one renames it.
  private async openPagesPanel(editor: LookerStudioEditor): Promise<boolean> {
    try {
      await editor.clickMenu('Page', ['Manage pages']);
    } catch {
      return false; // disabled while the report has a single page
    }
    await editor.page.locator(SEL.pageChip).first().waitFor({ timeout: this.opts.stepTimeoutMs });
    return true;
  }

  private async renameCurrentPage(editor: LookerStudioEditor, name: string): Promise<void> {
    const current = await this.currentPageNumber(editor);
    await editor.step(`name page ${current} "${name}"`, async () => {
      if (!(await this.openPagesPanel(editor))) {
        // Manage pages is off while the report has one page: add a page, rename
        // the first one, then delete the extra page.
        await this.withTemporaryPage(editor, () => this.renameChip(editor, 0, name));
        return;
      }
      await this.renameChip(editor, current - 1, name);
    });
  }

  // In the open Page › Manage pages panel, double-clicking a chip renames it.
  private async renameChip(editor: LookerStudioEditor, at: number, name: string): Promise<void> {
    await editor.page.locator(SEL.pageChip).nth(at).dblclick();
    const input = editor.page
      .getByPlaceholder('Enter new name')
      .or(editor.page.getByLabel('Enter new name'));
    await input.first().fill(name);
    await input.first().press('Enter');
    await editor.settle(500);
    await editor.page.keyboard.press('Escape');
  }

  // Adds a last page so Manage pages turns on, runs `work` in its panel, then
  // deletes that page again.
  private async withTemporaryPage(
    editor: LookerStudioEditor,
    work: () => Promise<void>,
  ): Promise<void> {
    const page = editor.page;
    const before = page.url();
    await editor.clickMenu('Page', ['New page']);
    await page.waitForURL((url) => url.toString() !== before, { timeout: this.opts.stepTimeoutMs });
    await editor.waitForEditor();
    try {
      if (!(await this.openPagesPanel(editor))) throw new Error('Manage pages did not turn on');
      await work();
    } finally {
      await editor.clickMenu('Page', ['Last page']).catch(() => undefined);
      await editor.clickMenu('Page', ['Delete page']);
      await page
        .getByRole('button', { name: /^(Delete|Yes|OK)$/i })
        .last()
        .click({ timeout: 3_000 })
        .catch(() => undefined);
      await editor.settle(1500);
    }
  }

  private async readPages(editor: LookerStudioEditor): Promise<ReportPage[]> {
    if (!(await this.openPagesPanel(editor))) return [{ index: 1, name: 'Page 1' }];
    const names = await editor.page.locator(SEL.pageChip).allInnerTexts();
    await editor.page.keyboard.press('Escape');
    return names.map((n, i) => ({ index: i + 1, name: n.trim() }));
  }

  async listPages(reportId: string): Promise<ReportPage[]> {
    return this.edit(reportId, (editor) => this.readPages(editor));
  }

  async renameReport(reportId: string, name: string): Promise<void> {
    await this.edit(reportId, (editor) => editor.rename(name));
  }

  // Share opens Google's sharing dialog. Invitations go one address per Send:
  // several chips in one Send fail with "An unknown error occurred". People who
  // already have access get their role changed from their row instead, which
  // closes the dialog. Google refuses invitations from a headless browser, so
  // this runs in a visible window.
  async shareReport(
    reportId: string,
    emails: string[],
    role: 'viewer' | 'editor',
    notify: boolean,
  ): Promise<void> {
    await this.edit(
      reportId,
      async (editor) => {
        const page = editor.page;
        const dialog = page.locator('mat-dialog-container');
        const wanted = role === 'editor' ? 'Editor' : 'Viewer';
        const pickRole = async () =>
          page
            .locator('.cdk-overlay-container [role=menuitem]')
            .filter({ hasText: new RegExp(`^\\s*${wanted}\\s*$`) })
            .first()
            .click();
        const accessOf = (email: string) =>
          dialog.evaluate((d, address) => {
            const leaf = [...d.querySelectorAll('*')].find(
              (e) => e.children.length === 0 && e.textContent?.trim() === address,
            );
            const row = leaf?.closest('.binding');
            const button = row?.querySelector<HTMLElement>('button');
            if (!button) return null;
            const r = button.getBoundingClientRect();
            return { role: button.innerText.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }, email);

        const input = dialog.locator('input.add-people-input');
        const openDialog = async () => {
          if (await input.isVisible().catch(() => false)) return;
          // After a Send the dialog can stay open on a view without the input.
          if (await dialog.isVisible().catch(() => false)) {
            const done = dialog.getByRole('button', { name: /^(Done|Close)$/ }).first();
            await done.click({ timeout: 3_000 }).catch(() => page.keyboard.press('Escape'));
            await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
          }
          await page.getByRole('button', { name: /lets users share a report/ }).click();
          await input.waitFor({ timeout: this.opts.stepTimeoutMs });
        };

        for (const email of emails) {
          await editor.step(`share with ${email} as ${role}`, async () => {
            await openDialog();
            const existing = await accessOf(email);
            if (existing) {
              if (existing.role === wanted) return;
              await page.mouse.click(existing.x, existing.y);
              await pickRole();
              const save = dialog.getByRole('button', { name: 'Save', exact: true });
              if (await save.isVisible({ timeout: 2_000 }).catch(() => false)) await save.click();
            } else {
              await input.click();
              await page.keyboard.type(email, { delay: 15 });
              await page.waitForTimeout(600);
              await page.keyboard.press('Enter');
              const send = dialog.getByRole('button', { name: 'Send', exact: true });
              await send.waitFor({ timeout: this.opts.stepTimeoutMs });
              if (wanted !== 'Viewer') {
                await dialog.getByText('Viewer', { exact: true }).first().click();
                await pickRole();
              }
              const checkbox = dialog.locator('input[type=checkbox]').first();
              if ((await checkbox.count()) && (await checkbox.isChecked()) !== notify) {
                await checkbox.click({ force: true });
              }
              await send.click();
            }
            // Back on the list once Google accepts it; an error stays in the form.
            const deadline = Date.now() + this.opts.stepTimeoutMs;
            for (;;) {
              await page.waitForTimeout(500);
              await openDialog();
              const refusal = (await dialog.innerText()).match(
                /[^\n]*(unknown error|try again later)[^\n]*/i,
              );
              if (refusal) throw new Error(`Google refused the invitation: ${refusal[0].trim()}`);
              if ((await accessOf(email))?.role === wanted) break;
              if (Date.now() > deadline)
                throw new Error(`${email} is not listed as ${wanted} after sending`);
            }
          });
        }
        await dialog
          .getByRole('button', { name: 'Done', exact: true })
          .click()
          .catch(() => page.keyboard.press('Escape'));
      },
      { visible: true },
    );
  }

  private async fitWindowTo(tab: Page, canvas: Locator): Promise<() => Promise<void>> {
    const box = await canvas.boundingBox();
    const size = await tab.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const cdp = await tab.context().newCDPSession(tab);
    try {
      const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget');
      const needed = box ? Math.ceil(box.y + box.height + 40) : 0;
      if (!box || needed <= size.height)
        return async () => void (await cdp.detach().catch(() => undefined));
      const original = bounds.height ?? size.height;
      await cdp.send('Browser.setWindowBounds', {
        windowId,
        bounds: { height: original + needed - size.height },
      });
      await this.waitForResize(tab, canvas, size.height);
      return async () => {
        await cdp
          .send('Browser.setWindowBounds', { windowId, bounds: { height: original } })
          .catch(() => undefined);
        await cdp.detach().catch(() => undefined);
      };
    } catch {
      await cdp.detach().catch(() => undefined);
      return async () => undefined;
    }
  }

  // ── Window resize: wait for the editor to relayout ─────────────────────

  // Instead of a fixed 2 s: the window has grown and the canvas stopped moving.
  private async waitForResize(tab: Page, canvas: Locator, fromHeight: number): Promise<void> {
    await tab
      .waitForFunction((h) => window.innerHeight > h, fromHeight, { timeout: 2_000 })
      .catch(() => undefined);
    const deadline = Date.now() + 2_000;
    let last = '';
    while (Date.now() < deadline) {
      const box = JSON.stringify(await canvas.boundingBox().catch(() => null));
      if (box === last) return;
      last = box;
      await tab.waitForTimeout(200);
    }
  }

  async screenshot(reportId: string, page?: number): Promise<{ path: string; notes: string[] }> {
    return this.opts.browser.withPage(async (tab) => {
      const editor = await LookerStudioEditor.openReport(tab, reportId, this.opts.stepTimeoutMs);
      await this.goToPage(editor, page);
      const viewUrl = tab.url().replace(/\/edit(\?|$)/, '$1');
      await tab.goto(
        viewUrl.includes('hl=') ? viewUrl : `${viewUrl}${viewUrl.includes('?') ? '&' : '?'}${HL}`,
        { waitUntil: 'domcontentloaded' },
      );
      // 'networkidle' never comes in the viewer either (it waited its whole
      // 30 s): wait for the charts' shimmers instead, then let them paint.
      await tab
        .locator(SEL.canvas)
        .first()
        .waitFor({ timeout: this.opts.stepTimeoutMs })
        .catch(() => undefined);
      await editor.waitForCharts(30_000);
      await editor.settle(1000);
      await editor.declineConsent(2_000);
      const notes = editor.consentDeclines
        ? [
            'Some charts read a data source with viewer\'s credentials or the viewer email parameter: they show "Allow" instead of data until each viewer grants consent in Looker Studio. The consent dialog was declined, not granted on your behalf.',
          ]
        : [];
      mkdirSync(this.opts.screenshotsDir, { recursive: true });
      const file = join(this.opts.screenshotsDir, `${reportId}-p${page ?? 1}-${Date.now()}.png`);
      const canvas = tab.locator(SEL.canvas).first();
      if (!(await canvas.count())) {
        await tab.screenshot({ path: file, fullPage: true });
        return { path: file, notes };
      }
      // The viewer scrolls inside its own container, so a page taller than the
      // window gets clipped: grow the window to fit the whole page first.
      const restore = await this.fitWindowTo(tab, canvas);
      try {
        await canvas.screenshot({ path: file });
      } finally {
        await restore();
      }
      return { path: file, notes };
    });
  }

  async deleteReport(reportId: string): Promise<void> {
    await this.opts.browser.withPage(async (page) => {
      const editor = new LookerStudioEditor(page, this.opts.stepTimeoutMs);
      await page.goto(`${BASE}/navigation/reporting?${HL}`, { waitUntil: 'domcontentloaded' });
      await editor.step('move the report to the trash', async () => {
        const link = page.locator(`a[href*="/reporting/${cssEscape(reportId)}"]`).first();
        await link.waitFor({ timeout: this.opts.stepTimeoutMs });
        const row = link.locator('xpath=ancestor::*[self::tr or @role="row"][1]');
        const scope = (await row.count()) ? row : link.locator('xpath=../../..');
        await scope.hover();
        await scope
          .getByRole('button', { name: /more|options/i })
          .last()
          .click();
        await page
          .getByRole('menuitem', { name: /Remove|Move to trash/ })
          .first()
          .click();
        await page
          .getByRole('button', { name: /Move to trash|Remove/ })
          .last()
          .click({ timeout: 5_000 })
          .catch(() => undefined);
        await link.waitFor({ state: 'detached', timeout: this.opts.stepTimeoutMs });
      });
    });
  }

  // ── Community visualizations ───────────────────────────────────────────

  async addCommunityViz(
    reportId: string,
    viz: CommunityVizSpec,
    opts: PlaceOptions & { dataSource?: string; style?: StyleSettings },
  ): Promise<ComponentInfo> {
    return this.edit(reportId, async (editor) => {
      await this.goToPage(editor, opts.page);
      const spot = await this.spotFor(editor, opts.layout);
      const what = describeCommunityViz(viz.source);
      const index = await editor.placeAt(spot.x, spot.y, () =>
        editor.step(`pick the ${what}`, () => editor.pickCommunityViz(viz.source)),
      );
      const title = await editor.select(index);
      if (!COMMUNITY_SEL.panelTitle.test(title)) {
        await editor.undo();
        throw new EditorStepError(
          `expected a community visualization but the editor inserted "${title || 'unknown'}"; it was undone.`,
        );
      }
      try {
        return await this.configureCommunityViz(editor, index, viz, opts);
      } catch (err) {
        await editor.remove(index).catch(() => undefined);
        throw err;
      }
    });
  }

  // Each visualization defines its own Setup slots: dimensions and metrics go
  // to the sections named like the built-in ones, anything else by heading.
  private async configureCommunityViz(
    editor: LookerStudioEditor,
    index: number,
    viz: CommunityVizSpec,
    opts: PlaceOptions & { dataSource?: string; style?: StyleSettings },
  ): Promise<ComponentInfo> {
    if (opts.dataSource) await editor.chooseDataSource(opts.dataSource);
    if (viz.dimensions.length > 0)
      await editor.setSectionFields(SECTION.dimensions, viz.dimensions, 'the dimensions');
    if (viz.metrics.length > 0)
      await editor.setSectionFields(
        SECTION.metrics,
        viz.metrics.map((m) => m.field),
        'the metrics',
      );
    await this.applyFields(editor, viz.fields ?? {});
    for (const [i, metric] of viz.metrics.entries()) {
      if (!metric.aggregation && metric.label === undefined) continue;
      await editor.editMetric(i, {
        ...(metric.aggregation ? { aggregation: AGGREGATION_LABEL[metric.aggregation] } : {}),
        ...(metric.label !== undefined ? { label: metric.label } : {}),
      });
    }
    const warnings = await this.applyData(editor, { ...viz, fields: {} });
    const style: StyleSettings = {
      ...(viz.title ? { 'Show title': true } : {}),
      ...(opts.style ?? {}),
    };
    if (Object.keys(style).length > 0) {
      await editor.openTab('Style');
      warnings.push(...(await editor.applySettings(style)));
      if (viz.title) warnings.push(...(await this.setChartTitle(editor, viz.title)));
    }
    // The visualization draws in an iframe that takes the pointer: a resize
    // handle dragged inwards over it lost the drag (and once left it 6x1).
    await editor.deselect();
    await editor.settle(1500);
    const unblock = await editor.page.addStyleTag({
      content: `${SEL.canvas} iframe { pointer-events: none !important; }`,
    });
    try {
      return await this.finish(editor, index, opts.layout, warnings);
    } finally {
      await unblock.evaluate((e: Element) => e.remove()).catch(() => undefined);
    }
  }

  // ── Report check ──

  // Walks the pages in the editor (so indexes match list_components), waits
  // for each page's charts and reads what they show instead of data.
  async checkReport(
    reportId: string,
    opts: { page?: number; timeoutMs: number },
  ): Promise<ReportCheck> {
    return this.edit(reportId, async (editor) => {
      const pages = opts.page ? [{ index: opts.page }] : await this.readPages(editor);
      const problems: ChartProblem[] = [];
      let components = 0;
      for (const page of pages) {
        await this.goToPage(editor, page.index);
        const states = await editor.waitForCharts(opts.timeoutMs);
        const where = {
          page: page.index,
          ...('name' in page && page.name ? { pageName: page.name } : {}),
        };
        for (const state of states.filter((s) => s.data)) {
          components++;
          // Vega charts draw empty axes for no rows: count the points they drew.
          const points =
            state.loading || state.error || state.noData
              ? undefined
              : await editor.vegaPoints(state.index, 5_000);
          const problem = chartProblem(
            { ...state, ...(points !== undefined ? { points } : {}) },
            opts.timeoutMs,
          );
          if (!problem) continue;
          // Details first: selecting the chart afterwards could land on its link.
          const details = state.error?.hasDetails
            ? await editor.errorDetails(state.index).catch(() => undefined)
            : undefined;
          const { kind, fields, dataSource } = await this.describeForCheck(
            editor,
            state.index,
            state.type,
          );
          problems.push({
            ...where,
            index: state.index,
            kind,
            ...(state.title ? { title: state.title } : {}),
            ...(dataSource ? { dataSource } : {}),
            ...(fields.length ? { fields } : {}),
            ...problem,
            ...(details ? { details } : {}),
          });
        }
        await editor.deselect();
      }
      return {
        pages,
        components,
        problems,
        ...(editor.consentDeclines ? { consentDeclined: true } : {}),
      };
    });
  }

  // Kind and Setup fields of a chart with a problem; the chart's header class
  // stands in when it cannot be selected (covered by another component).
  private async describeForCheck(
    editor: LookerStudioEditor,
    index: number,
    type?: string,
  ): Promise<{ kind: string; fields: string[]; dataSource?: string }> {
    try {
      const title = await editor.select(index);
      const kind = title.replace(/ properties$/i, '');
      const fields = await editor.setupFields().catch(() => []);
      const dataSource = await editor.chartDataSource().catch(() => null);
      return { kind, fields, ...(dataSource ? { dataSource } : {}) };
    } catch {
      return { kind: type ?? 'chart', fields: [] };
    }
  }

  // ── data sources ──
  // Resource › Manage added data sources lists them; Edit opens the data source
  // editor (fields, credentials, freshness) and its Edit Connection page (table or SQL).

  async listDataSources(
    reportId: string,
    opts: { ref?: string; fields?: boolean } = {},
  ): Promise<DataSourceInfo[]> {
    return this.edit(reportId, async (editor) => {
      await this.openSourcesPanel(editor);
      const rows = await this.readSourceRows(editor);
      const targets = opts.ref ? [findDataSource(rows, opts.ref)] : rows;
      const out: DataSourceInfo[] = [];
      for (const row of targets) {
        const info: DataSourceInfo = { ...row, charts: chartsUsing(row.usedIn), kind: 'other' };
        await this.editListedSource(editor, row);
        Object.assign(info, await this.readSourceHeader(editor));
        if (opts.fields) info.fields = await this.readSourceFields(editor);
        // Reading the connection ends in the Data sources panel.
        if (/bigquery/i.test(row.connector)) Object.assign(info, await this.readConnection(editor));
        else await this.leaveSourceEditor(editor, false);
        out.push(info);
      }
      await this.closeSourcesPanel(editor);
      return out;
    });
  }

  async removeDataSource(reportId: string, ref: string, force: boolean): Promise<DataSourceRow> {
    const { row, removed } = await this.edit(reportId, async (editor) => {
      const page = editor.page;
      await this.openSourcesPanel(editor);
      const row = findDataSource(await this.readSourceRows(editor), ref);
      if (isUsed(row.usedIn) && !force) {
        await this.closeSourcesPanel(editor);
        return { row, removed: false };
      }
      await editor.step(`remove the data source ${row.name} (${row.alias})`, async () => {
        await (
          await this.sourceRow(editor, row.alias)
        )
          .getByRole('button', { name: /^remove$/i })
          .click();
        // The same dialog warns when charts use the source; they are left broken.
        const dialog = page.locator('mat-dialog-container', {
          hasText: 'You are removing a data source',
        });
        await dialog.waitFor({ timeout: this.opts.stepTimeoutMs });
        await dialog.getByRole('button', { name: /^remove data source$/i }).click();
        await dialog.waitFor({ state: 'detached', timeout: this.opts.stepTimeoutMs });
        await editor.settle(1500);
        const left = await this.readSourceRows(editor);
        if (left.some((r) => r.alias === row.alias)) throw new Error('it is still listed');
      });
      await this.closeSourcesPanel(editor);
      return { row, removed: true };
    });
    // Refused outside the editor visit: it is an answer, not a failed step.
    if (!removed) throw new DataSourceInUseError(row);
    return row;
  }

  async updateDataSource(
    reportId: string,
    ref: string,
    change: DataSourceChange,
  ): Promise<string[]> {
    return this.edit(reportId, async (editor) => {
      const page = editor.page;
      await this.openSourcesPanel(editor);
      const row = findDataSource(await this.readSourceRows(editor), ref);
      const notes: string[] = [];
      const editing =
        change.name !== undefined ||
        change.sql !== undefined ||
        change.credentials ||
        change.freshness;
      if (!editing) {
        notes.push(await this.makeReusable(editor, row.alias, change.grantEditorAccess));
        await this.closeSourcesPanel(editor);
        return notes;
      }
      await this.editListedSource(editor, row);
      if (change.sql !== undefined) notes.push(...(await this.replaceSql(editor, change.sql)));
      if (change.name !== undefined) {
        await editor.step(`rename the data source to "${change.name}"`, async () => {
          const box = page.locator(SEL.dataSourceNameInput).filter({ visible: true });
          const index = await box.evaluateAll(
            (inputs, current) => inputs.findIndex((i) => (i as HTMLInputElement).value === current),
            row.name,
          );
          if (index < 0) throw new Error('the data source name box was not found');
          await box.nth(index).fill(change.name!);
          await box.nth(index).press('Enter');
          await editor.settle(800);
        });
      }
      if (change.credentials) {
        const label = CREDENTIALS_LABEL[change.credentials];
        await editor.step(`set the data credentials to ${label}`, async () => {
          const declines = editor.consentDeclines;
          await page.getByRole('button', { name: DATA_SOURCE.credentialsButton }).click();
          const dialog = page.locator('mat-dialog-container', {
            hasText: 'Update data credentials',
          });
          await dialog.waitFor({ timeout: this.opts.stepTimeoutMs });
          await dialog.locator('mat-radio-button', { hasText: label }).click();
          await dialog.getByRole('button', { name: /^update$/i }).click();
          await dialog.waitFor({ state: 'detached', timeout: this.opts.stepTimeoutMs });
          await editor.settle(1000);
          await editor.declineConsent(5_000);
          if (editor.consentDeclines > declines)
            notes.push(
              'With viewer credentials Looker Studio asks every viewer, editors included, to grant consent ("Grant consent") before it loads data.',
            );
        });
      }
      if (change.freshness) {
        const setting = parseFreshness(change.freshness);
        const label =
          'preset' in setting ? FRESHNESS_LABEL[setting.preset] : DATA_SOURCE.freshnessCustom;
        await editor.step(`set the data freshness to ${change.freshness}`, async () => {
          await page.getByRole('button', { name: DATA_SOURCE.freshnessButton }).click();
          const dialog = page.locator(DATA_SOURCE.freshnessDialog);
          await dialog.waitFor({ timeout: this.opts.stepTimeoutMs });
          await dialog
            .locator('md-radio-button')
            .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*(Default)?\\s*$`) })
            .click();
          if ('custom' in setting) {
            // The amounts depend on the unit: pick the unit first.
            await editor.settle(500);
            await this.pickMdSelect(
              editor,
              dialog.locator(DATA_SOURCE.freshnessUnit),
              setting.custom.unit,
            );
            await this.pickMdSelect(
              editor,
              dialog.locator(DATA_SOURCE.freshnessAmount),
              String(setting.custom.amount),
            );
          }
          await dialog.getByRole('button', { name: /set data freshness/i }).click();
          await dialog.waitFor({ state: 'detached', timeout: this.opts.stepTimeoutMs });
          await editor.settle(1000);
        });
      }
      const after = await this.readSourceHeader(editor);
      if (change.credentials) notes.push(`Data credentials: ${after.credentials ?? '?'}`);
      if (change.freshness) notes.push(`Data freshness: ${after.freshness ?? '?'}`);
      await this.leaveSourceEditor(editor, true);
      if (change.makeReusable)
        notes.push(await this.makeReusable(editor, row.alias, change.grantEditorAccess));
      await this.closeSourcesPanel(editor);
      if (change.freshness && after.freshness !== change.freshness)
        throw new EditorStepError(
          `the data freshness shows "${after.freshness ?? '?'}" instead of ${change.freshness}`,
        );
      return notes;
    });
  }

  // ── reusable data sources ──
  // Make reusable moves an embedded data source to the account's data sources
  // (the alias stays); there is no way back from the editor.
  private async makeReusable(
    editor: LookerStudioEditor,
    alias: string,
    grantEditorAccess?: boolean,
  ): Promise<string> {
    const page = editor.page;
    const row = (await this.readSourceRows(editor)).find((r) => r.alias === alias);
    if (/reusable/i.test(row?.scope ?? '')) return `${row!.name} (${alias}) was already reusable.`;
    await editor.step(`make the data source ${alias} reusable`, async () => {
      await (
        await this.sourceRow(editor, alias)
      )
        .getByRole('button', { name: DATA_SOURCE.makeReusableButton })
        .click();
      const dialog = page.locator('mat-dialog-container', {
        hasText: DATA_SOURCE.makeReusableDialog,
      });
      await dialog.waitFor({ timeout: this.opts.stepTimeoutMs });
      if (grantEditorAccess !== undefined) {
        const box = dialog.locator('mat-checkbox', { hasText: DATA_SOURCE.grantEditorAccess });
        const checked = await box.locator('input[type=checkbox]').isChecked();
        if (checked !== grantEditorAccess) await box.locator('input[type=checkbox]').click();
      }
      await dialog.getByRole('button', { name: DATA_SOURCE.makeReusableButton }).click();
      await dialog.waitFor({ state: 'detached', timeout: this.opts.stepTimeoutMs });
      await editor.settle(1500);
      const after = (await this.readSourceRows(editor)).find((r) => r.alias === alias);
      if (!/reusable/i.test(after?.scope ?? '')) throw new Error('it is still listed as embedded');
    });
    return `${row?.name ?? alias} (${alias}) is now a reusable data source in the account's data sources.`;
  }

  // AngularJS md-select: its options open in a menu container outside the dialog.
  private async pickMdSelect(
    editor: LookerStudioEditor,
    select: Locator,
    option: string,
  ): Promise<void> {
    const page = editor.page;
    await select.click();
    const menu = page.locator(DATA_SOURCE.openSelectMenu).last();
    await menu.waitFor({ timeout: 5_000 });
    const item = menu
      .locator('md-option')
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(option)}\\s*$`) });
    if (!(await item.count())) {
      const offered = (await menu.locator('md-option').allInnerTexts()).map((t) => t.trim());
      await page.keyboard.press('Escape');
      throw new Error(`no option "${option}" (offered: ${offered.join(', ')})`);
    }
    await item.first().click();
    await menu.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
    await editor.settle(400);
  }

  async updateField(
    reportId: string,
    ref: string | undefined,
    field: string,
    change: FieldChange,
  ): Promise<DataSourceField> {
    return this.edit(reportId, async (editor) => {
      const page = editor.page;
      await this.openSourcesPanel(editor);
      const rows = await this.readSourceRows(editor);
      if (!ref && rows.length !== 1) {
        await this.closeSourcesPanel(editor);
        throw new DataSourceNotFoundError(
          `The report has several data sources; pass data_source: ${rows.map((r) => `${r.name} (${r.alias})`).join(', ')}.`,
        );
      }
      const row = ref ? findDataSource(rows, ref) : rows[0]!;
      await this.editListedSource(editor, row);
      const fieldRow = await this.findFieldRow(editor, field);
      if (change.type) {
        const path = fieldTypePath(change.type);
        await editor.step(`set the type of ${field} to ${path.join(' › ')}`, async () => {
          const dropdown = fieldRow.getByRole('button', { name: DATA_SOURCE.typeDropdown });
          if (!(await dropdown.isVisible())) throw new Error('the type of this field is fixed');
          await dropdown.click();
          await this.pickMdMenu(editor, path);
          await editor.settle(1500);
        });
      }
      if (change.aggregation) {
        const label = FIELD_AGGREGATION_LABEL[change.aggregation];
        await editor.step(`set the aggregation of ${field} to ${label}`, async () => {
          const dropdown = fieldRow.getByRole('button', { name: DATA_SOURCE.aggregationDropdown });
          if (!(await dropdown.isVisible()))
            throw new Error(
              `the aggregation of a ${await this.fieldType(fieldRow)} field cannot be changed (change its type to Number first)`,
            );
          await dropdown.click();
          await this.pickMdMenu(editor, [label]);
          await editor.settle(1500);
        });
      }
      let current = field;
      if (change.name) {
        await editor.step(`rename the field ${field} to "${change.name}"`, async () => {
          await fieldRow.locator(DATA_SOURCE.fieldName).click();
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.type(change.name!);
          await page.keyboard.press('Enter');
          await editor.settle(1200);
        });
        current = change.name;
      }
      const result = (await this.readSourceFields(editor)).find((f) => f.name === current);
      await this.leaveSourceEditor(editor, true);
      await this.closeSourcesPanel(editor);
      if (!result) throw new EditorStepError(`the field ${current} is not listed after the change`);
      return result;
    });
  }

  private async openSourcesPanel(editor: LookerStudioEditor): Promise<void> {
    await editor.declineConsent(1_500);
    await editor.clickMenu('Resource', ['Manage added data sources']);
    await this.waitForSourceRows(editor);
    await editor.settle(500);
  }

  // The Type chip (Embedded/Reusable) has no cell of its own: cells are told
  // apart by content, not by position.
  private async readSourceRows(editor: LookerStudioEditor): Promise<DataSourceRow[]> {
    const rows = await editor.page.evaluate(() => {
      const text = (e: Element | undefined) => e?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
      return [...document.querySelectorAll('tr, [role=row]')].slice(1).map((r) => {
        const cells = [...r.querySelectorAll('td, [role=cell]')].map((c) => text(c));
        const used = cells.findIndex((c) => /\d+\s+charts?\b/i.test(c));
        return {
          name: cells[0] ?? '',
          alias: cells.at(-1) ?? '',
          connector: cells[1] ?? '',
          // Not from the name ("… reusable") nor the MAKE REUSABLE button.
          scope:
            /\b(Embedded|Reusable)\b/.exec(
              (r as HTMLElement).innerText.replace(cells[0] ?? '', ''),
            )?.[1] ?? '',
          usedIn: used >= 0 ? cells[used]! : '',
          status: used >= 0 ? (cells[used + 1] ?? '') : '',
        };
      });
    });
    return rows.filter((r) => r.name && /^ds\d+$/.test(r.alias));
  }

  private async sourceRow(editor: LookerStudioEditor, alias: string): Promise<Locator> {
    const index = await editor.page.evaluate(
      (wanted) =>
        [...document.querySelectorAll('tr, [role=row]')].findIndex(
          (r) => [...r.querySelectorAll('td, [role=cell]')].at(-1)?.textContent?.trim() === wanted,
        ),
      alias,
    );
    if (index < 0) throw new Error(`the data source ${alias} is not listed`);
    return editor.page.locator('tr, [role=row]').nth(index);
  }

  // From the Data sources panel into the editor of one row.
  private async editListedSource(editor: LookerStudioEditor, row: DataSourceRow): Promise<void> {
    await editor.step(`edit the data source ${row.name} (${row.alias})`, async () => {
      await (
        await this.sourceRow(editor, row.alias)
      )
        .getByRole('button', { name: /^edit$/i })
        .click();
      await editor.page
        .getByRole('button', { name: 'REFRESH FIELDS' })
        .waitFor({ timeout: this.opts.stepTimeoutMs });
      await editor.settle(800);
    });
  }

  // Done saves the editor and goes back to the Data sources panel.
  private async leaveSourceEditor(editor: LookerStudioEditor, save: boolean): Promise<void> {
    await editor.step(save ? 'save the data source' : 'close the data source', async () => {
      await editor.page
        .getByRole('button', { name: 'Done', exact: true })
        .first()
        .click({ timeout: this.opts.stepTimeoutMs });
      await this.waitForSourceRows(editor);
      await editor.settle(800);
    });
  }

  // Header buttons read "Data credentials: <owner>" and "Data freshness: 12 hours".
  private async readSourceHeader(
    editor: LookerStudioEditor,
  ): Promise<{ credentials?: string; freshness?: string }> {
    const page = editor.page;
    const read = async (name: string | RegExp) => {
      const button = page.getByRole('button', { name }).first();
      const value = await button.innerText({ timeout: 3_000 }).catch(() => '');
      return (
        value
          .replace(/\s+/g, ' ')
          .replace(/^[^:]*:\s*/, '')
          .trim() || undefined
      );
    };
    const out: { credentials?: string; freshness?: string } = {};
    // The button names the owner, or says "Viewer".
    const credentials = await read(DATA_SOURCE.credentialsButton);
    if (credentials)
      out.credentials = /^viewer$/i.test(credentials)
        ? "viewer's credentials"
        : `owner's credentials (${credentials})`;
    const freshness = await read(DATA_SOURCE.freshnessButton);
    if (freshness) out.freshness = freshness;
    return out;
  }

  private readSourceFields(editor: LookerStudioEditor): Promise<DataSourceField[]> {
    return editor.page.evaluate((sel) => {
      const first = (e: Element | null) =>
        (e as HTMLElement | null)?.innerText.trim().split('\n')[0]?.trim() ?? '';
      return [...document.querySelectorAll(sel.fieldRow)].map((r) => {
        const label = r.querySelector(sel.fieldName);
        return {
          name: label?.textContent?.trim() ?? '',
          type: first(r.querySelector(sel.typeColumn)),
          aggregation: first(r.querySelector(sel.aggregationColumn)),
          kind: label?.closest('.metric') ? ('metric' as const) : ('dimension' as const),
        };
      });
    }, DATA_SOURCE);
  }

  // The field list can be long: filter it with the editor's search box first.
  private async findFieldRow(editor: LookerStudioEditor, field: string): Promise<Locator> {
    const page = editor.page;
    return editor.step(`find the field ${field}`, async () => {
      const search = page
        .getByPlaceholder(DATA_SOURCE.searchFields)
        .filter({ visible: true })
        .last();
      if (await search.isVisible().catch(() => false)) {
        await search.fill(field);
        await editor.settle(800);
      }
      const rows = page.locator(DATA_SOURCE.fieldRow).filter({
        has: page.locator(DATA_SOURCE.fieldName, {
          hasText: new RegExp(`^\\s*${escapeRegExp(field)}\\s*$`),
        }),
      });
      if ((await rows.count()) === 0) {
        if (await search.isVisible().catch(() => false)) await search.fill('');
        await editor.settle(500);
        const names = (await this.readSourceFields(editor)).map((f) => f.name);
        throw new Error(`there is no field "${field}" (fields: ${names.join(', ')})`);
      }
      return rows.first();
    });
  }

  private async fieldType(row: Locator): Promise<string> {
    const text = await row
      .locator(DATA_SOURCE.typeColumn)
      .innerText()
      .catch(() => '');
    return text.trim().split('\n')[0] ?? '';
  }

  // AngularJS md-menus: the first level opens a submenu on hover, to its right.
  // A one-part path is a top item or a leaf of any submenu.
  private async pickMdMenu(editor: LookerStudioEditor, path: string[]): Promise<void> {
    const page = editor.page;
    const menus = () =>
      page.evaluate((sel) => {
        const shown = (e: Element) => e.getBoundingClientRect().width > 0;
        return [...document.querySelectorAll(sel)].filter(shown).map((c) =>
          [...c.querySelectorAll('button')].filter(shown).map((b) => {
            const r = b.getBoundingClientRect();
            return {
              text: b.textContent?.trim().replace(/\s+/g, ' ') ?? '',
              x: r.x + r.width / 2,
              y: r.y + r.height / 2,
            };
          }),
        );
      }, DATA_SOURCE.openMenu);
    const same = (a: string, b: string) =>
      a.toLowerCase() === b.toLowerCase() || a.toLowerCase().startsWith(`${b.toLowerCase()} - `);
    // Closed menus stay in the DOM: wait for a visible one.
    await page
      .locator(DATA_SOURCE.openMenu)
      .filter({ visible: true })
      .first()
      .waitFor({ timeout: this.opts.stepTimeoutMs });
    await editor.settle(400);
    const top = (await menus())[0] ?? [];
    const click = async (item: { x: number; y: number }) => page.mouse.click(item.x, item.y);
    // Hovers a top item; returns its submenu, if it has one.
    const open = async (item: { x: number; y: number }) => {
      await page.mouse.move(item.x, item.y);
      await editor.settle(600);
      const shown = await menus();
      return shown.length > 1 ? shown.at(-1)! : null;
    };
    // Into a submenu along the row of its parent, so it stays open.
    const clickLeaf = async (from: { y: number }, leaf: { x: number; y: number }) => {
      await page.mouse.move(leaf.x, from.y, { steps: 5 });
      await page.mouse.move(leaf.x, leaf.y, { steps: 5 });
      await click(leaf);
    };
    const [first, second] = path;
    if (!first) throw new Error('no menu item given');
    const parent = top.find((i) => same(i.text, first));
    if (second !== undefined || parent) {
      if (!parent)
        throw new Error(`no menu item "${first}" (options: ${top.map((i) => i.text).join(', ')})`);
      const sub = await open(parent);
      if (!sub) return click(parent);
      const wanted = second ?? first;
      const leaf = sub.find((i) => same(i.text, wanted));
      if (!leaf)
        throw new Error(
          `no "${wanted}" under ${parent.text} (options: ${sub.map((i) => i.text).join(', ')})`,
        );
      return clickLeaf(parent, leaf);
    }
    for (const item of top) {
      const sub = await open(item);
      const leaf = sub?.find((i) => same(i.text, first));
      if (leaf) return clickLeaf(item, leaf);
    }
    await page.keyboard.press('Escape');
    throw new Error(`no menu item "${first}" (options: ${top.map((i) => i.text).join(', ')})`);
  }

  // Edit Connection shows the table picked in the BigQuery connector, or the
  // custom query in a CodeMirror box. Its Cancel closes the data source
  // editor too, back to the Data sources panel.
  private async readConnection(
    editor: LookerStudioEditor,
  ): Promise<Pick<DataSourceInfo, 'kind' | 'table' | 'sql' | 'billingProject'>> {
    const page = editor.page;
    return editor.step('read the connection', async () => {
      await this.openConnection(editor);
      // The connector fills its project/dataset/table columns late, sometimes
      // over 6 s after Reconnect shows: wait for the table or the query box.
      await page
        .waitForFunction(
          (sel) => {
            const host = document.querySelector(sel.customQueryEditor);
            if (host && host.getBoundingClientRect().width > 0) return true;
            return [...document.querySelectorAll(sel.selectedOption)].some((a) =>
              /[?&]t=/.test(a.getAttribute('href') ?? ''),
            );
          },
          { customQueryEditor: SEL.customQueryEditor, selectedOption: DATA_SOURCE.selectedOption },
          { timeout: 15_000 },
        )
        .catch(() => undefined);
      const found = await page.evaluate(
        (sel) => {
          const host = document.querySelector(sel.customQueryEditor) as
            (Element & { CodeMirror?: { getValue(): string } }) | null;
          const visible = !!host && host.getBoundingClientRect().width > 0;
          const links = [...document.querySelectorAll(sel.selectedOption)].map(
            (a) => a.getAttribute('href') ?? '',
          );
          return { sql: visible ? (host?.CodeMirror?.getValue() ?? null) : null, links };
        },
        { customQueryEditor: SEL.customQueryEditor, selectedOption: DATA_SOURCE.selectedOption },
      );
      const parts = found.links.map(parseConsoleLink);
      await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
      await this.waitForSourceRows(editor);
      await editor.settle(500);
      if (found.sql !== null) {
        const billing = parts.find((p) => p.project && !p.dataset)?.project;
        return {
          kind: 'custom_query' as const,
          sql: found.sql,
          ...(billing ? { billingProject: billing } : {}),
        };
      }
      const table = parts.find((p) => p.table);
      return table
        ? { kind: 'table' as const, table: `${table.project}.${table.dataset}.${table.table}` }
        : { kind: 'other' as const };
    });
  }

  private async openConnection(editor: LookerStudioEditor): Promise<void> {
    await editor.page.getByRole('button', { name: DATA_SOURCE.editConnection }).first().click();
    await editor.page
      .getByRole('button', { name: 'Reconnect', exact: true })
      .waitFor({ timeout: this.opts.stepTimeoutMs });
    await editor.settle(1500);
  }

  // Edit Connection › CodeMirror › Reconnect, then Apply the field changes.
  private async replaceSql(editor: LookerStudioEditor, sql: string): Promise<string[]> {
    const page = editor.page;
    return editor.step('replace the custom query', async () => {
      await this.openConnection(editor);
      const set = await page.evaluate(
        ({ selector, value }) => {
          const host = document.querySelector(selector) as
            (Element & { CodeMirror?: { setValue(v: string): void } }) | null;
          if (!host?.CodeMirror || host.getBoundingClientRect().width === 0) return false;
          host.CodeMirror.setValue(value);
          return true;
        },
        { selector: SEL.customQueryEditor, value: sql },
      );
      if (!set) {
        await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
        throw new Error('this data source is a table, not a custom query');
      }
      await editor.settle(800);
      await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
      const notes: string[] = [];
      const changes = page.locator('mat-dialog-container', { hasText: 'Apply Connection Changes' });
      const same = page.locator('mat-dialog-container', {
        hasText: 'No connection changes were found',
      });
      const rejected = page.locator('mat-dialog-container, [role=dialog]', {
        hasText: /Configuration Error|query returned an error/i,
      });
      const fields = page.getByRole('button', { name: 'REFRESH FIELDS' });
      const outcome = await Promise.race([
        changes.waitFor({ timeout: 60_000 }).then(() => 'changes' as const),
        same.waitFor({ timeout: 60_000 }).then(() => 'same' as const),
        rejected
          .first()
          .waitFor({ timeout: 60_000 })
          .then(() => 'rejected' as const),
        fields.waitFor({ timeout: 60_000 }).then(() => 'fields' as const),
      ]).catch(() => 'timeout' as const);
      if (outcome === 'rejected') {
        // The dialog only says the query failed; BigQuery's dry run says why.
        const why = (await rejected.first().innerText())
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !/^(ok|error id:.*)$/i.test(l));
        throw new Error(
          `the query was rejected (${why.join(' ')}); the data source keeps its old SQL. Dry-run the SQL with run_query to see the error`,
        );
      }
      if (outcome === 'changes') {
        notes.push(...parseConnectionChanges(await changes.innerText()));
        await changes.getByRole('button', { name: 'Apply' }).click();
      } else if (outcome === 'same') {
        await same.getByRole('button', { name: 'Continue' }).click();
      } else if (outcome === 'timeout') {
        // A rejected query keeps the connection page open with the error on it.
        const error = await page
          .locator('.error, [class*=error], mat-error')
          .filter({ visible: true })
          .allInnerTexts()
          .catch(() => []);
        throw new Error(`the query was not accepted${error.length ? `: ${error.join(' ')}` : ''}`);
      }
      await fields.waitFor({ timeout: this.opts.stepTimeoutMs });
      await editor.settle(1000);
      return notes;
    });
  }
  // ── Batch: several actions in one editor visit ─────────────────────────

  // Every call for `reportId` made inside `work` runs in this one editor visit
  // instead of opening, fitting and closing the report again.
  async inOneVisit<T>(reportId: string, work: () => Promise<T>): Promise<T> {
    return this.edit(reportId, (editor) => {
      const visit: EditorVisit = { reportId, editor, restores: [], dirty: false };
      return this.visit.run(visit, async () => {
        try {
          return await work();
        } finally {
          for (const restore of visit.restores.reverse()) await restore();
        }
      });
    });
  }

  private async inVisit<T>(
    visit: EditorVisit,
    work: (editor: LookerStudioEditor) => Promise<T>,
  ): Promise<T> {
    const { editor } = visit;
    const page = editor.page;
    if (visit.dirty) {
      await LookerStudioEditor.openReport(page, visit.reportId, this.opts.stepTimeoutMs);
      visit.dirty = false;
    } else {
      // What the last action left selected or open must not catch this one's clicks.
      await page.keyboard.press('Escape').catch(() => undefined);
      await editor.deselect().catch(() => undefined);
    }
    // The last action may have made the page taller (canvas or page size).
    visit.restores.push(await this.fitWindowTo(page, page.locator(SEL.canvas).first()));
    try {
      const result = await work(editor);
      await editor.settle(500);
      return result;
    } catch (err) {
      visit.dirty = true;
      mkdirSync(this.opts.screenshotsDir, { recursive: true });
      const shot = join(this.opts.screenshotsDir, `error-${visit.reportId}-${Date.now()}.png`);
      await page.screenshot({ path: shot }).then(
        () => this.opts.logger.warn(`editor step failed; screenshot at ${shot}`),
        () => undefined,
      );
      throw err;
    }
  }

  // The page being edited; no "Page N of M" label means a single page.
  private async pageNow(editor: LookerStudioEditor): Promise<number> {
    const label = editor.page.getByText(/^Page \d+ of \d+$/).first();
    if (!(await label.count())) return 1;
    const text = await label.textContent().catch(() => null);
    return Number(/^Page (\d+)/.exec(text?.trim() ?? '')?.[1] ?? 1);
  }

  // ── Report specs: reading a whole report ───────────────────────────────

  async dataSourceNames(reportId: string): Promise<string[]> {
    return this.edit(reportId, async (editor) => {
      await editor.clickMenu('Resource', ['Manage added data sources']);
      await editor.page
        .locator('tr, [role=row]')
        .nth(1)
        .waitFor({ timeout: this.opts.stepTimeoutMs })
        .catch(() => undefined);
      const sources = await this.listedSources(editor);
      await this.closeSourcesPanel(editor);
      return sources;
    });
  }

  // Name, theme, data sources and every component of every page. Read only:
  // panels are opened and closed, nothing is changed.
  async readReport(reportId: string, style: StyleDepth): Promise<ReportSnapshot> {
    return this.edit(reportId, async (editor) => {
      const name = await editor.reportName();
      const g = await editor.geometry();
      const theme = await this.readThemeName(editor);
      const dataSources = await this.readDataSources(editor, reportId);
      const pages = await this.readPages(editor);
      const out: ReportSnapshot['pages'] = [];
      for (const page of pages) {
        if (page.index > 1) await this.goToPage(editor, page.index);
        else await editor.clickMenu('Page', ['First page']).catch(() => undefined);
        const layouts = await editor.layouts();
        const components: ComponentSnapshot[] = [];
        for (const [index, layout] of layouts.entries()) {
          components.push(
            await this.readComponent(editor, index, layout, style, dataSources.length > 1),
          );
        }
        await editor.deselect();
        out.push({ name: page.name, components });
      }
      return {
        name,
        ...(theme ? { theme } : {}),
        canvas: { width: Math.round(g.width), height: Math.round(g.height) },
        dataSources,
        pages: out,
      };
    });
  }

  private async readThemeName(editor: LookerStudioEditor): Promise<string | undefined> {
    await editor.deselect();
    await editor.page.getByRole('button', { name: 'Theme and layout' }).click();
    await editor.settle(600);
    const name = await editor.page
      .locator('.theme-selector .header-name')
      .first()
      .textContent({ timeout: 3_000 })
      .catch(() => null);
    await editor.deselect();
    return name?.trim() || undefined;
  }

  // Resource › Manage added data sources › Edit › Edit Connection shows the
  // BigQuery project, dataset and table (their links carry the ids) or the
  // custom query. Cancel leaves the connection as it was.
  private async readDataSources(
    editor: LookerStudioEditor,
    reportId: string,
  ): Promise<DataSourceSnapshot[]> {
    const page = editor.page;
    await editor.clickMenu('Resource', ['Manage added data sources']);
    await page
      .locator('tr, [role=row]')
      .nth(1)
      .waitFor({ timeout: this.opts.stepTimeoutMs })
      .catch(() => undefined);
    const names = await this.listedSources(editor);
    await this.closeSourcesPanel(editor);
    const out: DataSourceSnapshot[] = [];
    for (const name of names) {
      try {
        await this.openSourceEditor(editor, name);
        const source = await editor.step(`read the connection of ${name}`, async () => {
          await page.getByText('Edit Connection', { exact: true }).first().click();
          await page
            .locator('ng2-config-column-item .list-option.selected')
            .first()
            .waitFor({ timeout: this.opts.stepTimeoutMs });
          await editor.settle(800);
          const found = await page.evaluate(() => {
            const cm = document.querySelector<
              HTMLElement & { CodeMirror?: { getValue(): string } }
            >('.CodeMirror');
            const links = [...document.querySelectorAll('.list-option.selected')]
              .map((e) => e.closest('ng2-config-column-item')?.querySelector('a')?.href ?? '')
              .filter(Boolean);
            return { sql: cm?.CodeMirror?.getValue(), links };
          });
          const params = found.links.map((l) => new URL(l).searchParams);
          const table = params.find((p) => p.get('t'));
          const projectId = (table ?? params.find((p) => p.get('p')))?.get('p') ?? undefined;
          if (found.sql?.trim() && projectId) return { projectId, sql: found.sql.trim(), name };
          if (table && projectId)
            return { projectId, datasetId: table.get('d') ?? '', tableId: table.get('t') ?? '' };
          return undefined;
        });
        out.push({ name, ...(source ? { source } : {}) });
        await page.getByRole('button', { name: 'Cancel' }).first().click({ timeout: 5_000 });
        await editor.settle(800);
        await page.getByRole('button', { name: 'Done' }).first().click({ timeout: 5_000 });
        await editor.settle(800);
        await this.closeSourcesPanel(editor);
      } catch {
        // A connection screen that would not close: start from a fresh editor.
        if (!out.some((s) => s.name === name)) out.push({ name });
        await LookerStudioEditor.openReport(page, reportId, this.opts.stepTimeoutMs);
      }
    }
    return out;
  }

  private async readComponent(
    editor: LookerStudioEditor,
    index: number,
    layout: Layout,
    depth: StyleDepth,
    severalSources: boolean,
  ): Promise<ComponentSnapshot> {
    const panel = await editor.select(index).catch(() => '');
    if (!panel) return { kind: 'other', layout, panel: 'covered component' };
    const dom = await editor.readComponentDom(index);
    const control = (Object.keys(CONTROL_LABELS) as ControlKind[]).find(
      (k) => `${CONTROL_LABELS[k]} properties`.toLowerCase() === panel.toLowerCase(),
    );
    // A selected drop-down opens its list over the panel.
    if (control) await editor.closePopup();
    const preset = control ? null : await editor.selectedPreset();
    const kindOf = (label: string) =>
      (Object.keys(CHART_PRESETS) as ChartType[]).find((t) => CHART_PRESETS[t] === label);
    const chartType = preset ? kindOf(preset) : undefined;
    const readStyle = async (skip: string[] = []) => {
      if (depth === 'none') return undefined;
      await editor.openTab('Style');
      const style = specStyle(await editor.listSettings(), depth, skip);
      await editor.openTab('Setup');
      return Object.keys(style).length ? style : undefined;
    };
    const withStyle = <T extends object>(c: T, style: StyleSettings | undefined) =>
      style ? { ...c, style } : c;

    if (chartType) {
      const chips = await editor.readSetupChips(SPEC_DETAILED_SECTIONS);
      const setup = await editor.listSettings();
      await editor.openTab('Style');
      const styleList = await editor.listSettings();
      const style = depth === 'none' ? {} : specStyle(styleList, depth, ['Title']);
      const named = (f: { name: string; source?: string }) => f.source ?? f.name;
      const inSection = (re: RegExp) => chips.filter((c) => re.test(c.section));
      const dimensions = inSection(SECTION.dimensions).flatMap((c) => c.fields.map(named));
      const metrics: MetricSpec[] = inSection(SECTION.metrics).flatMap((c) =>
        c.fields.map((f) => {
          const aggregation = (Object.keys(AGGREGATION_LABEL) as Aggregation[]).find(
            (a) => AGGREGATION_LABEL[a] === f.aggregation,
          );
          return {
            field: named(f),
            ...(aggregation ? { aggregation } : {}),
            ...(f.source && f.source !== f.name ? { label: f.name } : {}),
          };
        }),
      );
      const breakdown = inSection(SECTION.breakdown)[0]?.fields[0];
      const sortChip = inSection(SECTION.sort)[0]?.fields[0]?.name;
      const sortBy = metrics.find((m) => m.label === sortChip)?.field ?? sortChip;
      const ascending = setup.find((s) => s.kind === 'radio' && s.label === 'Ascending');
      const sortAscending = ascending?.value === 'selected';
      const fields = Object.fromEntries(
        chips
          .filter((c) => !SPEC_SKIPPED_SECTIONS.test(c.section))
          .map((c) => [c.section, c.fields.map(named)]),
      );
      const showTitle = styleList.find((s) => s.label === 'Show title')?.value === 'on';
      const title = showTitle ? styleList.find((s) => s.label === 'Title')?.value : undefined;
      const defaultSort = !sortBy || (sortBy === metrics[0]?.field && !sortAscending);
      const dataSource = severalSources ? await editor.chartDataSource() : null;
      await editor.openTab('Setup');
      return withStyle(
        {
          kind: 'chart' as const,
          layout,
          chart: {
            type: chartType,
            dimensions,
            metrics,
            ...(breakdown ? { breakdown: named(breakdown) } : {}),
            ...(defaultSort ? {} : { sortBy, sortAscending }),
            ...(Object.keys(fields).length ? { fields } : {}),
            ...(title ? { title } : {}),
          },
          ...(dataSource ? { dataSource } : {}),
        },
        Object.keys(style).length ? style : undefined,
      );
    }
    if (control) {
      const chips = await editor.readSetupChips(SPEC_DETAILED_SECTIONS);
      const first = (re: RegExp) => {
        const f = chips.find((c) => re.test(c.section))?.fields[0];
        return f ? (f.source ?? f.name) : undefined;
      };
      const field = first(SECTION.control);
      const metric = first(SECTION.metrics);
      const dataSource = severalSources ? await editor.chartDataSource() : null;
      return withStyle(
        {
          kind: 'control' as const,
          layout,
          control,
          ...(field ? { field } : {}),
          ...(metric ? { metric } : {}),
          ...(dataSource ? { dataSource } : {}),
        },
        await readStyle(),
      );
    }
    if (PANEL_KIND.text.test(panel)) {
      await editor.openTab('Style');
      const list = await editor.listSettings();
      const background = cssColorToHex(list.find((s) => s.label === 'Background')?.value ?? '');
      const color = dom.color ? cssColorToHex(dom.color) : null;
      const align = dom.align === 'center' || dom.align === 'right' ? dom.align : undefined;
      return withStyle(
        {
          kind: 'text' as const,
          layout,
          text: {
            text: dom.text,
            ...(dom.fontSize ? { fontSize: dom.fontSize } : {}),
            ...(color ? { color } : {}),
            ...(dom.bold ? { bold: true } : {}),
            ...(background ? { background } : {}),
            ...(align ? { align } : {}),
          },
        },
        await readStyle(['Background']),
      );
    }
    if (PANEL_KIND.shape.test(panel)) {
      await editor.openTab('Style');
      const list = await editor.listSettings();
      const kind = (await editor.firstSelectValue())?.toLowerCase().replace(/\s+/g, '_');
      const shape = (Object.keys(SHAPE_PATHS) as Array<keyof typeof SHAPE_PATHS>).find(
        (k) => k === kind,
      );
      const background = cssColorToHex(list.find((s) => s.label === 'Background')?.value ?? '');
      const border = cssColorToHex(list.find((s) => s.label === 'Border color')?.value ?? '');
      const radius = Number(list.find((s) => s.label === 'Border radius')?.value);
      return withStyle(
        {
          kind: 'shape' as const,
          layout,
          shape: {
            shape: shape ?? 'rectangle',
            ...(background ? { background } : {}),
            ...(border ? { borderColor: border } : {}),
            ...(Number.isFinite(radius) && radius > 0 ? { borderRadius: radius } : {}),
          },
        },
        await readStyle(['Background', 'Border color', 'Border radius']),
      );
    }
    if (PANEL_KIND.image.test(panel)) {
      const url = dom.image && /^https:/i.test(dom.image) ? dom.image : undefined;
      return withStyle(
        { kind: 'image' as const, layout, ...(url ? { url } : {}) },
        await readStyle(),
      );
    }
    if (PANEL_KIND.line.test(panel)) {
      const l = dom.line ?? { x1: 0, y1: 0, x2: layout.width, y2: layout.height };
      return {
        kind: 'line',
        layout,
        from: { x: Math.round(layout.x + l.x1), y: Math.round(layout.y + l.y1) },
        to: { x: Math.round(layout.x + l.x2), y: Math.round(layout.y + l.y2) },
      };
    }
    if (PANEL_KIND.embed.test(panel)) {
      return withStyle(
        { kind: 'embed' as const, layout, ...(dom.embed ? { url: dom.embed } : {}) },
        await readStyle(),
      );
    }
    return { kind: 'other', layout, panel: panel.replace(/ properties$/i, '') };
  }

  // ── Report operations ──

  // File › Make a copy posts a form that opens the copy in a new tab. The
  // form's xsrf field stays empty under automation and the copy fails with a
  // 400, so it gets the RAP_XSRF_TOKEN cookie. Looker Studio names the copy
  // "Copy of …" in the account language: it is renamed after. Only data
  // sources that a component uses are copied.
  async copyReport(
    reportId: string,
    name: string,
    replacements: DataSourceReplacement[],
  ): Promise<CopiedReport> {
    const timeout = this.opts.stepTimeoutMs;
    const swapped: string[] = [];
    const id = await this.opts.browser.withPage(async (page) => {
      const editor = await LookerStudioEditor.openReport(page, reportId, timeout);
      await editor.clickMenu('File', ['Make a copy...']);
      return editor.step('make a copy of the report', async () => {
        const dialog = page.locator(REPORT_OPS.legacyDialog, {
          hasText: REPORT_OPS.copyDialogTitle,
        });
        await dialog.waitFor({ timeout });
        await editor.settle(1000);
        for (const r of replacements) {
          if ('reusable' in r) swapped.push(await this.pickCopySource(editor, dialog, r));
        }
        await page.evaluate(
          ({ input, cookie }) => {
            const field = document.querySelector<HTMLInputElement>(input);
            const token = new RegExp(`(?:^|;\\s*)${cookie}=([^;]+)`).exec(document.cookie)?.[1];
            if (field && !field.value && token) field.value = decodeURIComponent(token);
          },
          { input: REPORT_OPS.copyXsrfInput, cookie: REPORT_OPS.xsrfCookie },
        );
        const opened = page.context().waitForEvent('page', { timeout });
        await dialog.getByRole('button', { name: REPORT_OPS.copyButton }).click();
        const tab = await opened;
        try {
          await tab
            .waitForURL(/\/reporting\/[0-9a-f-]{36}/i, { timeout, waitUntil: 'commit' })
            .catch(() => {
              throw new Error(`Looker Studio did not open the copy (stopped at ${tab.url()})`);
            });
          return /\/reporting\/([0-9a-f-]{36})/i.exec(tab.url())![1]!.toLowerCase();
        } finally {
          await tab.close().catch(() => undefined);
        }
      });
    });
    const replaced: string[] = [...swapped];
    try {
      await this.edit(id, async (editor) => {
        await editor.rename(name);
        for (const replacement of replacements) {
          if ('source' in replacement)
            replaced.push(await this.reconnectSource(editor, replacement));
        }
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new EditorStepError(`${reason} (the copy was created: ${reportUrl(id, 'edit')})`);
    }
    return { id, name, url: reportUrl(id), replaced };
  }

  // Embedded data sources belong to the report, so a copy can change its own.
  // A reusable one is shared: reconnecting it would change every report using it.
  private async reconnectSource(
    editor: LookerStudioEditor,
    { original, source }: Extract<DataSourceReplacement, { source: unknown }>,
  ): Promise<string> {
    const page = editor.page;
    await editor.clickMenu('Resource', ['Manage added data sources']);
    await page.locator('tr, [role=row]').nth(1).waitFor({ timeout: this.opts.stepTimeoutMs });
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('tr, [role=row]')].slice(1).map((row) => {
        const cells = [...row.querySelectorAll('td, [role=cell]')].map(
          (c) => c.textContent?.trim() ?? '',
        );
        const button = [...row.querySelectorAll('button')].find((b) =>
          /^edit$/i.test(b.textContent?.trim() ?? ''),
        );
        const r = button?.getBoundingClientRect();
        return {
          name: cells[0] ?? '',
          // The Type cell also holds an icon name; match the word.
          embedded: /\bEmbedded\b/.test((row as HTMLElement).innerText),
          point: r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null,
        };
      }),
    );
    const row = rows.find((r) => r.name === original);
    if (!row?.point) {
      throw new EditorStepError(
        `the copy has no data source "${original}" (it has ${rows.map((r) => r.name).join(', ') || 'none'}; only data sources used by a component are copied)`,
      );
    }
    if (!row.embedded) {
      throw new EditorStepError(
        `"${original}" is a reusable data source: reconnecting it would change every report that uses it (pass reusable to swap it for another reusable data source)`,
      );
    }
    await page.mouse.click(row.point.x, row.point.y);
    await editor.reconnectBigQuery(source);
    const newName = isQuerySource(source) ? source.name : source.tableId;
    await editor.step(`finish editing the data source ${original}`, async () => {
      if (newName && newName !== original) {
        const box = page.locator(SEL.dataSourceNameInput).filter({ visible: true });
        const index = await box.evaluateAll(
          (inputs, current) => inputs.findIndex((i) => (i as HTMLInputElement).value === current),
          original,
        );
        if (index >= 0) {
          await box.nth(index).fill(newName);
          await box.nth(index).press('Enter');
          await editor.settle(800);
        }
      }
      await page.getByRole('button', { name: 'Done' }).first().click();
      await editor.settle(800);
    });
    await this.closeSourcesPanel(editor);
    return `${original} → ${newName ?? original} (${describeSource(source)})`;
  }

  // The copy dialog pairs each data source of the original with a "New Data
  // Source" picker: added data sources, then the account's reusable ones.
  // The pick fills the form's datasourceMap, so the copy is born on it.
  private async pickCopySource(
    editor: LookerStudioEditor,
    dialog: Locator,
    { original, reusable }: Extract<DataSourceReplacement, { reusable: string }>,
  ): Promise<string> {
    const page = editor.page;
    return editor.step(`pick ${reusable} for ${original} in the copy dialog`, async () => {
      const rows = dialog.locator(REPORT_OPS.copySourceRow);
      const pairs = await rows.evaluateAll(
        (all, label) =>
          all.map((r) => [...r.querySelectorAll(label)].map((l) => l.textContent?.trim() ?? '')),
        REPORT_OPS.copySourceName,
      );
      const index = pairs.findIndex((p) => p[0] === original);
      if (index < 0) {
        throw new Error(
          `the copy dialog has no data source "${original}" (it lists ${pairs.map((p) => p[0]).join(', ') || 'none'}; only data sources used by a component are copied)`,
        );
      }
      await rows.nth(index).locator(REPORT_OPS.copySourcePicker).nth(1).locator('button').click();
      const overlay = page.locator('.cdk-overlay-container');
      const options = overlay.locator(REPORT_OPS.copySourceOption);
      await options.first().waitFor({ timeout: this.opts.stepTimeoutMs });
      await editor.settle(800);
      const option = options.filter({ hasText: new RegExp(`^\\s*${escapeRegExp(reusable)}\\s*$`) });
      if (!(await option.count())) {
        const offered = (await options.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
        await page.keyboard.press('Escape');
        throw new Error(
          `no data source "${reusable}" to pick (offered: ${offered.join(', ')}); make one reusable with update_data_source make_reusable`,
        );
      }
      await option.first().click();
      await editor.settle(1000);
      const shown = (
        await rows.nth(index).locator(REPORT_OPS.copySourceName).nth(1).innerText()
      ).trim();
      if (shown !== reusable) throw new Error(`the new data source shows "${shown}"`);
      return `${original} → ${reusable} (reusable)`;
    });
  }

  // Share › Link settings. A change shows Save instead of Done; Google keeps
  // the link role only for Unlisted and Public. Like invitations, Google
  // refuses the change from a headless browser ("An unknown error occurred").
  async setLinkSharing(reportId: string, sharing: LinkSharing): Promise<LinkSharing> {
    return this.edit(
      reportId,
      async (editor) => {
        const page = editor.page;
        const dialog = page.locator('mat-dialog-container');
        const labels = REPORT_OPS.linkAccessLabel;
        const accessButton = dialog
          .locator('button')
          .filter({ hasText: new RegExp(`^\\s*(${Object.values(labels).join('|')})\\s*$`) })
          .first();
        const openDialog = async () => {
          await page.getByRole('button', { name: /lets users share a report/ }).click();
          await accessButton.waitFor({ timeout: this.opts.stepTimeoutMs });
          await editor.settle(800);
        };
        const closeDialog = async () => {
          await dialog
            .getByRole('button', { name: 'Done', exact: true })
            .click({ timeout: 5_000 })
            .catch(() => page.keyboard.press('Escape'));
          await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
        };
        // The link's role button sits on the access button's row; people have their own.
        const linkRole = () =>
          dialog.evaluate((d) => {
            const access = [...d.querySelectorAll<HTMLElement>('button')].find((b) =>
              /^(Restricted|Unlisted|Public)$/.test(b.innerText.trim()),
            );
            if (!access) return null;
            const y = access.getBoundingClientRect().y + access.getBoundingClientRect().height / 2;
            const role = [...d.querySelectorAll<HTMLElement>('button')].find((b) => {
              const r = b.getBoundingClientRect();
              return (
                /^(Viewer|Editor)$/.test(b.innerText.trim()) &&
                Math.abs(r.y + r.height / 2 - y) < 30
              );
            });
            if (!role) return null;
            const r = role.getBoundingClientRect();
            return { text: role.innerText.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 };
          });
        const pick = async (label: string) => {
          const item = page
            .locator('.cdk-overlay-container [role=menuitem]')
            .filter({ hasText: new RegExp(`^\\s*${label}\\b`) })
            .first();
          if (!(await item.isVisible({ timeout: 5_000 }).catch(() => false))) {
            await page.keyboard.press('Escape');
            throw new Error(`Looker Studio does not offer "${label}" here for this account`);
          }
          if ((await item.getAttribute('aria-disabled')) === 'true' || (await item.isDisabled())) {
            await page.keyboard.press('Escape');
            throw new Error(`"${label}" link sharing is turned off for this account`);
          }
          await item.click();
          await editor.settle(600);
        };

        await editor.step(`set link sharing to ${sharing.access}`, async () => {
          await openDialog();
          const wanted = labels[sharing.access];
          if ((await accessButton.innerText()).trim() !== wanted) {
            await accessButton.click();
            await pick(wanted);
          }
          if (sharing.access !== 'restricted') {
            const wantedRole = sharing.role === 'editor' ? 'Editor' : 'Viewer';
            const role = await linkRole();
            if (!role) throw new Error('the role of the link was not found');
            if (role.text !== wantedRole) {
              await page.mouse.click(role.x, role.y);
              await pick(wantedRole);
            }
          }
          const save = dialog.getByRole('button', { name: 'Save', exact: true });
          if (await save.isVisible().catch(() => false)) {
            await save.click();
            await editor.settle(1500);
            // Saved: the dialog closes. Refused: it stays with a warning.
            if (await dialog.isVisible().catch(() => false)) {
              const refusal = (await dialog.innerText()).match(
                /[^\n]*(unknown error|try again later)[^\n]*/i,
              );
              if (refusal) throw new Error(`Google refused the change: ${refusal[0].trim()}`);
            }
          }
          await closeDialog();
        });
        // Read back what Google kept.
        return editor.step('read the link sharing', async () => {
          await openDialog();
          const label = (await accessButton.innerText()).trim();
          const access = (Object.keys(labels) as LinkSharing['access'][]).find(
            (k) => labels[k] === label,
          )!;
          const role = access === 'restricted' ? null : await linkRole();
          await closeDialog();
          return {
            access,
            ...(role
              ? { role: role.text === 'Editor' ? ('editor' as const) : ('viewer' as const) }
              : {}),
          };
        });
      },
      { visible: true },
    );
  }

  // Share › Schedule delivery opens either the report's schedule (with "Edit
  // schedule") or an empty form (with Save).
  private async openSchedule(editor: LookerStudioEditor): Promise<Locator> {
    const page = editor.page;
    await editor.step('open Share › Schedule delivery', async () => {
      await editor.walkMenu(
        () => page.getByRole('button', { name: REPORT_OPS.shareMoreOptions }).first().click(),
        [REPORT_OPS.scheduleMenuItem],
      );
    });
    const dialog = page.locator('mat-dialog-container', {
      has: page.getByText(REPORT_OPS.scheduleTitle, { exact: true }),
    });
    await editor.step('load the email schedule', async () => {
      await dialog
        .getByRole('button', { name: new RegExp(`^(${REPORT_OPS.editSchedule}|Save)$`) })
        .first()
        .waitFor({ timeout: this.opts.stepTimeoutMs });
      await editor.settle(800);
    });
    return dialog;
  }

  private async isScheduled(dialog: Locator): Promise<boolean> {
    return dialog
      .getByRole('button', { name: REPORT_OPS.editSchedule })
      .isVisible()
      .catch(() => false);
  }

  // Each row of the schedule summary is a label and its value; the
  // recipients ("To") are chips without a label element.
  private readSchedule(dialog: Locator): Promise<DeliveryInfo> {
    return dialog.evaluate((d) => {
      const info: Record<string, string> = {};
      for (const label of d.querySelectorAll<HTMLElement>('label.left')) {
        const name = label.innerText.trim();
        const row = label.parentElement;
        const value = row?.innerText.replace(name, '').replace(/\s+/g, ' ').trim() ?? '';
        if (name && value) info[name] = value;
        if (name === 'From') {
          const chips = [...d.querySelectorAll<HTMLElement>('mat-chip-listbox mat-chip')];
          const to = chips.map((c) => c.innerText.trim()).filter(Boolean);
          if (to.length) info.To = to.join(', ');
        }
      }
      return info;
    });
  }

  private async closeSchedule(editor: LookerStudioEditor, dialog: Locator): Promise<void> {
    await dialog
      .getByRole('button', { name: 'Close' })
      .click({ timeout: 5_000 })
      .catch(() => editor.page.keyboard.press('Escape'));
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
  }

  // Google refuses to save a schedule from a headless browser ("Failed", a
  // reCAPTCHA check), so this runs in a visible window. The signed-in account
  // is always a recipient: its chip cannot be removed.
  async scheduleDelivery(reportId: string, schedule: DeliverySchedule): Promise<DeliveryInfo> {
    return this.edit(
      reportId,
      async (editor) => {
        const page = editor.page;
        let dialog = await this.openSchedule(editor);
        // A schedule keeps the zone it was created in: recreate it in the new one.
        if (schedule.timeZone && (await this.isScheduled(dialog))) {
          await this.deleteSchedule(editor, dialog);
          await this.closeSchedule(editor, dialog);
          dialog = await this.openSchedule(editor);
        }
        const select = (label: string, nth = 1) =>
          dialog.locator(
            `xpath=.//label[normalize-space()="${label}"]/following::mat-select[${nth}]`,
          );
        const choose = async (control: Locator, option: RegExp, what: string) => {
          await control.click({ force: true });
          const item = page.getByRole('option', { name: option }).first();
          // After the date box the first click can go missing: open it by keyboard.
          if (
            !(await page
              .getByRole('option')
              .first()
              .isVisible({ timeout: 2_000 })
              .catch(() => false))
          ) {
            await control.focus();
            await page.keyboard.press('Space');
          }
          await item.waitFor({ timeout: 5_000 }).catch(async () => {
            const offered = await page.getByRole('option').allInnerTexts();
            await page.keyboard.press('Escape');
            throw new Error(`no ${what} option ${option} (offered: ${offered.join(', ')})`);
          });
          await item.click();
          await editor.settle(400);
        };

        await editor.step('fill the email schedule', async () => {
          if (await this.isScheduled(dialog)) {
            await dialog.getByRole('button', { name: REPORT_OPS.editSchedule }).click();
            await dialog.getByRole('button', { name: 'Save', exact: true }).waitFor();
          }
          // Start from the signed-in account alone, then add each recipient.
          const removable = dialog.locator('mat-chip-row button');
          for (let n = await removable.count(); n > 0; n--) {
            await removable.first().click();
            await editor.settle(300);
          }
          const input = dialog.getByRole('combobox', { name: REPORT_OPS.scheduleRecipients });
          for (const email of schedule.recipients) {
            await input.click();
            await page.keyboard.type(email, { delay: 15 });
            await editor.settle(500);
            await page.keyboard.press('Enter');
            await editor.settle(300);
            if (await input.inputValue())
              throw new Error(`${email} was not accepted as a recipient`);
          }
          if (schedule.pages) {
            const pages = select('Pages');
            if (!(await pages.isVisible().catch(() => false))) {
              throw new Error('pages only applies to reports with several pages');
            }
            await pages.click({ force: true });
            const options = page.getByRole('option');
            await options.first().waitFor({ timeout: 5_000 });
            const names = (await options.allInnerTexts()).map((t) => t.trim());
            const unknown = schedule.pages.filter((p) => !names.includes(p));
            if (unknown.length) {
              await page.keyboard.press('Escape');
              throw new Error(`no page ${unknown.join(', ')} (the report has ${names.join(', ')})`);
            }
            for (const [i, pageName] of names.entries()) {
              const option = options.nth(i);
              const selected = (await option.getAttribute('aria-selected')) === 'true';
              if (selected !== schedule.pages.includes(pageName)) {
                await option.click();
                await editor.settle(300);
              }
            }
            await page.keyboard.press('Escape');
            await editor.settle(400);
          }
          if (schedule.startDate) {
            const label = scheduleDateLabel(schedule.startDate);
            const date = dialog.locator(REPORT_OPS.scheduleDate);
            await date.fill(label);
            await date.press('Enter');
            // Focusing the box opens the calendar, which then swallows the
            // next click: close it through its backdrop.
            const backdrop = page.locator(REPORT_OPS.datepickerBackdrop).first();
            if (await backdrop.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await backdrop.click({ force: true });
              await backdrop.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
            }
            await editor.settle(400);
            const shown = await date.inputValue();
            if (shown !== label) throw new Error(`the start date shows "${shown}", not ${label}`);
          }
          if (schedule.repeat) {
            const option = REPEAT_OPTION[schedule.repeat];
            await choose(select('Repeat'), new RegExp(`^\\s*${option}`), 'Repeat');
            if (schedule.repeat === 'custom' && schedule.every) {
              const { interval, unit, weekdays, monthlyOn } = schedule.every;
              // The unit first: it sets the interval's maximum.
              await choose(select('Repeat', 2), scheduleEveryOption(unit, monthlyOn), 'Every');
              const every = dialog.locator(REPORT_OPS.everyAmount);
              const max = Number(await every.getAttribute('max'));
              if (max && interval > max)
                throw new Error(`a custom repeat goes up to every ${max} ${unit}s`);
              await every.fill(String(interval));
              await editor.settle(400);
              if (weekdays) await this.pickScheduleWeekdays(editor, dialog, weekdays);
            }
          }
          if (schedule.time) {
            const label = scheduleTimeLabel(schedule.time);
            await choose(select('Time'), new RegExp(`^\\s*${label}\\s*$`), 'Time');
          }
          if (schedule.timeZone) {
            const shown = (await this.readSchedule(dialog)).Timezone ?? '';
            const offset = timeZoneOffset(schedule.timeZone);
            if (!shown.startsWith(offset))
              throw new Error(
                `the schedule shows the time zone "${shown}", not one at ${offset} (${schedule.timeZone})`,
              );
          }
        });
        if (schedule.filters?.length)
          await this.setScheduleFilters(editor, dialog, schedule.filters);
        await editor.step('save the email schedule', async () => {
          await dialog.getByRole('button', { name: 'Save', exact: true }).click();
          // Google answers in a snack bar: "Report scheduled", "Schedule updated" or "Failed".
          const snack = page.locator('.mat-mdc-snack-bar-container').first();
          await snack.waitFor({ timeout: this.opts.stepTimeoutMs });
          const said = (await snack.innerText()).trim();
          if (!/scheduled|updated/i.test(said)) throw new Error(`Looker Studio answered "${said}"`);
          await dialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
        });
        const saved = await this.openSchedule(editor);
        const info = await this.readSchedule(saved);
        const filters = await this.readScheduleFilters(editor, saved);
        await this.closeSchedule(editor, saved);
        return { ...info, ...(filters.length ? { Filters: filters.join('; ') } : {}) };
      },
      { visible: true, ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {}) },
    );
  }

  async getDelivery(reportId: string): Promise<DeliveryInfo | null> {
    return this.edit(reportId, async (editor) => {
      const dialog = await this.openSchedule(editor);
      if (!(await this.isScheduled(dialog))) {
        await this.closeSchedule(editor, dialog);
        return null;
      }
      const info = await this.readSchedule(dialog);
      const filters = await this.readScheduleFilters(editor, dialog);
      await this.closeSchedule(editor, dialog);
      return { ...info, ...(filters.length ? { Filters: filters.join('; ') } : {}) };
    });
  }

  async removeDelivery(reportId: string): Promise<boolean> {
    return this.edit(
      reportId,
      async (editor) => {
        const dialog = await this.openSchedule(editor);
        if (!(await this.isScheduled(dialog))) {
          await this.closeSchedule(editor, dialog);
          return false;
        }
        await this.deleteSchedule(editor, dialog);
        return true;
      },
      { visible: true },
    );
  }

  // ── Email delivery: weekdays, filters ──

  // The schedule summary's More options › Delete schedule.
  private async deleteSchedule(editor: LookerStudioEditor, dialog: Locator): Promise<void> {
    await editor.walkMenu(
      () => dialog.getByRole('button', { name: 'More options' }).click(),
      [REPORT_OPS.deleteSchedule],
    );
    await editor.step('delete the email schedule', async () => {
      const snack = editor.page.locator('.mat-mdc-snack-bar-container').first();
      await snack.waitFor({ timeout: this.opts.stepTimeoutMs });
      const said = (await snack.innerText()).trim();
      if (!/deleted/i.test(said)) throw new Error(`Looker Studio answered "${said}"`);
    });
  }

  // "On S M T W T F S": checkboxes with the day as id. Filling the interval
  // ticks the start date's weekday, so every day is set either way.
  private async pickScheduleWeekdays(
    editor: LookerStudioEditor,
    dialog: Locator,
    weekdays: readonly string[],
  ): Promise<void> {
    const boxes = dialog.locator(REPORT_OPS.weekdayBoxes);
    if (!(await boxes.count())) throw new Error('the custom repeat shows no weekdays');
    for (const day of WEEKDAYS) {
      const box = dialog.locator(`${REPORT_OPS.weekdayBoxes}#${day}`);
      if ((await box.isChecked()) !== weekdays.includes(day)) {
        await dialog.locator(`label[for=${day}]`).click();
        await editor.settle(200);
      }
    }
    const on = await boxes.evaluateAll((all) =>
      all.filter((b) => (b as HTMLInputElement).checked).map((b) => b.id),
    );
    if (on.join() !== WEEKDAYS.filter((d) => weekdays.includes(d)).join())
      throw new Error(`the custom repeat is on ${on.join(', ') || 'no day'}`);
  }

  // The Filters tab draws the filter controls of each page (one expansion
  // panel per page) as live controls: the email applies what they hold.
  private async openScheduleFilters(editor: LookerStudioEditor, dialog: Locator): Promise<boolean> {
    const tab = dialog.getByRole('tab', { name: REPORT_OPS.filtersTab });
    if (!(await tab.count())) return false;
    await tab.click();
    await dialog
      .locator(REPORT_OPS.filtersLoaded)
      .waitFor({ timeout: this.opts.stepTimeoutMs })
      .catch(() => undefined);
    await editor.settle(1500);
    // Collapsed pages keep their controls out of the DOM.
    const headers = dialog.locator(
      `${REPORT_OPS.filterPanel}:not(.mat-expanded) mat-expansion-panel-header`,
    );
    for (let n = await headers.count(); n > 0; n--) {
      await headers.first().click();
      await editor.settle(500);
    }
    return true;
  }

  private scheduleControls(dialog: Locator): Promise<DeliveryControl[]> {
    return dialog.evaluate((d, sel) => {
      const out: DeliveryControl[] = [];
      for (const panel of d.querySelectorAll(sel.filterPanel)) {
        const page = panel.querySelector('mat-panel-title')?.textContent?.trim() ?? '';
        for (const comp of panel.querySelectorAll<HTMLElement>(sel.filterControl)) {
          const text = comp.innerText
            .replace(/arrow_drop_down|▼/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          const input = comp.querySelector<HTMLInputElement>('input');
          const kind = comp.matches(sel.dateControl)
            ? 'date'
            : input
              ? 'input'
              : comp.querySelector(sel.listButton)
                ? 'list'
                : 'other';
          // "feature", "feature: a, b (2)", "platform (Equals)".
          const field = kind === 'date' ? '' : (text.split(/:| \(/)[0] ?? '').trim();
          out.push({ page, field, kind, text, ...(input ? { value: input.value } : {}) });
        }
      }
      return out;
    }, REPORT_OPS);
  }

  private async setScheduleFilters(
    editor: LookerStudioEditor,
    dialog: Locator,
    filters: DeliveryFilter[],
  ): Promise<void> {
    const page = editor.page;
    await editor.step('open the Filters tab of the email schedule', async () => {
      if (!(await this.openScheduleFilters(editor, dialog)))
        throw new Error('the schedule has no Filters tab: the report has no filter controls');
    });
    for (const filter of filters) {
      const what = filter.dateRange !== undefined ? 'the date range' : filter.field!;
      await editor.step(`set the email filter on ${what}`, async () => {
        const controls = await this.scheduleControls(dialog);
        const target = pickDeliveryControl(controls, filter);
        const comp = dialog
          .locator(REPORT_OPS.filterPanel)
          .filter({
            has: page.locator('mat-panel-title', {
              hasText: new RegExp(`^\\s*${escapeRegExp(target.page)}\\s*$`),
            }),
          })
          .first()
          .locator(REPORT_OPS.filterControl)
          .nth(target.position);
        if (target.control.kind === 'date') {
          await comp.click();
          await editor.pickDateRange(filter.dateRange!);
        } else if (target.control.kind === 'input') {
          const values = filter.values!;
          if (values.length > 1) throw new Error(`${what} is an input box: it takes one value`);
          const input = comp.locator('input');
          await input.click();
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.press('Backspace');
          if (values[0]) await page.keyboard.type(values[0], { delay: 15 });
          await page.keyboard.press('Enter');
          await editor.settle(800);
        } else if (target.control.kind === 'list') {
          await comp.locator(REPORT_OPS.listButton).click();
          const multi = await this.pickListValues(editor, filter.values!, what);
          const shown = (await comp.innerText()).replace(/\s+/g, ' ');
          // A single-select control holding its only value filters nothing: Looker drops it.
          if (!multi && !shown.includes(filter.values![0]!))
            throw new Error(
              `Looker Studio did not keep "${filter.values![0]}" (the control shows "${shown.replace(/▼/g, '').trim()}"; a value that is the only one of the field filters nothing)`,
            );
        } else {
          throw new Error(`the ${target.page} control "${target.control.text}" cannot be set here`);
        }
      });
    }
  }

  // A drop-down or list control's menu: a "Select all" header box (multiple
  // selection only), a search box and the values (virtual-scrolled).
  private async pickListValues(
    editor: LookerStudioEditor,
    values: string[],
    what: string,
  ): Promise<boolean> {
    const page = editor.page;
    const list = page.locator(REPORT_OPS.listMenu).filter({ visible: true }).last();
    await list.waitFor({ timeout: this.opts.stepTimeoutMs });
    await editor.settle(800);
    const search = list.locator(REPORT_OPS.listSearch);
    const header = list.locator(REPORT_OPS.listSelectAll);
    const multi = (await header.count()) > 0;
    const offered = async () => {
      if (await search.count()) await search.fill('');
      await editor.settle(600);
      return list.evaluate(
        (l, sel) =>
          [...l.querySelectorAll<HTMLElement>(sel)].map((e) => e.title || e.innerText.trim()),
        `${REPORT_OPS.listItemMulti} ${REPORT_OPS.listValueMulti}[title], ${REPORT_OPS.listItemSingle} ${REPORT_OPS.listValueSingle}`,
      );
    };
    const find = async (value: string) => {
      if (await search.count()) {
        await search.fill(value);
        await editor.settle(800);
      }
      const item = list
        .locator(multi ? REPORT_OPS.listItemMulti : REPORT_OPS.listItemSingle)
        .filter({
          has: page.locator(
            `${multi ? REPORT_OPS.listValueMulti : REPORT_OPS.listValueSingle}[title="${cssEscape(value)}"]`,
          ),
        })
        .first();
      if (!(await item.count())) {
        const known = await offered();
        await this.closeListMenu(editor);
        throw new Error(`${what} has no value "${value}" (offered: ${known.join(', ')})`);
      }
      return item;
    };
    if (!multi) {
      if (values.length !== 1) {
        await this.closeListMenu(editor);
        throw new Error(`${what} is a single-select control: pass exactly one value`);
      }
      await (await find(values[0]!)).click();
      await editor.settle(800);
    } else {
      // Select all, then (unless all values are wanted) clear and tick each.
      for (let round = 0; round < 3; round++) {
        if ((await header.getAttribute('aria-checked')) === 'true') break;
        await header.click();
        await editor.settle(500);
      }
      if (values.length) {
        await header.click();
        await editor.settle(500);
        for (const value of values) {
          const box = (await find(value)).locator('md-checkbox');
          if ((await box.getAttribute('aria-checked')) !== 'true') await box.click();
          await editor.settle(400);
        }
        if (await search.count()) await search.fill('');
        await editor.settle(500);
      }
    }
    await this.closeListMenu(editor);
    return multi;
  }

  // The menu closes through a click on its backdrop, away from the menu that
  // covers the backdrop's middle; Escape would close the whole schedule dialog.
  private async closeListMenu(editor: LookerStudioEditor): Promise<void> {
    const page = editor.page;
    const list = page.locator(REPORT_OPS.listMenu).filter({ visible: true });
    for (const backdrop of REPORT_OPS.listBackdrops) {
      if (!(await list.count())) return;
      const point = await page.evaluate((sel) => {
        for (const b of document.querySelectorAll<HTMLElement>(sel)) {
          const r = b.getBoundingClientRect();
          for (const [x, y] of [
            [r.x + 6, r.y + 6],
            [r.right - 6, r.y + 6],
            [r.x + 6, r.bottom - 6],
          ] as const) {
            if (document.elementFromPoint(x, y) === b) return { x, y };
          }
        }
        return null;
      }, backdrop);
      if (point) {
        await page.mouse.click(point.x, point.y);
        await editor.settle(600);
      }
    }
    if (await list.count()) throw new Error('the control menu did not close');
  }

  // Edit schedule › Filters, read every control, then Cancel back to the
  // summary. Date range controls show dates: their picker names the preset.
  private async readScheduleFilters(
    editor: LookerStudioEditor,
    dialog: Locator,
  ): Promise<string[]> {
    const page = editor.page;
    return editor.step('read the email filters', async () => {
      await dialog.getByRole('button', { name: REPORT_OPS.editSchedule }).click();
      await dialog.getByRole('button', { name: 'Save', exact: true }).waitFor();
      const lines: string[] = [];
      if (await this.openScheduleFilters(editor, dialog)) {
        const controls = await this.scheduleControls(dialog);
        const position = new Map<string, number>();
        for (const c of controls) {
          const nth = position.get(c.page) ?? 0;
          position.set(c.page, nth + 1);
          let text = c.kind === 'input' ? `${c.text} = ${c.value || '(empty)'}` : c.text;
          if (c.kind === 'date') {
            await dialog
              .locator(REPORT_OPS.filterPanel)
              .filter({
                has: page.locator('mat-panel-title', {
                  hasText: new RegExp(`^\\s*${escapeRegExp(c.page)}\\s*$`),
                }),
              })
              .first()
              .locator(REPORT_OPS.filterControl)
              .nth(nth)
              .click();
            await editor.settle(800);
            const preset = await page.evaluate(() => {
              const apply = [
                ...document.querySelectorAll<HTMLElement>('.cdk-overlay-container button'),
              ]
                .filter((b) => b.offsetParent !== null && b.textContent?.trim() === 'Apply')
                .pop();
              for (let box = apply?.parentElement; box; box = box.parentElement) {
                const menu = [...box.querySelectorAll<HTMLElement>('button')].find((b) =>
                  b.textContent?.includes('arrow_drop_down'),
                );
                if (menu) return menu.innerText.replace('arrow_drop_down', '').trim();
              }
              return '';
            });
            // The dialog has its own Cancel: close the picker by the one in it.
            await page
              .locator(REPORT_OPS.datePopup)
              .getByRole('button', { name: 'Cancel', exact: true })
              .last()
              .click();
            await editor.settle(500);
            text = preset ? `date range ${preset} (${c.text})` : `date range ${c.text}`;
          }
          lines.push(`${c.page} › ${text}`);
        }
      }
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog
        .getByRole('button', { name: REPORT_OPS.editSchedule })
        .waitFor({ timeout: this.opts.stepTimeoutMs });
      return lines;
    });
  }

  private async openVersionHistory(editor: LookerStudioEditor): Promise<void> {
    await editor.clickMenu('File', ['Version history', 'See version history']);
    await editor.step('open the version history', async () => {
      await editor.page
        .locator(REPORT_OPS.versionItem)
        .first()
        .waitFor({ timeout: this.opts.stepTimeoutMs });
      await editor.settle(1000);
    });
  }

  // The version list is virtual-scrolled: read what is drawn, scroll a
  // screen down, and join the batches where they overlap. With `click`, the
  // row at that 1-based index is clicked once it is drawn.
  private async scanVersions(editor: LookerStudioEditor, click?: number): Promise<ReportVersion[]> {
    const page = editor.page;
    const versions: ReportVersion[] = [];
    const key = (v: { label: string; authors: string[] }) => `${v.label}|${v.authors.join(',')}`;
    await page.evaluate(
      (sel) => document.querySelector(sel)?.scrollTo(0, 0),
      REPORT_OPS.versionViewport,
    );
    for (let round = 0; round < 200; round++) {
      await editor.settle(300);
      const batch = await page.evaluate(
        (sel) => {
          return [...document.querySelectorAll<HTMLElement>(sel.item)].map((row) => {
            const name = row.querySelector<HTMLInputElement | HTMLElement>(sel.name);
            const label =
              name instanceof HTMLInputElement ? name.value : (name?.textContent?.trim() ?? '');
            const current = !!row.querySelector(sel.current);
            const authors = [...row.querySelectorAll(sel.authors)]
              .filter((a) => !a.matches(sel.current))
              .map((a) => a.textContent?.trim() ?? '')
              .filter(Boolean);
            // Click below the name box: a click on the box starts renaming.
            const r = row.getBoundingClientRect();
            return { label, current, authors, x: r.x + r.width / 2, y: r.y + r.height - 12 };
          });
        },
        {
          item: REPORT_OPS.versionItem,
          name: REPORT_OPS.versionName,
          authors: REPORT_OPS.versionAuthors,
          current: REPORT_OPS.currentVersion,
        },
      );
      let overlap = Math.min(versions.length, batch.length);
      while (
        overlap > 0 &&
        !batch
          .slice(0, overlap)
          .every((b, i) => key(b) === key(versions[versions.length - overlap + i]!))
      ) {
        overlap--;
      }
      for (const row of batch.slice(overlap)) {
        const version = {
          index: versions.length + 1,
          label: row.label,
          current: row.current,
          authors: row.authors,
        };
        versions.push(version);
        if (click === version.index) {
          await page.mouse.click(row.x, row.y);
          await editor.settle(1500);
          return versions;
        }
      }
      const moved = await page.evaluate((sel) => {
        const viewport = document.querySelector<HTMLElement>(sel);
        if (!viewport) return false;
        const before = viewport.scrollTop;
        viewport.scrollBy(0, viewport.clientHeight * 0.8);
        return viewport.scrollTop > before;
      }, REPORT_OPS.versionViewport);
      if (!moved) break;
    }
    if (click) throw new EditorStepError(`the report has no version ${click}`);
    return versions;
  }

  async listVersions(reportId: string): Promise<ReportVersion[]> {
    return this.edit(reportId, async (editor) => {
      await this.openVersionHistory(editor);
      return this.scanVersions(editor);
    });
  }

  async restoreVersion(reportId: string, wanted: number | string): Promise<ReportVersion> {
    return this.edit(reportId, async (editor) => {
      const page = editor.page;
      await this.openVersionHistory(editor);
      const versions = await this.scanVersions(editor);
      const version = findVersion(versions, wanted);
      if (!version) {
        throw new EditorStepError(
          `no version ${JSON.stringify(wanted)} (the report has ${versions.length}; see list_versions)`,
        );
      }
      if (version.current) throw new EditorStepError(`version ${version.index} is the current one`);
      await this.scanVersions(editor, version.index);
      await editor.step(`restore the version of ${version.label}`, async () => {
        await page.getByRole('button', { name: REPORT_OPS.restoreButton }).click();
        const confirm = page.locator('mat-dialog-container', { hasText: 'Restore this version?' });
        await confirm.waitFor({ timeout: this.opts.stepTimeoutMs });
        await confirm.getByRole('button', { name: 'Restore', exact: true }).click();
        await confirm.waitFor({ state: 'hidden', timeout: this.opts.stepTimeoutMs });
        await editor.settle(2000);
      });
      return version;
    });
  }

  // File › Embed report. The iframe shows the page that is open, so go there first.
  async getEmbed(reportId: string, opts: EmbedOptions): Promise<EmbedInfo> {
    return this.edit(reportId, async (editor) => {
      const page = editor.page;
      await this.goToPage(editor, opts.page);
      await editor.clickMenu('File', ['Embed report']);
      return editor.step('read the embed code', async () => {
        const dialog = page.locator(REPORT_OPS.embedDialog);
        await dialog.waitFor({ timeout: this.opts.stepTimeoutMs });
        const checked = (box: Locator) =>
          box.getAttribute('aria-checked').then((v) => v === 'true');
        const enable = dialog.getByRole('checkbox', { name: REPORT_OPS.embedEnable });
        const wasOn = await checked(enable);
        if (!wasOn) await enable.click();
        const code = dialog.locator('textarea');
        await code.waitFor({ timeout: this.opts.stepTimeoutMs });
        if (opts.showNavigation !== undefined) {
          const nav = dialog.getByRole('checkbox', { name: REPORT_OPS.embedNavigation });
          if ((await checked(nav)) !== opts.showNavigation) await nav.click();
        }
        const size = dialog.locator('input[type=number]');
        for (const [i, value] of [opts.width, opts.height].entries()) {
          if (value === undefined) continue;
          await size.nth(i).fill(String(value));
          await size.nth(i).press('Tab');
        }
        await editor.settle(600);
        const html = (await code.inputValue()).trim();
        const url = /src="([^"]+)"/.exec(html)?.[1];
        if (!url) throw new Error('the embed code has no URL');
        await dialog.getByRole('button', { name: /^done$/i }).click();
        await editor.settle(800);
        return { code: html, url, enabled: !wasOn };
      });
    });
  }
}

// The Style settings a spec keeps: the main card settings, or every toggle and
// box (a repeated label is numbered "Label#2" as applySettings reads it).
function specStyle(list: SettingInfo[], depth: StyleDepth, skip: string[]): StyleSettings {
  const out: StyleSettings = {};
  const seen = new Map<string, number>();
  for (const s of list) {
    if (s.kind === 'radio') continue;
    const n = (seen.get(s.label) ?? 0) + 1;
    seen.set(s.label, n);
    if (skip.includes(s.label)) continue;
    if (depth === 'main' && (n > 1 || !MAIN_STYLE.includes(s.label))) continue;
    const key = n > 1 ? `${s.label}#${n}` : s.label;
    const value = s.kind === 'toggle' ? s.value === 'on' : s.value;
    if (depth === 'main' && MAIN_STYLE_NEUTRAL[s.label] === value) continue;
    if (s.kind === 'toggle') out[key] = s.value === 'on';
    else if (/^(rgb|#)/i.test(s.value)) {
      const hex = cssColorToHex(s.value);
      if (hex) out[key] = hex;
    } else if (s.value && s.value !== 'transparent') out[key] = s.value;
  }
  return out;
}
