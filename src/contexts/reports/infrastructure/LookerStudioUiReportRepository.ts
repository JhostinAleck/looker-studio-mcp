import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Locator, Page } from 'playwright';

import type { BrowserSession } from '@/contexts/authentication/domain/BrowserSession.js';
import type {
  ComponentChange,
  OrderMove,
  PlaceOptions,
  ReportPage,
  ReportRepository,
  ShapeSpec,
  TextSpec,
  ThemeSpec,
} from '@/contexts/reports/domain/ReportRepository.js';
import {
  type Aggregation,
  type BigQuerySource,
  type ChartSpec,
  type ComponentDetails,
  type ComponentInfo,
  type Layout,
  type ReportSummary,
  type StyleSettings,
  reportUrl,
} from '@/contexts/reports/domain/Report.js';
import type { Logger } from '@/shared-kernel/logging/Logger.js';

import { EditorStepError, LookerStudioEditor } from './ui/LookerStudioEditor.js';
import {
  BASE,
  CHART_PRESETS,
  HL,
  PANEL_TITLE_HINT,
  SECTION,
  SEL,
  SHAPE_ICONS,
  cssEscape,
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

const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  scorecard: { width: 220, height: 120 },
  text: { width: 400, height: 50 },
};

// Looker Studio has no API to edit reports, so this adapter drives the editor
// in the signed-in Chrome profile, one action per page visit.
export class LookerStudioUiReportRepository implements ReportRepository {
  constructor(private readonly opts: LookerStudioUiOptions) {}

  private edit<T>(reportId: string, work: (editor: LookerStudioEditor) => Promise<T>): Promise<T> {
    return this.opts.browser.withPage(async (page) => {
      const editor = await LookerStudioEditor.openReport(page, reportId, this.opts.stepTimeoutMs);
      const result = await work(editor);
      // Lets autosave finish before the tab closes.
      await editor.settle(1500);
      return result;
    });
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
      const openList = async () => {
        await editor.clickMenu('Resource', ['Manage added data sources']);
        await page.locator('tr, [role=row]').nth(1).waitFor({ timeout: this.opts.stepTimeoutMs });
      };
      await openList();
      const sources = await page.evaluate(() =>
        [...document.querySelectorAll('tr, [role=row]')]
          .slice(1)
          .map((r) => r.querySelector('td, [role=cell]')?.textContent?.trim() ?? '')
          .filter(Boolean),
      );
      const targets = name ? sources.filter((s) => s === name) : sources;
      if (targets.length === 0) {
        throw new EditorStepError(
          `no data source named "${name}" (the report has ${sources.join(', ') || 'none'})`,
        );
      }
      const added: string[] = [];
      for (const [i, source] of targets.entries()) {
        if (i > 0) await openList();
        await editor.step(`refresh the fields of ${source}`, async () => {
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
          const refresh = page.getByRole('button', { name: 'REFRESH FIELDS' });
          await refresh.waitFor({ timeout: this.opts.stepTimeoutMs });
          await refresh.click();
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
      final = await editor.applyLayout(index, layout);
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
    if (chart.type === 'time_series' || chart.dimensions.length > 0) {
      await editor.setSectionFields(SECTION.dimensions, chart.dimensions, 'the dimensions');
    }
    await editor.setSectionFields(
      SECTION.metrics,
      chart.metrics.map((m) => m.field),
      'the metrics',
    );
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
    if (chart.sortBy) {
      await editor.setSectionFields(SECTION.sort, [chart.sortBy], 'the sort field');
      warnings.push(
        ...(await editor.applySettings({
          [chart.sortAscending ? 'Ascending' : 'Descending']: true,
        })),
      );
    }

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
      const icon = SHAPE_ICONS[shape.shape];
      const index = await editor.placeAt(spot.x, spot.y, () =>
        editor.clickMenu('Insert', ['Shapes', `icon:${icon}`]),
      );
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
      if (change.reportLevel !== undefined) {
        await editor.clickMenu('Arrange', [
          change.reportLevel ? 'Make report-level' : 'Make page-level',
        ]);
      }
      if (change.order) {
        const before = await editor.layouts();
        await editor.clickMenu('Arrange', ['Order', ORDER_LABEL[change.order]]);
        // Restacking reorders the components: find this one again by its box.
        const box = before[index]!;
        const after = await editor.layouts();
        index = after.findIndex(
          (l) => l.x === box.x && l.y === box.y && l.width === box.width && l.height === box.height,
        );
        if (index < 0)
          throw new EditorStepError(
            'the component moved while restacking it; list the components again.',
          );
        await editor.select(index);
      }
      for (const [from, to] of Object.entries(change.labels ?? {})) {
        await editor.relabelField(from, to);
      }
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
      if (theme.canvas) {
        await editor.page
          .getByRole('button', { name: 'Theme and layout' })
          .click()
          .catch(() => undefined);
        const layoutScope = await this.scopeFor(editor, 'Theme and Layout', 'layout');
        await editor.page.locator(layoutScope).getByText('Layout', { exact: true }).first().click();
        await editor.settle(500);
        const sizes: StyleSettings = {
          ...(theme.canvas.width ? { 'Width (px)': theme.canvas.width } : {}),
          ...(theme.canvas.height ? { 'Height (px)': theme.canvas.height } : {}),
        };
        const missing = await editor.applySettings(sizes, layoutScope);
        if (missing.length)
          throw new EditorStepError(`could not set the canvas size (${missing.join(', ')})`);
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
      if (!(await this.openPagesPanel(editor)))
        throw new Error('the Manage pages panel did not open');
      await editor.page
        .locator(SEL.pageChip)
        .nth(current - 1)
        .dblclick();
      const input = editor.page
        .getByPlaceholder('Enter new name')
        .or(editor.page.getByLabel('Enter new name'));
      await input.first().fill(name);
      await input.first().press('Enter');
      await editor.settle(500);
      await editor.page.keyboard.press('Escape');
    });
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

  async shareReport(reportId: string, email: string, role: 'viewer' | 'editor'): Promise<void> {
    await this.edit(reportId, async (editor) => {
      await editor.step(`share with ${email}`, async () => {
        await editor.page.getByRole('button', { name: /lets users share a report/ }).click();
        const dialog = editor.page.locator('mat-dialog-container');
        const input = dialog.locator('input').first();
        await input.waitFor({ timeout: this.opts.stepTimeoutMs });
        await input.fill(email);
        await editor.page.waitForTimeout(800);
        await input.press('Enter');
        if (role === 'editor') {
          await dialog.getByRole('button', { name: 'Viewer', exact: true }).click();
          await editor.page
            .getByRole('menuitem', { name: 'Editor' })
            .or(editor.page.getByRole('option', { name: 'Editor' }))
            .first()
            .click();
        }
        await dialog.getByRole('button', { name: 'Send', exact: true }).click();
        await dialog
          .waitFor({ state: 'hidden', timeout: this.opts.stepTimeoutMs })
          .catch(async () => {
            await dialog.getByRole('button', { name: 'Done', exact: true }).click();
          });
      });
    });
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
