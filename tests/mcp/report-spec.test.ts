import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cssColorToHex, dateRangeFromLabel } from '@/contexts/reports/domain/Report.js';
import { conditionAlias } from '@/contexts/reports/infrastructure/ui/selectors.js';
import type { ReportSnapshot } from '@/contexts/reports/domain/ReportRepository.js';
import { snapshotToSpec, specToActions } from '@/mcp/report-spec.js';
import { reportSpecSchema } from '@/mcp/schemas.js';
import { type BatchDeps, checkActions } from '@/mcp/tools/batch-actions.js';
import type { AuditLogger } from '@/shared-kernel/audit/AuditLogger.js';
import { WritesGate } from '@/shared-kernel/writes/WritesGate.js';

const box = { x: 40, y: 20, width: 400, height: 60 };

const snapshot: ReportSnapshot = {
  name: 'Sales',
  theme: 'Simple Dark',
  canvas: { width: 1200, height: 900 },
  dataSources: [
    { name: 'orders', source: { projectId: 'p', datasetId: 'shop', tableId: 'orders' } },
    { name: 'By country', source: { projectId: 'p', sql: 'SELECT 1 AS n', name: 'By country' } },
    { name: 'Sheet' },
  ],
  pages: [
    {
      name: 'Overview',
      components: [
        { kind: 'text', layout: box, text: { text: 'Sales', fontSize: 28, bold: true } },
        {
          kind: 'chart',
          layout: { x: 40, y: 100, width: 500, height: 300 },
          chart: {
            type: 'bar',
            dimensions: ['country'],
            metrics: [{ field: 'Record Count', label: 'Orders' }],
            title: 'Orders by country',
          },
          dataSource: 'orders',
          style: { 'Display legend': false },
        },
        { kind: 'other', layout: box, panel: 'Community viz' },
      ],
    },
    {
      name: 'Details',
      components: [
        { kind: 'control', layout: box, control: 'drop_down', field: 'country' },
        { kind: 'line', layout: box, from: { x: 0, y: 10 }, to: { x: 100, y: 10 } },
      ],
    },
  ],
};

describe('report specs', () => {
  it('turns CSS colors into #RRGGBB', () => {
    expect(cssColorToHex('rgb(11, 16, 32)')).toBe('#0B1020');
    expect(cssColorToHex('rgba(255, 255, 255, 1)')).toBe('#FFFFFF');
    expect(cssColorToHex('#abcdef')).toBe('#ABCDEF');
    expect(cssColorToHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(cssColorToHex('transparent')).toBeNull();
  });

  it('exports a snapshot as a spec in the tools argument names', () => {
    const spec = reportSpecSchema.parse(snapshotToSpec(snapshot));
    expect(spec.theme).toEqual({ preset: 'Simple Dark', canvas: { width: 1200, height: 900 } });
    // A source whose connection could not be read is left out.
    expect(spec.data_sources).toEqual([
      { name: 'orders', project_id: 'p', dataset_id: 'shop', table_id: 'orders' },
      { name: 'By country', project_id: 'p', sql: 'SELECT 1 AS n' },
    ]);
    expect(spec.pages[0]!.components[1]).toMatchObject({
      component: 'chart',
      type: 'bar',
      dimensions: ['country'],
      metrics: [{ field: 'Record Count', label: 'Orders' }],
      title: 'Orders by country',
      data_source: 'orders',
      style: { 'Display legend': false },
    });
    expect(spec.pages[1]!.components[0]).toMatchObject({
      component: 'control',
      kind: 'drop_down',
      field: 'country',
    });
  });

  it('builds a new report: theme, extra sources, first page renamed, the rest added', () => {
    const spec = reportSpecSchema.parse(snapshotToSpec(snapshot));
    const { actions, notes } = specToActions(spec, {
      pages: ['Page 1'],
      layouts: [[]],
      dataSources: ['orders'],
      fresh: true,
    });
    expect(actions.map((a) => a.tool)).toEqual([
      'set_theme',
      'add_data_source',
      'rename_page',
      'add_text',
      'add_chart',
      'add_page',
      'add_control',
      'add_line',
    ]);
    expect(actions[1]!.args).toEqual({
      project_id: 'p',
      sql: 'SELECT 1 AS n',
      source_name: 'By country',
    });
    expect(actions[2]!.args).toEqual({ page: 1, name: 'Overview' });
    expect(actions[4]!.args).toMatchObject({ page: 1, type: 'bar' });
    expect(actions[4]!.args).not.toHaveProperty('component');
    expect(actions[6]!.args).toMatchObject({ page: 2, kind: 'drop_down' });
    expect(notes).toEqual([
      'page "Overview" component 2 (Community viz) cannot be rebuilt; skipped.',
    ]);
  });

  it('updates a report with only what it lacks', () => {
    const spec = reportSpecSchema.parse(snapshotToSpec(snapshot));
    const { actions } = specToActions(spec, {
      pages: ['Overview'],
      layouts: [[{ ...box, x: 42 }]],
      dataSources: ['orders', 'By country'],
      fresh: false,
    });
    expect(actions.map((a) => a.tool)).toEqual([
      'set_theme',
      'add_chart',
      'add_page',
      'add_control',
      'add_line',
    ]);
    expect(actions[3]!.args).toMatchObject({ page: 2 });
  });

  it('accepts the example of docs/report-spec.md, every action included', async () => {
    const doc = readFileSync('docs/report-spec.md', 'utf8');
    const example = /```json\n([\s\S]*?)\n```/.exec(doc)![1]!;
    const spec = reportSpecSchema.parse(JSON.parse(example));
    // Its image file sits next to the spec: put one there.
    const dir = mkdtempSync(join(tmpdir(), 'spec-'));
    for (const page of spec.pages)
      for (const c of page.components)
        if (c.component === 'image') {
          mkdirSync(dirname(join(dir, c.image)), { recursive: true });
          writeFileSync(join(dir, c.image), 'png');
          c.image = join(dir, c.image);
        }
    const { actions } = specToActions(spec, {
      pages: ['Page 1'],
      layouts: [[]],
      dataSources: ['events'],
      fresh: true,
    });
    // The example's custom query is dry-run while the actions are checked.
    const dryRun = {
      schema: [],
      rows: [],
      totalRows: 0,
      bytesProcessed: 0,
      cacheHit: false,
      truncated: false,
    };
    const deps = {
      reportRepo: {},
      bigQueryRepo: { query: async () => dryRun },
      queryLimits: { location: 'US', maxRows: 100, maxBytesBilled: 10 },
      defaultProject: undefined,
      writesGate: new WritesGate({ configEnabled: true, cliFlag: true }),
      auditLogger: { recordWriteAttempt: () => undefined } as unknown as AuditLogger,
    } as unknown as BatchDeps;
    await expect(
      checkActions(deps, '1a2b3c4d-0000-4000-8000-1234567890ab', actions),
    ).resolves.toBeUndefined();
    expect(actions.map((a) => a.tool)).toContain('add_calculated_field');
  });
});

// ── Data settings, formats, fields and settings ──

const full: ReportSnapshot = {
  name: 'Usage',
  dataSources: [
    { name: 'events', source: { projectId: 'p', datasetId: 'a', tableId: 'events' } },
    { name: 'Lost', source: { projectId: 'p', sql: 'SELECT 1 AS n', name: 'Lost' } },
  ],
  fields: [
    {
      dataSource: 'events',
      calculatedFields: [{ name: 'Users', formula: 'COUNT_DISTINCT(uid)' }],
      parameters: [
        { name: 'Target', id: 'target', dataType: 'Number (whole)', defaultValue: '10' },
      ],
      groups: [
        {
          name: 'Platform group',
          field: 'platform',
          groups: [{ name: 'Android', condition: 'in', values: ['android'] }],
          otherGroup: 'Other',
        },
      ],
      bins: [],
    },
    {
      dataSource: 'Lost',
      calculatedFields: [],
      parameters: [],
      groups: [],
      bins: [{ name: 'Days bin', field: 'days', size: 5, min: 0, max: 60 }],
    },
  ],
  blends: [
    {
      name: 'Both',
      tables: [
        { dataSource: 'events', dimensions: ['day'], metrics: ['Record Count'] },
        { dataSource: 'Lost', dimensions: ['reported_on'], metrics: ['days'] },
      ],
      joins: [{ type: 'left outer', keys: [['day', 'reported_on']] }],
    },
  ],
  settings: {
    filters: [{ name: 'Has platform', field: 'platform', condition: 'is_null', exclude: true }],
  },
  pages: [
    {
      name: 'Overview',
      settings: {
        dataSource: 'events',
        dateRangeDimension: 'day',
        dateRange: 'Last 30 days',
        style: { 'Page background': '#FAFAFA' },
      },
      components: [
        {
          kind: 'text',
          layout: box,
          text: { text: 'Lost items', italic: true, underline: true, bold: true },
        },
        {
          kind: 'chart',
          layout: { x: 40, y: 100, width: 500, height: 300 },
          chart: {
            type: 'table',
            dimensions: ['feature_label'],
            metrics: [{ field: 'Record Count', label: 'Uses' }],
            labels: { feature_label: 'Feature' },
            filters: [
              {
                name: 'Android or iOS',
                clauses: [
                  [
                    { field: 'platform', condition: 'equals', values: ['android'] },
                    { field: 'platform', condition: 'equals', values: ['ios'] },
                  ],
                ],
              },
            ],
            dateRange: '2026-09-01..2026-10-15',
            comparison: 'Previous period',
            sorts: [{ field: 'platform', ascending: true }],
            conditionalFormats: [
              {
                rules: [[{ field: 'Uses', condition: 'gt', value: '5' }]],
                applyTo: 'Entire row',
                backgroundColor: '#C8E6C9',
              },
            ],
            series: [{ metric: 'Uses', type: 'bars', axis: 'left', color: '#4285F4' }],
            referenceLines: [{ value: 5, label: 'Target', color: '#FF0000' }],
            referenceBands: [{ from: 0, to: 2, color: '#FFF3E0' }],
            valueColors: { android: '#3DDC84' },
          },
          dataSource: 'events',
        },
        {
          kind: 'control',
          layout: box,
          control: 'drop_down',
          field: 'platform',
          data: {
            filters: [
              {
                name: 'No web',
                field: 'platform',
                condition: 'equals',
                values: ['web'],
                exclude: true,
              },
            ],
          },
        },
        {
          kind: 'image',
          layout: box,
          file: { name: 'logo.png', type: 'image/png', base64: 'iVBORw0KGgo=' },
        },
        { kind: 'image', layout: box, url: 'https://example.com/a.png' },
        {
          kind: 'line',
          layout: box,
          from: { x: 0, y: 10 },
          to: { x: 100, y: 10 },
          color: '#3F51B5',
          borderStyle: 'Dashed',
        },
      ],
    },
  ],
};

describe('report specs: everything a report holds', () => {
  const sink = (
    file: { type: string; base64: string },
    where: { page: number; index: number },
  ) => ({
    image: `images/page${where.page}-${where.index}.png`,
  });

  it('exports data settings, formats, fields, blends and settings in tool argument names', () => {
    const spec = reportSpecSchema.parse(snapshotToSpec(full, sink));
    expect(spec.parameters).toEqual([
      {
        name: 'Target',
        id: 'target',
        data_type: 'Number (whole)',
        default_value: '10',
        data_source: 'events',
      },
    ]);
    expect(spec.calculated_fields).toEqual([
      { name: 'Users', formula: 'COUNT_DISTINCT(uid)', data_source: 'events' },
    ]);
    expect(spec.group_fields?.[0]).toMatchObject({ other_group: 'Other', data_source: 'events' });
    expect(spec.bin_fields).toEqual([
      { name: 'Days bin', field: 'days', size: 5, min: 0, max: 60, data_source: 'Lost' },
    ]);
    expect(spec.blends?.[0]?.tables[1]).toEqual({
      data_source: 'Lost',
      dimensions: ['reported_on'],
      metrics: ['days'],
    });
    expect(spec.report_settings).toEqual({
      filters: [{ name: 'Has platform', field: 'platform', condition: 'is_null', exclude: true }],
    });
    expect(spec.pages[0]!.settings).toMatchObject({
      data_source: 'events',
      date_range_dimension: 'day',
      date_range: 'Last 30 days',
      style: { 'Page background': '#FAFAFA' },
    });
    const [text, chart, control, image, urlImage, line] = spec.pages[0]!.components;
    expect(text).toMatchObject({ italic: true, underline: true, bold: true });
    expect(chart).toMatchObject({
      labels: { feature_label: 'Feature' },
      date_range: '2026-09-01..2026-10-15',
      comparison: 'Previous period',
      sorts: [{ field: 'platform', ascending: true }],
      conditional_formats: [
        {
          rules: [[{ field: 'Uses', condition: 'gt', value: '5' }]],
          apply_to: 'Entire row',
          background_color: '#C8E6C9',
        },
      ],
      series: [{ metric: 'Uses', type: 'bars', axis: 'left', color: '#4285F4' }],
      reference_lines: [{ value: 5, label: 'Target', color: '#FF0000' }],
      reference_bands: [{ from: 0, to: 2, color: '#FFF3E0' }],
      value_colors: { android: '#3DDC84' },
    });
    expect(chart).toHaveProperty('filters.0.clauses.0.1.values', ['ios']);
    expect(control).toMatchObject({ filters: [{ name: 'No web', exclude: true }] });
    expect(image).toMatchObject({ component: 'image', image: 'images/page1-3.png' });
    expect(urlImage).toMatchObject({ component: 'image', image: 'https://example.com/a.png' });
    expect(line).toMatchObject({ color: '#3F51B5', border_style: 'Dashed' });
  });

  it('keeps an image without a sink as "other"', () => {
    const spec = reportSpecSchema.parse(snapshotToSpec(full));
    expect(spec.pages[0]!.components[3]).toMatchObject({ component: 'other' });
  });

  it('creates fields before pages and applies page settings after their components', () => {
    const spec = reportSpecSchema.parse(snapshotToSpec(full, sink));
    const { actions } = specToActions(spec, {
      pages: ['Page 1'],
      layouts: [[]],
      dataSources: ['events'],
      fresh: true,
    });
    expect(actions.map((a) => a.tool)).toEqual([
      'add_data_source',
      'add_parameter',
      'add_calculated_field',
      'add_group_field',
      'add_bin_field',
      'create_blend',
      'rename_page',
      'add_text',
      'add_chart',
      'add_control',
      'add_image',
      'add_image',
      'add_line',
      'set_page_settings',
      'set_page_settings',
    ]);
    expect(actions.at(-2)!.args).toMatchObject({
      scope: 'page',
      page: 1,
      date_range: 'Last 30 days',
    });
    expect(actions.at(-1)!.args).toMatchObject({ scope: 'report' });
  });

  it('adds only the fields, blends and page settings an existing report lacks', () => {
    const spec = reportSpecSchema.parse(snapshotToSpec(full, sink));
    const { actions, notes } = specToActions(spec, {
      pages: ['Overview'],
      layouts: [[]],
      dataSources: ['events', 'Lost'],
      fields: { events: ['Users', 'Target', 'platform'], Lost: [] },
      blends: ['Both'],
      fresh: false,
    });
    const tools = actions.map((a) => a.tool);
    expect(tools).toContain('add_group_field');
    expect(tools).toContain('add_bin_field');
    expect(tools).not.toContain('add_parameter');
    expect(tools).not.toContain('add_calculated_field');
    expect(tools).not.toContain('create_blend');
    expect(tools).not.toContain('set_page_settings');
    expect(notes).toContain('page "Overview" exists: its settings were left as they are.');
  });
});

describe('reading the editor back', () => {
  it('turns date picker labels into date ranges', () => {
    expect(dateRangeFromLabel('Sep 1, 2026 - Oct 15, 2026')).toBe('2026-09-01..2026-10-15');
    expect(dateRangeFromLabel('Last 28 days (exclude today)')).toBe('Last 28 days');
    expect(dateRangeFromLabel('This week (starts Monday)')).toBe('This week (starts Monday)');
    expect(dateRangeFromLabel('Auto date range')).toBeUndefined();
  });

  it('names conditions by their short alias', () => {
    expect(conditionAlias('Equal to (=)')).toBe('equals');
    expect(conditionAlias('GREATER THAN')).toBe('gt');
    expect(conditionAlias('Is Null')).toBe('is_null');
    expect(conditionAlias('NOT EQUAL TO')).toBe('NOT EQUAL TO');
  });
});
