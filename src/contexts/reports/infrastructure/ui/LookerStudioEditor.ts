import type { Locator, Page } from 'playwright';

import type {
  BigQuerySource,
  ButtonSpec,
  ConditionalFormat,
  FilterClause,
  Layout,
  ReferenceBand,
  ReferenceLine,
  SettingInfo,
  StyleSettings,
} from '@/contexts/reports/domain/Report.js';
import { FIXED_RANGE_RE, HEX_COLOR_RE } from '@/contexts/reports/domain/Report.js';

type FilterClauseInput = FilterClause;
import { InfrastructureError } from '@/shared-kernel/errors/InfrastructureError.js';

import { BASE, HL, SECTION, SEL, cssEscape, datePresetPath, escapeRegExp } from './selectors.js';

export class EditorStepError extends InfrastructureError {
  readonly code = 'LOOKER_STUDIO_EDITOR';
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasGeometry {
  // Screen position of the canvas' top-left corner.
  originX: number;
  originY: number;
  // Screen pixels per report pixel.
  scale: number;
  width: number;
  height: number;
}

// One row of the Setup panel: a chip with a field, or an "Add …" drop target,
// under the section label it belongs to ("Dimension", "Metric", "Sort"…).
interface SetupSlot {
  section: string;
  kind: 'chip' | 'add';
  field: string | null;
  rect: Rect;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseLayout(style: string): Layout {
  const read = (prop: string): number => {
    const match = new RegExp(`(?:^|;)\\s*${prop}:\\s*(-?[\\d.]+)px`).exec(style);
    return match ? Math.round(Number(match[1])) : 0;
  };
  return { x: read('left'), y: read('top'), width: read('width'), height: read('height') };
}

// Drives the Looker Studio report editor. Every step waits for the element it
// needs and fails with a message that says which step broke.
export class LookerStudioEditor {
  constructor(
    readonly page: Page,
    private readonly timeoutMs: number,
  ) {}

  // ── Navigation ──────────────────────────────────────────────────────────

  static async openReport(
    page: Page,
    reportId: string,
    timeoutMs: number,
  ): Promise<LookerStudioEditor> {
    const editor = new LookerStudioEditor(page, timeoutMs);
    await page.goto(`${BASE}/reporting/${reportId}/edit?${HL}`, { waitUntil: 'domcontentloaded' });
    await editor.waitForEditor();
    return editor;
  }

  static async openNew(page: Page, timeoutMs: number): Promise<LookerStudioEditor> {
    const editor = new LookerStudioEditor(page, timeoutMs);
    await page.goto(`${BASE}/reporting/create?${HL}`, { waitUntil: 'domcontentloaded' });
    return editor;
  }

  async waitForEditor(): Promise<void> {
    await this.step('open the report editor', async () => {
      if (new URL(this.page.url()).hostname === 'accounts.google.com') {
        throw new Error('the browser profile is signed out; run `looker-studio-mcp login`');
      }
      await this.page
        .getByRole('button', { name: 'Add a chart' })
        .waitFor({ timeout: this.timeoutMs });
      await this.page.locator(SEL.canvas).first().waitFor({ timeout: this.timeoutMs });
    });
    await this.settle();
  }

  reportIdFromUrl(): string | null {
    return /\/reporting\/([0-9a-f-]{36})/i.exec(this.page.url())?.[1] ?? null;
  }

  // Waits for the editor to finish the network work of the last action (autosave included).
  async settle(ms = 800): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await sleep(ms);
  }

  async step<T>(what: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      // Playwright puts the locator it was waiting for on a later line; keep it,
      // it is what tells which element of the editor changed.
      const lines = err instanceof Error ? err.message.split('\n') : [String(err)];
      const waiting = lines
        .find((l) => /waiting for /.test(l))
        ?.replace(/^.*waiting for /, '')
        .trim();
      const reason = waiting ? `${lines[0]} (waiting for ${waiting})` : lines[0];
      throw new EditorStepError(`Looker Studio editor could not ${what}: ${reason}`);
    }
  }

  // Menus are Angular Material: click the menu, then the item whose text starts with `item`.
  async clickMenu(menu: string, path: string[]): Promise<void> {
    await this.step(`open ${menu} › ${path.join(' › ')}`, () =>
      this.walkMenu(
        () => this.page.getByRole('button', { name: menu, exact: true }).first().click(),
        path,
      ),
    );
    await this.settle(400);
  }

  // Opens a menu through any trigger (`open`) and clicks the item at the end of `path`.
  async walkMenu(open: () => Promise<void>, path: string[]): Promise<void> {
    await this.walkOpenMenu(open, path).catch(async (err: unknown) => {
      // A menu left open swallows every later click: close it before failing.
      for (let i = 0; i <= path.length; i++) await this.page.keyboard.press('Escape');
      throw err;
    });
  }

  private async walkOpenMenu(open: () => Promise<void>, path: string[]): Promise<void> {
    await open();
    await sleep(500); // let the menu finish its open animation before measuring items
    let from: { x: number; y: number } | null = null;
    for (const [i, item] of path.entries()) {
      const point = await this.waitForMenuItem(item, i + 1);
      // Slide sideways into a submenu before moving to the item, so the
      // pointer never crosses a sibling item that would swap the submenu.
      if (from) await this.page.mouse.move(point.x, from.y, { steps: 5 });
      await this.page.mouse.move(point.x, point.y, { steps: 5 });
      if (i === path.length - 1) {
        await this.page.mouse.click(point.x, point.y);
      } else {
        // Hovering opens the submenu; hover again if the item moved meanwhile.
        await sleep(300);
        const again = await this.waitForMenuItem(item, i + 1);
        if (Math.abs(again.y - point.y) > 2)
          await this.page.mouse.move(again.x, again.y, { steps: 3 });
      }
      from = point;
      await sleep(400);
    }
  }

  // Clicks an item of a menu that is already open (e.g. the text align dropdown).
  async pickMenuItem(item: string): Promise<void> {
    const point = await this.waitForMenuItem(item, 1);
    await this.page.mouse.click(point.x, point.y);
    await sleep(400);
  }

  // Searches the `depth`-th open menu panel (1 = the menu itself, 2 = its
  // submenu…), waiting for it to open: a parent item can carry the same icon
  // as one of its children.
  private async waitForMenuItem(item: string, depth: number): Promise<{ x: number; y: number }> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const point = await this.page.evaluate(
        ({ text, depth }) => {
          const panels = [...document.querySelectorAll('.mat-mdc-menu-panel')].filter(
            (p) => p.getBoundingClientRect().width > 0,
          );
          const root = panels[depth - 1];
          if (!root) return null;
          // "icon:<name>" picks an icon-only item (the Shapes grid) by its Material icon.
          const icon = text.startsWith('icon:') ? text.slice(5) : null;
          const items = [...root.querySelectorAll<HTMLElement>('[role=menuitem]')].filter(
            (e) => e.offsetParent !== null,
          );
          const label = (e: HTMLElement) => e.innerText.trim().split('\n')[0]!.trim();
          // An exact label wins over a longer one it starts ("Line" vs "Line map").
          const el = icon
            ? items.find((e) => e.querySelector(`mat-icon[data-mat-icon-name="${icon}"]`))
            : (items.find((e) => label(e) === text) ??
              items.find((e) => label(e).startsWith(text)));
          if (!el) return null;
          // Long menus (Insert) overflow the window; bring the item into view before measuring.
          el.scrollIntoView({ block: 'nearest' });
          if (
            el.getAttribute('disabled') === 'true' ||
            el.getAttribute('aria-disabled') === 'true'
          ) {
            return { disabled: true, x: 0, y: 0 };
          }
          const r = el.getBoundingClientRect();
          return { disabled: false, x: r.x + r.width / 2, y: r.y + r.height / 2 };
        },
        { text: item, depth },
      );
      if (point?.disabled) throw new Error(`menu item "${item}" is disabled`);
      if (point) return point;
      await sleep(200);
    }
    throw new Error(`menu item "${item}" not found`);
  }

  // ── Canvas geometry and components ─────────────────────────────────────

  async geometry(): Promise<CanvasGeometry> {
    return this.page.evaluate((selector) => {
      const area = document.querySelector<HTMLElement>(selector);
      if (!area) throw new Error('canvas not found');
      const r = area.getBoundingClientRect();
      const width = parseFloat(area.style.width) || r.width;
      const height = parseFloat(area.style.height) || r.height;
      return { originX: r.x, originY: r.y, scale: r.width / width, width, height };
    }, SEL.canvas);
  }

  async toScreen(x: number, y: number): Promise<{ x: number; y: number }> {
    const g = await this.geometry();
    return { x: g.originX + x * g.scale, y: g.originY + y * g.scale };
  }

  async layouts(): Promise<Layout[]> {
    const styles = await this.page
      .locator(`${SEL.canvas} ${SEL.component}`)
      .evaluateAll((els) => els.map((e) => e.getAttribute('style') ?? ''));
    return styles.map(parseLayout);
  }

  private component(index: number): Locator {
    return this.page.locator(`${SEL.canvas} ${SEL.component}`).nth(index);
  }

  // A screen point inside the component that no other component covers.
  private async clickablePoint(index: number): Promise<{ x: number; y: number }> {
    const point = await this.component(index).evaluate((target) => {
      const r = target.getBoundingClientRect();
      for (const fy of [0.5, 0.15, 0.85, 0.3, 0.7]) {
        for (const fx of [0.5, 0.1, 0.9, 0.3, 0.7]) {
          const x = r.x + r.width * fx;
          const y = r.y + r.height * fy;
          const hit = document.elementFromPoint(x, y);
          if (hit && hit.closest('.lego-component-repeat') === target) return { x, y };
        }
      }
      return null;
    });
    if (!point)
      throw new EditorStepError(`component ${index} is fully covered by other components`);
    return point;
  }

  async select(index: number): Promise<string> {
    const count = (await this.layouts()).length;
    if (index < 0 || index >= count) {
      throw new EditorStepError(`there is no component ${index} on this page (it has ${count}).`);
    }
    await this.page.keyboard.press('Escape');
    await this.closeBackdrop();
    if (await this.component(index).locator('iframe').count()) {
      // A click on a URL embed lands in the embedded page: draw a selection
      // box around it from the empty canvas instead.
      await this.deselect();
      const box = (await this.layouts())[index]!;
      const from = await this.toScreen(Math.max(0, box.x - 8), Math.max(0, box.y - 8));
      const to = await this.toScreen(box.x + box.width + 8, box.y + box.height + 8);
      await this.slowDrag(from, to);
    } else {
      // The selection handles of a tiny or flat component (a line) cover it.
      const point = await this.clickablePoint(index).catch(async () => {
        await this.deselect();
        return this.clickablePoint(index);
      });
      await this.page.mouse.click(point.x, point.y);
    }
    await sleep(700);
    await this.closeDatePopup();
    return this.panelTitle();
  }

  // Selects several components: the first by a click, the rest by Shift+click.
  async selectMany(indexes: number[]): Promise<void> {
    await this.select(indexes[0]!);
    await this.page.keyboard.down('Shift');
    try {
      for (const index of indexes.slice(1)) {
        const point = await this.clickablePoint(index);
        await this.page.mouse.click(point.x, point.y);
        await sleep(400);
      }
    } finally {
      await this.page.keyboard.up('Shift');
    }
  }

  // A selected button opens a link menu over a transparent backdrop that
  // ignores Escape and swallows the next click: click the backdrop away.
  private async closeBackdrop(): Promise<void> {
    const backdrop = this.page.locator('.cdk-overlay-backdrop-showing').last();
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ position: { x: 2, y: 2 }, force: true }).catch(() => undefined);
      await sleep(300);
    }
  }

  async deselect(): Promise<void> {
    const g = await this.geometry();
    await this.page.keyboard.press('Escape');
    // The strip above the canvas is empty and never holds components.
    await this.page.mouse.click(g.originX + 5, g.originY - 8);
    await sleep(300);
  }

  async panelTitle(): Promise<string> {
    const title = this.page.locator(SEL.panelTitle).first();
    return ((await title.textContent({ timeout: 3_000 }).catch(() => null)) ?? '').trim();
  }

  // Inserts with the current tool by clicking the canvas, and returns the new
  // component's index. Tools that take no default size (images) draw the box
  // by dragging out `size` instead.
  async placeAt(
    x: number,
    y: number,
    insert: () => Promise<void>,
    size?: { width: number; height: number },
  ): Promise<number> {
    const before = await this.layouts();
    await insert();
    const point = await this.toScreen(x, y);
    if (size) {
      const end = await this.toScreen(x + size.width, y + size.height);
      await this.slowDrag(point, end);
    } else {
      await this.page.mouse.click(point.x, point.y);
    }
    return this.step('place the new component', async () => {
      const deadline = Date.now() + this.timeoutMs;
      while (Date.now() < deadline) {
        const after = await this.layouts();
        if (after.length > before.length) {
          await this.settle(600);
          const fresh = await this.layouts();
          const known = new Set(before.map((l) => JSON.stringify(l)));
          const index = fresh.findIndex((l) => !known.has(JSON.stringify(l)));
          return index >= 0 ? index : fresh.length - 1;
        }
        await sleep(250);
      }
      throw new Error('no component appeared on the canvas');
    });
  }

  // Images take a quick drag for a click: pause at each end.
  private async slowDrag(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    await this.page.mouse.move(from.x, from.y);
    await sleep(300);
    await this.page.mouse.down();
    await sleep(200);
    await this.page.mouse.move(to.x, to.y, { steps: 25 });
    await sleep(200);
    await this.page.mouse.up();
  }

  async undo(): Promise<void> {
    await this.page
      .getByRole('button', { name: 'Undo' })
      .first()
      .click()
      .catch(() => undefined);
    await this.settle(500);
  }

  // Moves and resizes with the mouse, then corrects the position with 1px nudges.
  async applyLayout(index: number, target: Partial<Layout>): Promise<Layout> {
    return this.step(`move component ${index}`, async () => {
      await this.select(index);
      // The resize handle is the bottom-right corner: if it hangs off the
      // canvas, first pull the component inside so the handle can be grabbed.
      const g0 = await this.geometry();
      const box = (await this.layouts())[index]!;
      const inside = {
        x: Math.min(box.x, Math.max(0, g0.width - box.width)),
        y: Math.min(box.y, Math.max(0, g0.height - box.height)),
      };
      if (inside.x !== box.x || inside.y !== box.y)
        await this.moveBy(index, inside.x - box.x, inside.y - box.y);

      for (let attempt = 0; attempt < 3; attempt++) {
        const current = (await this.layouts())[index]!;
        const width = target.width ?? current.width;
        const height = target.height ?? current.height;
        if (Math.abs(width - current.width) <= 1 && Math.abs(height - current.height) <= 1) break;
        const g = await this.geometry();
        const fromX = g.originX + (current.x + current.width) * g.scale - 1;
        const fromY = g.originY + (current.y + current.height) * g.scale - 1;
        await this.slowDrag(
          { x: fromX, y: fromY },
          {
            x: fromX + (width - current.width) * g.scale,
            y: fromY + (height - current.height) * g.scale,
          },
        );
        await sleep(400);
      }

      for (let attempt = 0; attempt < 3; attempt++) {
        const current = (await this.layouts())[index]!;
        const dx = (target.x ?? current.x) - current.x;
        const dy = (target.y ?? current.y) - current.y;
        if (dx === 0 && dy === 0) break;
        await this.moveBy(index, dx, dy);
      }
      await this.settle(500);
      return (await this.layouts())[index]!;
    });
  }

  // Big moves drag the body; the last pixels are Shift+Arrow nudges (1px each).
  // Drags the component for big moves; Shift+Arrow (exactly 1 px a press) does
  // the rest, and everything when the drop point is off screen or the drag did
  // not take (a text box swallows the drag as a text selection).
  private async moveBy(index: number, dx: number, dy: number): Promise<void> {
    if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
      const g = await this.geometry();
      const start = await this.clickablePoint(index);
      const end = { x: start.x + dx * g.scale, y: start.y + dy * g.scale };
      const screen = await this.page.evaluate(() => ({
        w: window.innerWidth,
        h: window.innerHeight,
      }));
      if (end.x >= 0 && end.y >= 0 && end.x <= screen.w - 5 && end.y <= screen.h - 5) {
        const before = (await this.layouts())[index]!;
        await this.page.mouse.move(start.x, start.y);
        await this.page.mouse.down();
        await this.page.mouse.move(end.x, end.y, { steps: 15 });
        await this.page.mouse.up();
        await sleep(400);
        const after = (await this.layouts())[index]!;
        const movedX = after.x - before.x;
        const movedY = after.y - before.y;
        if (Math.abs(movedX) + Math.abs(movedY) > 2) return;
      }
    }
    // A click on an already selected text box starts editing its text, and the
    // arrows would then move the caret: select it fresh.
    await this.deselect();
    await this.select(index);
    for (let i = 0; i < Math.abs(dx); i++)
      await this.page.keyboard.press(dx > 0 ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
    for (let i = 0; i < Math.abs(dy); i++)
      await this.page.keyboard.press(dy > 0 ? 'Shift+ArrowDown' : 'Shift+ArrowUp');
    await sleep(400);
  }

  // ── Data ────────────────────────────────────────────────────────────────

  // Fills the BigQuery connector dialog that "Add data" (or a new report) opens.
  async connectBigQuery(source: BigQuerySource): Promise<void> {
    await this.step(
      `connect BigQuery ${source.projectId}.${source.datasetId}.${source.tableId}`,
      async () => {
        await this.page
          .getByText('BigQuery', { exact: true })
          .first()
          .click({ timeout: this.timeoutMs });
        const manual = this.page.getByPlaceholder('Enter Project Id manually');
        await manual.waitFor({ timeout: this.timeoutMs });
        await manual.fill(source.projectId);
        await manual.press('Enter');
        // The dataset list sometimes never loads after the first Enter: ask again.
        await this.clickVisibleText(source.datasetId, this.timeoutMs / 2).catch(async () => {
          await manual.fill('');
          await manual.fill(source.projectId);
          await manual.press('Enter');
          await this.clickVisibleText(source.datasetId);
        });
        await this.clickVisibleText(source.tableId);
        await this.page.getByRole('button', { name: 'Add', exact: true }).click();
        // Existing reports ask to confirm; new ones go straight to the editor.
        const confirm = this.page.getByRole('button', { name: 'Add to report', exact: true });
        await confirm.click({ timeout: 5_000 }).catch(() => undefined);
        await this.page
          .locator(SEL.dataPanelChip('Record Count'))
          .first()
          .waitFor({ timeout: this.timeoutMs });
      },
    );
    await this.settle();
  }

  // Picks the data source in the Setup panel when the report has several: the
  // selector button opens a searchable list of the report's data sources.
  async chooseDataSource(name: string): Promise<void> {
    await this.step(`choose data source ${name}`, async () => {
      await this.openTab('Setup');
      await this.page
        .locator(`${SEL.propertiesPanel} button.datasource-selector-button`)
        .first()
        .click();
      const option = this.page
        .locator('.cdk-overlay-container')
        .getByText(name, { exact: true })
        .first();
      await option.waitFor({ timeout: this.timeoutMs }).catch(() => {
        throw new Error(
          `the report has no data source called "${name}"; add it with add_data_source`,
        );
      });
      await option.click();
    });
    await this.settle(1500);
  }

  // Clicks the copy of `text` that is actually on top: the same table name can
  // also be in the Data panel or a selector underneath the open dialog.
  private async clickVisibleText(text: string, timeoutMs = this.timeoutMs): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const point = await this.page.evaluate((wanted) => {
        for (const e of document.querySelectorAll<HTMLElement>('body *')) {
          if (e.children.length > 0 || e.textContent?.trim() !== wanted) continue;
          e.scrollIntoView({ block: 'nearest' });
          const r = e.getBoundingClientRect();
          if (r.width === 0) continue;
          const x = r.x + Math.min(r.width / 2, 20);
          const y = r.y + r.height / 2;
          const top = document.elementFromPoint(x, y);
          if (top && (top === e || e.contains(top) || top.contains(e))) return { x, y };
        }
        return null;
      }, text);
      if (point) {
        await this.page.mouse.click(point.x, point.y);
        return;
      }
      await sleep(300);
    }
    throw new Error(`"${text}" is not in the list`);
  }

  private async setupSlots(): Promise<SetupSlot[]> {
    return this.page
      .locator(SEL.propertiesPanel)
      .first()
      .evaluate((panel) => {
        const visible = (e: Element) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        // A chip belongs to its chip list's own label ("Breakdown dimension"),
        // or else to the heading of its panel section ("Dimension - Y axis").
        const sectionOf = (e: Element): string => {
          const list = e.closest('.lego-chip-list-container');
          const own = list?.querySelector(':scope > label')?.textContent?.trim();
          if (own) return own;
          return (
            e
              .closest('properties-panel-section')
              ?.querySelector('h4.section-label')
              ?.textContent?.trim() ?? ''
          );
        };
        const box = (e: Element) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const slots: Array<{
          section: string;
          kind: 'chip' | 'add';
          field: string | null;
          rect: { x: number; y: number; width: number; height: number };
        }> = [];
        for (const e of panel.querySelectorAll<HTMLElement>('div.left-half[aria-label]')) {
          // left-half is only the type icon; the drop zone is the whole chip.
          const chip = e.closest('.common-chip') ?? e;
          if (visible(e))
            slots.push({
              section: sectionOf(e),
              kind: 'chip',
              field: e.getAttribute('aria-label'),
              rect: box(chip),
            });
        }
        for (const e of panel.querySelectorAll<HTMLElement>('*')) {
          if (e.children.length > 0 || !visible(e)) continue;
          const text = (e.textContent ?? '').trim();
          if (text !== 'Add dimension' && text !== 'Add metric' && text !== 'Add field') continue;
          // Drop on the caption itself: its button can wrap the whole chip list.
          slots.push({ section: sectionOf(e), kind: 'add', field: null, rect: box(e) });
        }
        return slots.sort((a, b) => a.rect.y - b.rect.y);
      });
  }

  // Clicking "Add metric" (or a chip's name) opens a searchable field picker
  // listing the chart's fields first and the data source's after: pick the
  // last exact match, which is the data source field. False if no picker.
  private async pickField(field: string, slot: SetupSlot): Promise<boolean> {
    const x = slot.kind === 'add' ? slot.rect.x + slot.rect.width / 2 : slot.rect.x + 50;
    await this.page.mouse.click(x, slot.rect.y + slot.rect.height / 2);
    return this.pickInFieldPicker(field);
  }

  // Searches the open field picker for `field` and clicks it. False if no picker opened.
  private async pickInFieldPicker(field: string): Promise<boolean> {
    const search = this.page.locator('.cdk-overlay-container input[placeholder="Search"]').last();
    if (
      !(await search.waitFor({ timeout: 3_000 }).then(
        () => true,
        () => false,
      ))
    ) {
      await this.closeOverlay();
      return false;
    }
    await search.fill(field);
    await sleep(500);
    const point = await this.page.evaluate((name) => {
      const hits = [
        ...document.querySelectorAll<HTMLElement>(
          '.cdk-overlay-container .display-name-highlighted',
        ),
      ].filter((e) => e.getBoundingClientRect().width > 0 && e.textContent?.trim() === name);
      const hit = hits[hits.length - 1];
      if (!hit) return null;
      const r = hit.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, field);
    if (!point) {
      await this.closeOverlay();
      throw new Error(`the data source has no field "${field}"`);
    }
    await this.page.mouse.click(point.x, point.y);
    await sleep(900);
    await this.closeOverlay();
    return true;
  }

  // Drags a field from the Data panel onto a Setup slot (drop on a chip replaces it).
  // The panel's search box is not used: its results are drawn over the full
  // list, and a press there lands on whichever list is on top.
  private async dropField(field: string, rect: Rect): Promise<void> {
    const source = this.page.locator(SEL.dataPanelChip(field)).first();
    await source.waitFor({ timeout: this.timeoutMs }).catch(() => {
      throw new Error(`the data source has no field "${field}"`);
    });
    await source.scrollIntoViewIfNeeded();
    const from = await source.boundingBox();
    if (!from) throw new Error(`field "${field}" is not visible`);
    // Grab near the left edge: the drag ghost hangs from the grab point, and
    // the editor matches drop zones against the ghost, not the pointer.
    const at = { x: from.x + 16, y: from.y + from.height / 2 };
    const hit = await this.page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('[aria-label]')?.getAttribute('aria-label'),
      at,
    );
    if (hit !== field)
      throw new Error(
        `field "${field}" is covered by "${hit ?? 'something else'}" in the Data panel`,
      );
    await this.page.mouse.move(at.x, at.y);
    await this.page.mouse.down();
    // Go down the Data panel first, then straight left: a diagonal path
    // crosses other drop zones (the data source picker) that capture the drag.
    const y = rect.y + rect.height / 2;
    await this.page.mouse.move(at.x - 6, at.y + 12, { steps: 5 });
    await this.page.mouse.move(at.x - 6, y, { steps: 10 });
    await this.page.mouse.move(rect.x + 20, y, { steps: 15 });
    await sleep(300);
    await this.page.mouse.up();
    await sleep(900);
  }

  private async removeChip(rect: Rect): Promise<void> {
    await this.page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await sleep(250);
    // Each chip's container holds its own remove button next to the field name.
    const removed = await this.page.evaluate(
      ({ y }) => {
        const containers = [
          ...document.querySelectorAll<HTMLElement>('properties-panel .common-chip-container'),
        ];
        const hit = containers.find((c) => {
          const r = c.getBoundingClientRect();
          return r.width > 0 && Math.abs(r.y + r.height / 2 - y) < 12;
        });
        const button = hit?.querySelector<HTMLElement>('.remove-chip-button');
        if (!button) return false;
        button.click();
        return true;
      },
      { y: rect.y + rect.height / 2 },
    );
    if (!removed) throw new Error('could not find the remove button of an extra field');
    await sleep(700);
  }

  // Chip lists are virtual-scrolled: off-screen sections render no chips.
  // Scroll the section (or chip list) whose label matches into view first.
  private async revealSection(section: RegExp): Promise<void> {
    await this.page
      .locator(SEL.propertiesPanel)
      .first()
      .evaluate(
        (panel, { source, flags }) => {
          const re = new RegExp(source, flags);
          const labels = [
            ...panel.querySelectorAll(
              '.lego-chip-list-container > label, properties-panel-section h4.section-label',
            ),
          ];
          labels
            .find((l) => re.test(l.textContent?.trim() ?? ''))
            ?.scrollIntoView({ block: 'center' });
        },
        { source: section.source, flags: section.flags },
      );
    await sleep(300);
  }

  // Makes the fields of one Setup section exactly `fields`, in order.
  async setSectionFields(section: RegExp, fields: string[], what: string): Promise<void> {
    await this.step(`set ${what} to ${fields.join(', ') || 'none'}`, async () => {
      await this.openTab('Setup');
      // Fill the first slot that differs until the section matches; an add
      // can disturb an earlier slot, so the whole prefix is checked each time.
      for (let attempt = 0; ; attempt++) {
        await this.revealSection(section);
        const slots = (await this.setupSlots()).filter((s) => section.test(s.section));
        const chips = slots.filter((s) => s.kind === 'chip');
        const i = fields.findIndex((f, j) => chips[j]?.field !== f);
        if (i < 0) break;
        if (attempt === fields.length + 3)
          throw new Error(
            `"${fields[i]}" did not stay in slot ${i + 1} of ${what} (it shows ${chips[i]?.field ?? 'nothing'})`,
          );
        const target = chips[i] ?? slots.find((s) => s.kind === 'add');
        if (!target) throw new Error(`the chart has no ${what} slot`);
        // The field picker is reliable; dragging is the fallback.
        if (!(await this.pickField(fields[i]!, target)))
          await this.dropField(fields[i]!, target.rect);
      }
      for (;;) {
        await this.revealSection(section);
        const chips = (await this.setupSlots()).filter(
          (s) => section.test(s.section) && s.kind === 'chip',
        );
        if (chips.length <= fields.length) break;
        await this.removeChip(chips[chips.length - 1]!.rect);
      }
    });
    await this.settle(500);
  }

  // ── Dates, filters and series ──────────────────────────────────────────

  // Charts choose between the data source's dates ("Auto") and their own
  // ("Custom"); the date range control only has the picker.
  async setDateRange(preset: string): Promise<void> {
    const fixed = FIXED_RANGE_RE.exec(preset.trim());
    const path = fixed ? ['Fixed'] : datePresetPath(preset);
    await this.step(`set the date range to ${preset}`, async () => {
      await this.closeDatePopup();
      await this.openTab('Setup');
      // The picker only shows once "Custom" is on.
      const find = (what: 'custom' | 'picker') =>
        this.page
          .locator(SEL.propertiesPanel)
          .first()
          .evaluate((panel, what) => {
            const el =
              what === 'custom'
                ? panel.querySelector<HTMLInputElement>(
                    'input[type=radio][aria-label="radio button: Custom"]',
                  )
                : panel.querySelector('button.ng2-date-picker-button');
            if (!el || (el instanceof HTMLInputElement && el.checked)) return null;
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }, what);
      const custom = await find('custom');
      if (custom) {
        await this.page.mouse.click(custom.x, custom.y);
        await sleep(700);
      }
      const picker = await find('picker');
      if (!picker) throw new Error('the Setup tab has no date range picker');
      await this.page.mouse.click(picker.x, picker.y);
      await this.pickInDatePopup(path, fixed ? [fixed[1]!, fixed[2]!] : undefined);
    });
    await this.settle(500);
  }

  // "Previous period", "Previous year" or "None".
  async setComparison(preset: string): Promise<void> {
    await this.step(`compare with ${preset}`, async () => {
      await this.openTab('Setup');
      const panel = this.page.locator(SEL.propertiesPanel).first();
      const toggle = panel.locator('button[role=switch][aria-label="Comparison date range"]');
      const on = (await toggle.getAttribute('aria-checked')) === 'true';
      const off = /^none$/i.test(preset.trim());
      if (on === off) await toggle.click();
      if (off) return;
      await sleep(600);
      await panel.locator('button[aria-label^="Comparison date range "]').first().click();
      await this.pickInDatePopup([preset.trim()]);
    });
    await this.settle(500);
  }

  // Selecting a date range control by a click also opens its own picker.
  async closeDatePopup(): Promise<void> {
    const cancel = this.page
      .locator('.cdk-overlay-container')
      .getByRole('button', { name: 'Cancel', exact: true });
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click();
      await sleep(500);
    }
  }

  // The date popup has a preset menu button next to the calendars, and Apply.
  // A fixed range ("2026-10-01..2026-10-15") picks "Fixed" and clicks the days.
  private async pickInDatePopup(path: string[], fixed?: [string, string]): Promise<void> {
    await sleep(800);
    const trigger = await this.page.evaluate(() => {
      const apply = [...document.querySelectorAll<HTMLElement>('button')]
        .filter((b) => b.offsetParent !== null && b.textContent?.trim() === 'Apply')
        .pop();
      for (let box = apply?.parentElement; box; box = box.parentElement) {
        const menu = [...box.querySelectorAll<HTMLElement>('button')].find(
          (b) =>
            b !== apply && b.offsetParent !== null && b.textContent?.includes('arrow_drop_down'),
        );
        if (menu) {
          const r = menu.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    });
    if (!trigger) throw new Error('the date picker did not open');
    await this.walkMenu(() => this.page.mouse.click(trigger.x, trigger.y), path);
    await sleep(500);
    if (fixed) {
      // Two calendars: the start date on the left, the end date on the right.
      await this.pickCalendarDay(0, fixed[0]);
      await this.pickCalendarDay(1, fixed[1]);
    }
    await this.page.getByRole('button', { name: 'Apply', exact: true }).last().click();
    await sleep(600);
  }

  // Pages the n-th visible calendar to the month of `iso` (YYYY-MM-DD) and clicks the day.
  private async pickCalendarDay(n: number, iso: string): Promise<void> {
    const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
    const calendar = this.page.locator('.cdk-overlay-container mat-calendar').nth(n);
    const months = [
      'JAN',
      'FEB',
      'MAR',
      'APR',
      'MAY',
      'JUN',
      'JUL',
      'AUG',
      'SEP',
      'OCT',
      'NOV',
      'DEC',
    ];
    for (let guard = 0; guard < 240; guard++) {
      const shown = (await calendar.locator('.mat-calendar-period-button').innerText()).trim();
      const [m, y] = shown.toUpperCase().split(/\s+/);
      const delta = (year - Number(y)) * 12 + (month - 1 - months.indexOf(m!));
      if (delta === 0) break;
      await calendar
        .getByRole('button', { name: delta > 0 ? 'Next month' : 'Previous month' })
        .click();
      await sleep(150);
    }
    const label = `${months[month - 1]![0]}${months[month - 1]!.slice(1).toLowerCase()} ${day}, ${year}`;
    const cell = calendar.getByRole('button', { name: label, exact: true });
    if (!(await cell.count()))
      throw new Error(`${iso} cannot be picked (outside the data's dates?)`);
    await cell.click();
    await sleep(300);
  }

  // Adds a filter to the selected chart or control (or the open page/report
  // settings): an existing one by name, or a new one. Returns false when an
  // existing filter was reused.
  async addFilter(
    filter: { name: string; clauses: FilterClauseInput[][] },
    scope: string = SEL.propertiesPanel,
  ): Promise<boolean> {
    return this.step(`add the filter "${filter.name}"`, async () => {
      if (scope === SEL.propertiesPanel) {
        await this.openTab('Setup');
        await this.revealSection(/^Filter$/);
      }
      await this.page.locator(scope).getByText('Add filter', { exact: true }).first().click();
      await sleep(900);
      const overlay = this.page.locator('.cdk-overlay-container');
      const existing = overlay.getByText(filter.name, { exact: true });
      if (await existing.count()) {
        await existing.first().click();
        await sleep(600);
        return false;
      }
      if (!filter.clauses.length) {
        await this.page.keyboard.press('Escape');
        throw new Error(`the report has no filter named "${filter.name}"`);
      }
      await overlay.getByText('Create a filter', { exact: true }).first().click();
      await this.fillNewFilter(filter.name, filter.clauses);
      return true;
    });
  }

  // In the open filter editor: name it and add every clause. Groups are
  // joined by AND, clauses in a group by OR; each new clause comes in last.
  async fillNewFilter(name: string, groups: FilterClauseInput[][]): Promise<void> {
    const nameBox = this.page.getByPlaceholder('Filter name');
    await nameBox.waitFor({ timeout: this.timeoutMs });
    await nameBox.fill(name);
    await this.writeClauses(groups, false);
    await this.saveFilter();
  }

  // In the open Edit Filter page: replaces every clause with `groups`.
  async rewriteFilter(groups: FilterClauseInput[][], name?: string): Promise<void> {
    const nameBox = this.page.getByPlaceholder('Filter name');
    await nameBox.waitFor({ timeout: this.timeoutMs });
    if (name) await nameBox.fill(name);
    // Drop clauses from the end until one is left, then rewrite that one.
    for (let n = await this.clauses().count(); n > 1; n--) {
      await this.clauses()
        .last()
        .locator('button:has(mat-icon[data-mat-icon-name="close"])')
        .click();
      await sleep(600);
    }
    await this.writeClauses(groups, true);
    await this.saveFilter();
  }

  private clauses(): Locator {
    return this.page.locator('.ng2-filter-expression-definition');
  }

  private async writeClauses(groups: FilterClauseInput[][], reuseFirst: boolean): Promise<void> {
    // With suggestions on, the value box only takes values it can suggest
    // (and none before the data loads): turn them off to type any value.
    const toggle = this.page.locator(
      '[role=switch][aria-label="Toggle switch whether to show suggestions or not"]',
    );
    if ((await toggle.getAttribute('aria-checked').catch(() => null)) === 'true') {
      await toggle.click();
      await sleep(600);
    }
    let first = true;
    for (const group of groups) {
      for (const [i, clause] of group.entries()) {
        if (!first) {
          await this.page
            .locator('button')
            .filter({ hasText: new RegExp(`^\\s*${i === 0 ? 'AND' : 'OR'}\\s*$`) })
            .last()
            .click();
          await sleep(700);
        }
        const row = this.clauses().last();
        const picker =
          first && reuseFirst
            ? row.locator('.concept-chip-container').first()
            : row.getByText('Select a field', { exact: true }).first();
        first = false;
        await picker.click();
        if (!(await this.pickInFieldPicker(clause.field)))
          throw new Error(`no field picker for "${clause.field}"`);
        await sleep(500);
        await this.fillClause(clause, row);
      }
    }
  }

  // Negation, condition and values of one clause of the filter editor.
  async fillClause(clause: Omit<FilterClauseInput, 'field'>, row: Locator): Promise<void> {
    await this.chooseOption(
      row.locator('mat-select[placeholder="Select a negation option"]'),
      clause.exclude ? 'Exclude' : 'Include',
    );
    await this.chooseOption(
      row.locator('mat-select[placeholder="Select a condition"]'),
      clause.condition,
    );
    const values = clause.values ?? [];
    const inputs = row.locator('input');
    const count = await inputs.count();
    if (values.length && !count) throw new Error(`"${clause.condition}" takes no values`);
    // "In" takes every value in one box, comma separated; "Between" takes two boxes.
    const entries = count === 1 ? [values.join(',')] : values;
    for (const [i, value] of entries.entries()) {
      const box = inputs.nth(Math.min(i, count - 1));
      await box.click();
      await box.fill(value);
      await box.press('Tab');
      await sleep(300);
    }
  }

  async saveFilter(): Promise<void> {
    const save = this.page.getByRole('button', { name: 'Button to save the filter' });
    if (await save.isDisabled()) {
      await this.page.getByRole('button', { name: 'Button to cancel the filter changes' }).click();
      throw new Error(
        'the filter editor would not save it (check the fields, conditions and values)',
      );
    }
    await save.click();
    await save.waitFor({ state: 'hidden', timeout: this.timeoutMs });
    await sleep(600);
  }

  // Picks `option` in a mat-select; matched ignoring case and a "(=)" suffix,
  // since some lists are upper-cased ("GREATER THAN") and others are not.
  async chooseOption(select: Locator, option: string): Promise<void> {
    await select.click({ force: true });
    await sleep(500);
    const options = this.page.getByRole('option');
    const texts = (await options.allTextContents()).map((o) => o.replace(/\s+/g, ' ').trim());
    const norm = (t: string) =>
      t
        .toLowerCase()
        .replace(/\(.*?\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const at = texts.findIndex((t) => norm(t) === norm(option));
    if (at < 0) {
      await this.page.keyboard.press('Escape');
      throw new Error(`"${option}" is not one of: ${texts.join(', ')}`);
    }
    await options.nth(at).click();
    await sleep(500);
  }

  // Style › Conditional formatting › Add formatting: rules (AND groups of OR
  // rules), what they color and the colors.
  async addConditionalFormat(format: ConditionalFormat): Promise<void> {
    await this.step('add conditional formatting', async () => {
      await this.openTab('Style');
      await this.page
        .locator(SEL.propertiesPanel)
        .getByText('Add formatting', { exact: true })
        .first()
        .click();
      const sheet = this.page.locator('.conditions-editor').last();
      await sheet.waitFor({ timeout: this.timeoutMs });
      let first = true;
      for (const group of format.rules) {
        for (const [i, rule] of group.entries()) {
          if (!first) {
            await sheet
              .locator(`button[aria-label="${i === 0 ? 'and' : 'or'}"]`)
              .last()
              .click();
            await sleep(700);
          }
          first = false;
          await sheet.getByText('Select a field', { exact: true }).last().click();
          await sleep(600);
          await this.page.keyboard.type(rule.field, { delay: 20 });
          await sleep(600);
          await this.page
            .locator('.display-name-highlighted')
            .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(rule.field)}\\s*$`) })
            .last()
            .click();
          await sleep(800);
          await this.chooseOption(
            sheet.locator('mat-select.select-condition-dropdown').last(),
            rule.condition,
          );
          if (rule.value !== undefined) {
            const value = sheet.locator('input[placeholder="Input value"]').last();
            await value.fill(rule.value);
            await value.press('Tab');
          }
        }
      }
      if (format.applyTo) {
        await this.chooseOption(
          sheet.locator('mat-select').filter({ hasText: 'Entire row' }).last(),
          format.applyTo,
        );
      }
      const scope = '.conditions-editor';
      const colors: Array<[string | undefined, string[]]> = [
        [format.fontColor, ['Cell font color', 'Font color', 'Text color']],
        [format.backgroundColor, ['Cell background color', 'Background color', 'Fill color']],
      ];
      for (const [color, labels] of colors) {
        if (!color) continue;
        let done = false;
        for (const label of labels) {
          if ((await this.applySettings({ [label]: color }, scope)).length === 0) {
            done = true;
            break;
          }
        }
        if (!done) throw new Error(`the formatting sheet has no ${labels[0]}`);
      }
      const save = this.page.getByRole('button', { name: 'Save', exact: true }).last();
      if (await save.isDisabled()) {
        await this.page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
        throw new Error(
          'the formatting rule is incomplete (check the fields, conditions and values)',
        );
      }
      await save.click();
      await sleep(1000);
    });
  }

  // Style › Reference lines: each new line or band is numbered after the
  // existing ones, so its settings are addressed as "Line value#3" and so on.
  async addReferences(lines: ReferenceLine[], bands: ReferenceBand[]): Promise<string[]> {
    await this.openTab('Style');
    const panel = this.page.locator(SEL.propertiesPanel);
    const missing: string[] = [];
    let lineCount = await panel.getByText(/^Reference Line #\d+$/).count();
    let bandCount = await panel.getByText(/^Reference Band #\d+$/).count();
    for (const line of lines) {
      await panel.getByText('Add a reference line', { exact: true }).first().click();
      await sleep(800);
      const k = ++lineCount;
      missing.push(
        ...(await this.applySettings({
          ...(line.type ? { [`Line type#${k}`]: line.type } : {}),
          ...(line.axis ? { [`Line axis#${k}`]: line.axis } : {}),
          ...(line.value !== undefined ? { [`Line value#${k}`]: line.value } : {}),
          ...(line.label ? { [`Show label#${k}`]: true, [`Line label#${k}`]: line.label } : {}),
          ...(line.color ? { [`Line color#${k}`]: line.color } : {}),
        })),
      );
    }
    for (const band of bands) {
      await panel.getByText('Add a reference band', { exact: true }).first().click();
      await sleep(800);
      const k = ++bandCount;
      missing.push(
        ...(await this.applySettings({
          [`Beginning line value#${k}`]: band.from,
          [`Ending line value#${k}`]: band.to,
          ...(band.label
            ? { [`Show label#${lineCount + k}`]: true, [`Band label#${k}`]: band.label }
            : {}),
          ...(band.color ? { [`Background color#${k}`]: band.color } : {}),
        })),
      );
    }
    return missing;
  }

  // Tables sort by up to several fields: "Add sort" opens the field picker
  // and adds "Sort #2", "Sort #3"… with their own Descending/Ascending.
  async addSorts(sorts: Array<{ field: string; ascending?: boolean }>): Promise<string[]> {
    await this.openTab('Setup');
    const panel = this.page.locator(SEL.propertiesPanel);
    const missing: string[] = [];
    for (const sort of sorts) {
      const k = (await panel.getByText(/^Sort #\d+$/).count()) + 1;
      const add = panel.getByText('Add sort', { exact: true }).first();
      if (!(await add.count())) {
        missing.push(`sort #${k} (this chart takes a single sort)`);
        continue;
      }
      await this.step(`add sort #${k} by ${sort.field}`, async () => {
        await add.scrollIntoViewIfNeeded();
        await add.click();
        if (!(await this.pickInFieldPicker(sort.field)))
          throw new Error('the field picker did not open');
      });
      await sleep(600);
      missing.push(
        ...(await this.applySettings({
          [`${sort.ascending ? 'Ascending' : 'Descending'}#${k}`]: true,
        })),
      );
    }
    return missing;
  }

  // Switches the selected chart through the "Chart types" grid, whose presets
  // are in the same order as "Add a chart" but carry no labels.
  async switchChartType(preset: string, at: number): Promise<string> {
    return this.step(`switch the chart to ${preset}`, async () => {
      const panel = this.page.locator(SEL.propertiesPanel);
      const grid = this.page.locator('properties-panel preset-preview');
      if (
        !(await grid
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        await panel.getByText('Chart types', { exact: true }).first().click();
        await sleep(800);
      }
      await grid.nth(at).click();
      await sleep(1200);
      await panel
        .getByText('Chart types', { exact: true })
        .first()
        .click()
        .catch(() => undefined);
      await sleep(400);
      return this.panelTitle();
    });
  }

  // A line's "Line start" and "Line end" drop-downs carry no label: they are
  // the two whose value is a line end (None, Circle, Diamond, Pointer).
  async setLineEnds(start?: string, end?: string): Promise<void> {
    const selects = this.page
      .locator(`${SEL.propertiesPanel} mat-select`)
      .filter({ hasText: /^\s*(None|Circle|Diamond|Pointer)\s*$/ });
    if ((await selects.count()) < 2)
      throw new EditorStepError('the line has no start/end settings');
    if (start) await this.chooseOption(selects.nth(0), start);
    if (end) await this.chooseOption(selects.nth(1), end);
  }

  // Button controls: a link (URL or page of the report) or a report action.
  async setButton(button: ButtonSpec): Promise<string[]> {
    await this.closeBackdrop();
    await this.openTab('Setup');
    const panel = this.page.locator(SEL.propertiesPanel);
    if (button.action === 'report_action') {
      await this.applySettings({ 'Report Actions': true });
      return this.applySettings({ Action: button.reportAction! });
    }
    await this.applySettings({ Navigation: true });
    await panel.getByText('Insert link', { exact: true }).first().click();
    const box = this.page.getByPlaceholder('Paste a link, or select a page');
    await box.waitFor({ timeout: this.timeoutMs });
    if (button.url) {
      await box.fill(button.url);
    } else {
      await box.click();
      await this.page.keyboard.type(button.page!, { delay: 15 });
      await sleep(700);
      const option = this.page
        .locator('.cdk-overlay-container [role=option], .cdk-overlay-container mat-option')
        .filter({ hasText: button.page! })
        .first();
      if (!(await option.count())) throw new Error(`the report has no page named "${button.page}"`);
      await option.click();
    }
    const newTab = this.page.getByRole('checkbox', { name: 'Open link in new tab' });
    if ((await newTab.count()) && (await newTab.isChecked()) !== !!button.newTab) {
      await newTab.click({ force: true });
    }
    await this.page.getByRole('button', { name: 'Apply', exact: true }).last().click();
    await sleep(600);
    return [];
  }

  // Line/bars, axis and color of each metric of a combo or line chart.
  async setSeries(
    series: Array<{
      metric: string;
      type?: 'line' | 'bars';
      axis?: 'left' | 'right';
      color?: string;
    }>,
  ): Promise<string[]> {
    await this.openTab('Style');
    const missing: string[] = [];
    for (const s of series) {
      const notFound = await this.applySettings({ 'Select metric': s.metric });
      if (notFound.length) {
        missing.push(`series ${s.metric}`);
        continue;
      }
      const settings: StyleSettings = {
        ...(s.type ? { [s.type === 'bars' ? 'Bars' : 'Line']: true } : {}),
        ...(s.axis ? { [s.axis === 'right' ? 'Right' : 'Left']: true } : {}),
      };
      missing.push(...(await this.applySettings(settings)).map((m) => `${m} of ${s.metric}`));
      if (s.color) {
        const colored = await this.firstSetting(['Line color', 'Bar color', 'Color'], s.color);
        if (!colored) missing.push(`color of ${s.metric}`);
      }
    }
    return missing;
  }

  // In an open color palette: Add custom color, type the hex, Done.
  private async pickCustomColor(color: string): Promise<void> {
    await this.page
      .getByRole('button', { name: 'Add custom color' })
      .last()
      .click({ timeout: 5_000 });
    const hex = this.page.locator('mat-dialog-container input[aria-label="Hex"]').last();
    await hex.fill(color.replace('#', '').toUpperCase());
    await hex.press('Enter');
    await this.page.getByRole('button', { name: 'Done', exact: true }).last().click();
  }

  // Style › Manage dimension value colors: one mapping per value, shared by
  // every chart of the report that shows that dimension value.
  async setValueColors(colors: Record<string, string>): Promise<void> {
    await this.step('set the dimension value colors', async () => {
      await this.openTab('Style');
      await this.applySettings({ 'Dimension values': true });
      const panel = this.page.locator(SEL.propertiesPanel);
      await panel.getByText('Manage dimension value colors', { exact: true }).first().click();
      await this.page
        .getByRole('button', { name: 'Add a value button' })
        .waitFor({ timeout: this.timeoutMs });
      for (const [value, color] of Object.entries(colors)) {
        await this.page.getByRole('button', { name: 'Add a value button' }).click();
        const dialog = this.page.locator('mat-dialog-container', { hasText: 'Add A Value' });
        await dialog.waitFor({ timeout: this.timeoutMs });
        await dialog.locator('button').first().click();
        await sleep(400);
        await this.pickCustomColor(color);
        await sleep(300);
        // fill() leaves Create disabled: the dialog listens for keystrokes.
        await dialog.getByRole('textbox', { name: 'Enter a value textbox' }).click();
        await this.page.keyboard.type(value, { delay: 15 });
        await sleep(300);
        await dialog.getByRole('button', { name: 'Create value button' }).click();
        await dialog.waitFor({ state: 'hidden', timeout: this.timeoutMs });
      }
      await this.page.getByRole('button', { name: 'Close', exact: true }).last().click();
    });
    await this.settle(600);
  }

  // Whether a switch of the open properties panel is on; null when it has none.
  async toggleState(label: string): Promise<boolean | null> {
    const toggle = this.page
      .locator(`${SEL.propertiesPanel} button[role=switch][aria-label="${cssEscape(label)}"]`)
      .first();
    if (!(await toggle.count())) return null;
    return (await toggle.getAttribute('aria-checked')) === 'true';
  }

  // Applies `value` to the first of `labels` the panel has.
  async firstSetting(labels: string[], value: string | number | boolean): Promise<boolean> {
    for (const label of labels) {
      if ((await this.applySettings({ [label]: value })).length === 0) return true;
    }
    return false;
  }

  // Clicking a metric chip opens its field editor: display name and aggregation.
  async editMetric(index: number, edit: { aggregation?: string; label?: string }): Promise<void> {
    await this.step(`edit metric ${index + 1}`, async () => {
      await this.revealSection(SECTION.metrics);
      const chips = (await this.setupSlots()).filter(
        (s) => SECTION.metrics.test(s.section) && s.kind === 'chip',
      );
      const chip = chips[index];
      if (!chip) throw new Error(`there is no metric ${index + 1}`);
      await this.editChip(chip, edit);
    });
    await this.settle(500);
  }

  // Renames a dimension or metric chip of the selected chart, found by its
  // current name (field name, or display name once renamed).
  async relabelField(name: string, label: string): Promise<void> {
    await this.step(`rename the field ${name} to ${label}`, async () => {
      await this.openTab('Setup');
      const find = async () =>
        (await this.setupSlots()).find(
          (s) => s.kind === 'chip' && s.field === name && !/^Sort/.test(s.section),
        );
      let chip = await find();
      if (!chip) {
        for (const section of [SECTION.dimensions, SECTION.metrics, SECTION.breakdown]) {
          await this.revealSection(section);
          chip = await find();
          if (chip) break;
        }
      }
      if (!chip) throw new Error(`the chart has no field called "${name}"`);
      await this.editChip(chip, { label });
    });
    await this.settle(500);
  }

  // The pencil at a chip's left edge opens its field editor.
  private async editChip(
    chip: SetupSlot,
    edit: { aggregation?: string; label?: string },
  ): Promise<void> {
    await this.page.mouse.click(chip.rect.x + 12, chip.rect.y + chip.rect.height / 2);
    const editor = this.page.locator('.cdk-overlay-container input').first();
    await editor.waitFor({ timeout: this.timeoutMs });
    if (edit.label !== undefined) {
      const name = this.page.locator('.cdk-overlay-container input').first();
      await name.fill(edit.label);
      await name.press('Tab');
      await sleep(300);
    }
    if (edit.aggregation) {
      const button = await this.page.evaluate(() => {
        // Each dropdown sits under its caption (Data type, Display Format, Aggregation…).
        const caption = [
          ...document.querySelectorAll('.cdk-overlay-container p, .cdk-overlay-container span'),
        ].find(
          (e) => e.textContent?.trim() === 'Aggregation' && e.getBoundingClientRect().width > 0,
        );
        if (!caption) return null;
        const label = caption.getBoundingClientRect();
        const next = [...document.querySelectorAll<HTMLElement>('.cdk-overlay-container button')]
          .map((b) => b.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.y >= label.y)
          .sort((a, b) => a.y - b.y)[0];
        return next ? { x: next.x + next.width / 2, y: next.y + next.height / 2 } : null;
      });
      if (!button) throw new Error('the field editor has no aggregation dropdown');
      await this.page.mouse.click(button.x, button.y);
      await this.page
        .locator('.cdk-overlay-container [role=menuitem], .cdk-overlay-container [role=option]')
        .first()
        .waitFor({ timeout: 3_000 })
        .catch(() => undefined);
      const option = await this.page.evaluate((name) => {
        const items = [
          ...document.querySelectorAll<HTMLElement>(
            '.cdk-overlay-container [role=menuitem], .cdk-overlay-container [role=option]',
          ),
        ];
        const hit = items.find(
          (e) => e.getBoundingClientRect().width > 0 && e.innerText.trim() === name,
        );
        if (hit) hit.click();
        return items
          .filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => e.innerText.trim());
      }, edit.aggregation);
      if (!option.includes(edit.aggregation)) {
        await this.closeOverlay();
        throw new Error(
          `aggregation "${edit.aggregation}" is not offered for this field (it offers ${option.join(', ')})`,
        );
      }
      await sleep(400);
    }
    await this.closeOverlay();
  }

  // The field editor ignores Escape; a click on its transparent backdrop closes it.
  private async closeOverlay(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const backdrop = this.page.locator('.cdk-overlay-backdrop-showing').last();
      if (!(await backdrop.count())) return;
      await backdrop.click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
      await sleep(400);
    }
  }

  // ── Properties panel settings ──────────────────────────────────────────

  async openTab(tab: 'Setup' | 'Style'): Promise<void> {
    const tabEl = this.page.locator(`${SEL.propertiesPanel} [role=tab]`, { hasText: tab }).first();
    if ((await tabEl.count()) === 0) return;
    if ((await tabEl.getAttribute('aria-selected')) !== 'true') {
      await tabEl.click();
      await sleep(600);
    }
  }

  // Everything the current panel lets you change, with its current value.
  async listSettings(): Promise<SettingInfo[]> {
    return this.page
      .locator(SEL.propertiesPanel)
      .first()
      .evaluate((panel) => {
        const out: Array<{ kind: 'toggle' | 'field' | 'radio'; label: string; value: string }> = [];
        for (const s of panel.querySelectorAll<HTMLElement>('button[role=switch][aria-label]')) {
          out.push({
            kind: 'toggle',
            label: s.getAttribute('aria-label')!,
            value: s.getAttribute('aria-checked') === 'true' ? 'on' : 'off',
          });
        }
        for (const f of panel.querySelectorAll<HTMLElement>('mat-form-field')) {
          const label = f.querySelector('mat-label, label')?.textContent?.trim();
          if (!label) continue;
          const input = f.querySelector<HTMLInputElement>('input');
          const color = f.querySelector<HTMLElement>('[style*="background"]');
          const value =
            input?.value ||
            f.querySelector('.mat-mdc-select-value')?.textContent?.trim() ||
            color?.style.backgroundColor ||
            '';
          out.push({ kind: 'field', label, value });
        }
        for (const r of panel.querySelectorAll<HTMLInputElement>('input[type=radio][aria-label]')) {
          out.push({
            kind: 'radio',
            label: r.getAttribute('aria-label')!.replace(/^radio button: /, ''),
            value: r.checked ? 'selected' : '',
          });
        }
        return out;
      });
  }

  // Applies {label: value} to the open panel. Labels may end in "#2" to pick
  // the second control with the same label (e.g. the Y axis "Font size").
  async applySettings(
    settings: StyleSettings,
    scope: string = SEL.propertiesPanel,
  ): Promise<string[]> {
    const missing: string[] = [];
    for (const [rawLabel, value] of Object.entries(settings)) {
      const match = /^(.*?)(?:#(\d+))?$/.exec(rawLabel.trim())!;
      const label = match[1]!.trim();
      const nth = match[2] ? Number(match[2]) - 1 : 0;
      const ok = await this.step(`set "${rawLabel}"`, () =>
        this.applyOne(scope, label, nth, value),
      );
      if (!ok) missing.push(rawLabel);
      await sleep(350);
    }
    await this.settle(500);
    return missing;
  }

  private async applyOne(
    scope: string,
    label: string,
    nth: number,
    value: string | number | boolean,
  ): Promise<boolean> {
    const panel = this.page.locator(scope).first();

    const toggle = panel.locator(`button[role=switch][aria-label="${cssEscape(label)}"]`).nth(nth);
    if (await toggle.count()) {
      const on = (await toggle.getAttribute('aria-checked')) === 'true';
      const want = value === true || value === 'on' || value === 'true';
      if (on !== want) await toggle.click();
      return true;
    }

    const radio = panel
      .locator(
        `input[type=radio][aria-label="radio button: ${cssEscape(typeof value === 'string' ? value : label)}"]`,
      )
      .nth(nth);
    if ((typeof value === 'string' || value === true) && (await radio.count())) {
      await radio.check({ force: true });
      return true;
    }

    const field = await this.findField(scope, label, nth);
    if (!field) return false;

    if (typeof value === 'string' && HEX_COLOR_RE.test(value)) {
      await field.click();
      await this.pickCustomColor(value);
      return true;
    }

    if (await field.locator('mat-select').count()) {
      await field.locator('mat-select').first().click();
      const option = this.page.getByRole('option', { name: String(value), exact: true });
      if (!(await option.count())) {
        const options = await this.page.getByRole('option').allTextContents();
        await this.page.keyboard.press('Escape');
        throw new Error(
          `"${value}" is not an option of "${label}" (options: ${options.map((o) => o.trim()).join(', ')})`,
        );
      }
      await option.first().click();
      return true;
    }

    const input = field.locator('input, textarea').first();
    if (await input.count()) {
      await input.fill(String(value));
      await input.press('Enter');
      return true;
    }
    return false;
  }

  private async findField(scope: string, label: string, nth: number): Promise<Locator | null> {
    const fields = this.page.locator(`${scope} mat-form-field`);
    const labels = await fields.evaluateAll((els) =>
      els.map((e) => e.querySelector('mat-label, label')?.textContent?.trim() ?? ''),
    );
    const indexes = labels.flatMap((l, i) => (l.toLowerCase() === label.toLowerCase() ? [i] : []));
    const index = indexes[nth];
    if (index !== undefined) return fields.nth(index);
    // Some settings (Layout › Navigation type) put the label in a cell of its
    // own: the control is in the next cell that holds one.
    const cells = this.page.locator(`${scope} [data-webdriver-cell-key]`);
    const cellIndex = await cells.evaluateAll(
      (els, { wanted, nth }) => {
        const hits = els.flatMap((e, i) =>
          e.querySelector('label.value')?.textContent?.trim().toLowerCase() === wanted ? [i] : [],
        );
        const at = hits[nth];
        if (at === undefined) return -1;
        return els.findIndex((e, i) => i > at && e.querySelector('mat-select, input') !== null);
      },
      { wanted: label.toLowerCase(), nth },
    );
    return cellIndex < 0 ? null : cells.nth(cellIndex);
  }

  // ── Report-level actions ───────────────────────────────────────────────

  async rename(name: string): Promise<void> {
    await this.step('rename the report', async () => {
      await this.page.locator('.ng2-editable-label').first().click();
      await this.page.keyboard.press('ControlOrMeta+A');
      await this.page.keyboard.type(name);
      await this.page.keyboard.press('Enter');
    });
    await this.settle();
  }

  // First save of a new report; returns its id.
  async saveNew(): Promise<string> {
    return this.step('save the new report', async () => {
      await this.page.getByRole('button', { name: 'Save and share' }).click();
      await this.page
        .getByRole('button', { name: 'Acknowledge and save' })
        .click({ timeout: 10_000 })
        .catch(() => undefined);
      await this.page.waitForURL(/\/reporting\/[0-9a-f-]{36}/i, { timeout: this.timeoutMs });
      // Closes the share dialog some accounts get right after saving.
      await this.page
        .getByRole('button', { name: 'Done', exact: true })
        .click({ timeout: 3_000 })
        .catch(() => undefined);
      await this.settle();
      const id = this.reportIdFromUrl();
      if (!id) throw new Error('the report URL has no id');
      return id;
    });
  }
}
