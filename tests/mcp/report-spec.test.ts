import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { cssColorToHex } from '@/contexts/reports/domain/Report.js';
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
    const { actions } = specToActions(spec, {
      pages: ['Page 1'],
      layouts: [[]],
      dataSources: ['events'],
      fresh: true,
    });
    const deps = {
      reportRepo: {},
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
