import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Locator, Page } from 'playwright';

import type { BrowserSession } from '@/contexts/authentication/domain/BrowserSession.js';
import type {
  ArrangeAction,
  BinFieldSpec,
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
  type Aggregation,
  type BigQuerySource,
  type ChartSpec,
  type ChartType,
  type ComponentDetails,
  type ComponentInfo,
  type ControlSpec,
  type DataSettings,
  type FilterClause,
  type FilterSpec,
  type Layout,
  type ReportSummary,
  type StyleSettings,
  filterClauses,
  reportUrl,
} from '@/contexts/reports/domain/Report.js';
import type { Logger } from '@/shared-kernel/logging/Logger.js';

import { EditorStepError, LookerStudioEditor } from './ui/LookerStudioEditor.js';
import {
  ARRANGE_PATHS,
  BASE,
  CHART_PRESETS,
  CONTROL_LABELS,
  FILTER_CONDITIONS,
  HL,
  PAGE_MENU,
  PANEL_TITLE_HINT,
  PRESET_ORDER,
  SECTION,
  SEL,
  SHAPE_PATHS,
  cssEscape,
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

// Looker Studio has no API to edit reports, so this adapter drives the editor
// in the signed-in Chrome profile, one action per page visit.
export class LookerStudioUiReportRepository implements ReportRepository {
  constructor(private readonly opts: LookerStudioUiOptions) {}

  private edit<T>(
    reportId: string,
    work: (editor: LookerStudioEditor) => Promise<T>,
    opts: { visible?: boolean } = {},
  ): Promise<T> {
    return this.opts.browser.withPage(async (page) => {
      const editor = await LookerStudioEditor.openReport(page, reportId, this.opts.stepTimeoutMs);
      // Pointer work only reaches what is on screen: make the whole page fit.
      const restore = await this.fitWindowTo(page, page.locator(SEL.canvas).first());
      try {
        const result = await work(editor);
        // Lets autosave finish before the tab closes.
        await editor.settle(1500);
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
    }, opts);
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

  async createReport(name: string, source: BigQuerySource): Promise<ReportSummary> {
    return this.opts.browser.withPage(async (page) => {
      const editor = await LookerStudioEditor.openNew(page, this.opts.stepTimeoutMs);
      await editor.connectBigQuery(source);
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
      await page.locator('tr, [role=row]').nth(1).waitFor({ timeout: this.opts.stepTimeoutMs });
      const sources = await this.listedSources(editor);
      await page.keyboard.press('Escape');
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
          await page
            .getByRole('button', { name: 'Done' })
            .first()
            .click({ timeout: this.opts.stepTimeoutMs });
          await editor.settle(800);
        });
      }
      await page.keyboard.press('Escape');
      return added;
    });
  }

  async addDataSource(reportId: string, source: BigQuerySource): Promise<void> {
    await this.edit(reportId, async (editor) => {
      await editor.page.getByRole('button', { name: 'Add data', exact: true }).first().click();
      await editor.connectBigQuery(source);
    });
  }

  private async goToPage(editor: LookerStudioEditor, page?: number): Promise<void> {
    if (!page || page <= 1) return;
    await editor.clickMenu('Page', ['First page']);
    for (let i = 1; i < page; i++) {
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
        await editor.select(index).catch(() => undefined);
        await editor.page.keyboard.press('Delete').catch(() => undefined);
        await editor.settle().catch(() => undefined);
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
        await editor.select(index).catch(() => undefined);
        await editor.page.keyboard.press('Delete').catch(() => undefined);
        await editor.settle().catch(() => undefined);
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
    await page.locator('tr, [role=row]').nth(1).waitFor({ timeout: this.opts.stepTimeoutMs });
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
      const before = (await editor.layouts()).length;
      await editor.select(index);
      await editor.page.keyboard.press('Delete');
      await editor.settle();
      if ((await editor.layouts()).length !== before - 1) {
        throw new EditorStepError(`component ${index} was not deleted`);
      }
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
      await tab.waitForTimeout(2000);
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

  async screenshot(reportId: string, page?: number): Promise<string> {
    return this.opts.browser.withPage(async (tab) => {
      const editor = await LookerStudioEditor.openReport(tab, reportId, this.opts.stepTimeoutMs);
      await this.goToPage(editor, page);
      const viewUrl = tab.url().replace(/\/edit(\?|$)/, '$1');
      await tab.goto(
        viewUrl.includes('hl=') ? viewUrl : `${viewUrl}${viewUrl.includes('?') ? '&' : '?'}${HL}`,
        { waitUntil: 'domcontentloaded' },
      );
      await tab.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
      // Charts render after their queries return.
      await tab.waitForTimeout(3000);
      mkdirSync(this.opts.screenshotsDir, { recursive: true });
      const file = join(this.opts.screenshotsDir, `${reportId}-p${page ?? 1}-${Date.now()}.png`);
      const canvas = tab.locator(SEL.canvas).first();
      if (!(await canvas.count())) {
        await tab.screenshot({ path: file, fullPage: true });
        return file;
      }
      // The viewer scrolls inside its own container, so a page taller than the
      // window gets clipped: grow the window to fit the whole page first.
      const restore = await this.fitWindowTo(tab, canvas);
      try {
        await canvas.screenshot({ path: file });
      } finally {
        await restore();
      }
      return file;
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
}
