import { describe, expect, it, vi } from 'vitest';

import {
  ReportNameMismatchError,
  addCalculatedField,
  addChart,
  addControl,
  addImage,
  addBinField,
  addEmbed,
  addGroupField,
  addLine,
  addParameter,
  addShape,
  addText,
  arrangeComponents,
  createBlend,
  deleteReport,
  manageFilter,
  managePage,
  setScopeSettings,
  listReports,
  setTheme,
  shareReport,
  updateComponent,
} from '@/contexts/reports/application/reportUseCases.js';
import type { ReportRepository } from '@/contexts/reports/domain/ReportRepository.js';
import { InvalidChartError, InvalidReportIdError } from '@/contexts/reports/domain/Report.js';

const ID = '1a2b3c4d-0000-4000-8000-1234567890ab';

const placed = { index: 0, kind: 'Text properties', layout: { x: 0, y: 0, width: 10, height: 10 } };

function fakeRepo(): ReportRepository {
  return {
    listReports: vi.fn(async () => [
      { id: ID, name: 'Sales - KPIs', url: 'u1' },
      { id: '2a2b3c4d-0000-4000-8000-1234567890ab', name: 'Other', url: 'u2' },
    ]),
    createReport: vi.fn(),
    addDataSource: vi.fn(),
    refreshDataSources: vi.fn(async () => []),
    addChart: vi.fn(async () => placed),
    addText: vi.fn(async () => placed),
    addShape: vi.fn(async () => placed),
    addControl: vi.fn(async () => placed),
    addImage: vi.fn(async () => placed),
    addCalculatedField: vi.fn(async () => undefined),
    addLine: vi.fn(async () => placed),
    addEmbed: vi.fn(async () => placed),
    duplicateComponent: vi.fn(async () => placed),
    arrangeComponents: vi.fn(async () => [placed]),
    managePage: vi.fn(async () => [{ index: 1, name: 'Overview' }]),
    setScopeSettings: vi.fn(async () => []),
    manageFilter: vi.fn(async () => undefined),
    addParameter: vi.fn(async () => undefined),
    addGroupField: vi.fn(async () => undefined),
    addBinField: vi.fn(async () => undefined),
    createBlend: vi.fn(async () => undefined),
    listComponents: vi.fn(async () => [placed]),
    describeComponent: vi.fn(),
    updateComponent: vi.fn(async () => placed),
    deleteComponent: vi.fn(async () => undefined),
    setTheme: vi.fn(async () => undefined),
    addPage: vi.fn(),
    renamePage: vi.fn(async () => undefined),
    listPages: vi.fn(),
    renameReport: vi.fn(),
    shareReport: vi.fn(async () => undefined),
    screenshot: vi.fn(),
    deleteReport: vi.fn(async () => undefined),
    copyReport: vi.fn(async () => ({ id: ID, name: 'Copy', url: 'u', replaced: [] })),
    setLinkSharing: vi.fn(async (_id, sharing) => sharing),
    scheduleDelivery: vi.fn(async () => ({})),
    getDelivery: vi.fn(async () => null),
    removeDelivery: vi.fn(async () => true),
    listVersions: vi.fn(async () => []),
    restoreVersion: vi.fn(),
    getEmbed: vi.fn(),
  };
}

describe('report use cases', () => {
  it('filters reports by name, ignoring case', async () => {
    expect((await listReports(fakeRepo(), 'sales')).map((r) => r.name)).toEqual([
      'Sales - KPIs',
    ]);
  });

  it('validates the chart and parses the report URL before editing', async () => {
    const repo = fakeRepo();
    await addChart(repo, `https://lookerstudio.google.com/reporting/${ID}/edit`, {
      type: 'bar',
      dimensions: ['feature'],
      metrics: [{ field: 'Record Count' }],
    });
    expect(repo.addChart).toHaveBeenCalledWith(ID, expect.objectContaining({ type: 'bar' }), {});

    await expect(addChart(repo, ID, { type: 'bar', dimensions: [], metrics: [] })).rejects.toThrow(
      InvalidChartError,
    );
    await expect(
      addChart(repo, 'nope', { type: 'bar', dimensions: ['x'], metrics: [{ field: 'y' }] }),
    ).rejects.toThrow(InvalidReportIdError);
  });

  it('normalizes the email when sharing', async () => {
    const repo = fakeRepo();
    await shareReport(
      repo,
      ID,
      [' Ana@Example.com ', 'ana@example.com', 'bo@example.com'],
      'viewer',
    );
    expect(repo.shareReport).toHaveBeenCalledWith(
      ID,
      ['ana@example.com', 'bo@example.com'],
      'viewer',
      true,
    );
    await expect(shareReport(repo, ID, ['not-an-email'], 'editor')).rejects.toThrow(
      InvalidChartError,
    );
    await expect(shareReport(repo, ID, [], 'editor')).rejects.toThrow(InvalidChartError);
  });

  it('deletes only when the name matches', async () => {
    const repo = fakeRepo();
    await expect(deleteReport(repo, ID, 'Other')).rejects.toThrow(ReportNameMismatchError);
    expect(repo.deleteReport).not.toHaveBeenCalled();
    await deleteReport(repo, ID, 'Sales - KPIs');
    expect(repo.deleteReport).toHaveBeenCalledWith(ID);
  });

  it('checks text colors and font size', async () => {
    const repo = fakeRepo();
    await addText(
      repo,
      ID,
      { text: 'Title', color: '#FFFFFF', fontSize: 28 },
      { layout: { x: 40, y: 20 } },
    );
    expect(repo.addText).toHaveBeenCalledWith(ID, expect.objectContaining({ text: 'Title' }), {
      layout: { x: 40, y: 20 },
    });
    await expect(addText(repo, ID, { text: '  ' })).rejects.toThrow(InvalidChartError);
    await expect(addText(repo, ID, { text: 'x', color: 'white' })).rejects.toThrow(
      InvalidChartError,
    );
    await expect(addText(repo, ID, { text: 'x', fontSize: 2 })).rejects.toThrow(InvalidChartError);
  });

  it('checks shape colors and style settings', async () => {
    const repo = fakeRepo();
    await expect(addShape(repo, ID, { shape: 'star', borderColor: '#12' })).rejects.toThrow(
      InvalidChartError,
    );
    await expect(
      addShape(repo, ID, { shape: 'circle' }, { style: { 'Bar color': '#purple' } }),
    ).rejects.toThrow(InvalidChartError);
    await addShape(
      repo,
      ID,
      { shape: 'rectangle', background: '#151B33' },
      { style: { Opacity: '50%' } },
    );
    expect(repo.addShape).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty component update but accepts a restack', async () => {
    const repo = fakeRepo();
    await expect(updateComponent(repo, ID, 0, {})).rejects.toThrow(InvalidChartError);
    await updateComponent(repo, ID, 2, { order: 'back' });
    expect(repo.updateComponent).toHaveBeenCalledWith(ID, 2, { order: 'back' }, undefined);
  });

  it('accepts a data-only component update', async () => {
    const repo = fakeRepo();
    await updateComponent(repo, ID, 1, { dateRange: 'Last 28 days' });
    expect(repo.updateComponent).toHaveBeenCalledWith(
      ID,
      1,
      { dateRange: 'Last 28 days' },
      undefined,
    );
  });

  it('validates controls before placing them', async () => {
    const repo = fakeRepo();
    await expect(addControl(repo, ID, { kind: 'slider' })).rejects.toThrow(InvalidChartError);
    await addControl(repo, ID, { kind: 'drop_down', field: 'platform' }, { dataSource: 'bq' });
    expect(repo.addControl).toHaveBeenCalledWith(
      ID,
      { kind: 'drop_down', field: 'platform' },
      { dataSource: 'bq' },
    );
  });

  it('only uploads existing image files', async () => {
    const repo = fakeRepo();
    await expect(addImage(repo, ID, { path: '/tmp/logo.pdf' })).rejects.toThrow(/png/);
    await expect(addImage(repo, ID, { path: '/tmp/logo.png' }, {}, () => null)).rejects.toThrow(
      /No file/,
    );
    await expect(addImage(repo, ID, { path: '/tmp/logo.png' }, {}, () => 0)).rejects.toThrow(
      /empty/,
    );
    await addImage(repo, ID, { path: '/tmp/logo.png' }, {}, () => 2048);
    expect(repo.addImage).toHaveBeenCalledOnce();
  });

  it('trims calculated fields and refuses empty ones', async () => {
    const repo = fakeRepo();
    await expect(addCalculatedField(repo, ID, { name: ' ', formula: 'x' })).rejects.toThrow(
      InvalidChartError,
    );
    await addCalculatedField(repo, ID, { name: ' Ratio ', formula: ' SUM(a)/SUM(b) ' }, ' ');
    expect(repo.addCalculatedField).toHaveBeenCalledWith(
      ID,
      { name: 'Ratio', formula: 'SUM(a)/SUM(b)' },
      undefined,
    );
  });

  it('accepts layout settings alone in the theme', async () => {
    const repo = fakeRepo();
    await setTheme(repo, ID, { layout: { 'Navigation type': 'Tab' } });
    expect(repo.setTheme).toHaveBeenCalledOnce();
  });

  it('needs something to change in the theme', async () => {
    const repo = fakeRepo();
    await expect(setTheme(repo, ID, {})).rejects.toThrow(InvalidChartError);
    await setTheme(repo, ID, {
      preset: 'Simple Dark',
      settings: { 'Report background color': '#0B1020' },
    });
    expect(repo.setTheme).toHaveBeenCalledOnce();
  });

  it('checks AND/OR filters, fixed dates and the new data settings', async () => {
    const repo = fakeRepo();
    await updateComponent(repo, ID, 0, {
      filters: [
        {
          name: 'Mobile',
          clauses: [
            [
              { field: 'platform', condition: 'equals', values: ['android'] },
              { field: 'platform', condition: 'equals', values: ['ios'] },
            ],
          ],
        },
      ],
      dateRange: '2026-10-01..2026-10-15',
      sorts: [{ field: 'feature' }],
      referenceBands: [{ from: 1, to: 2, color: '#FFE082' }],
    });
    expect(repo.updateComponent).toHaveBeenCalled();
    await expect(
      updateComponent(repo, ID, 0, { dateRange: '2026-10-15..2026-10-01' }),
    ).rejects.toThrow(InvalidChartError);
    await expect(
      updateComponent(repo, ID, 0, { filters: [{ name: 'Empty', clauses: [[]] }] }),
    ).rejects.toThrow(InvalidChartError);
    await expect(
      updateComponent(repo, ID, 0, { referenceBands: [{ from: 3, to: 1 }] }),
    ).rejects.toThrow(InvalidChartError);
    await expect(
      updateComponent(repo, ID, 0, {
        conditionalFormats: [{ rules: [[{ field: 'x', condition: 'gt', value: '1' }]] }],
      }),
    ).rejects.toThrow(InvalidChartError);
  });

  it('accepts a chart type switch, a button and an embed URL as changes', async () => {
    const repo = fakeRepo();
    await updateComponent(repo, ID, 0, { chartType: 'line' });
    await updateComponent(repo, ID, 0, { button: { action: 'link', page: 'Overview' } });
    await expect(updateComponent(repo, ID, 0, { embedUrl: 'ftp://x' })).rejects.toThrow(
      InvalidChartError,
    );
    await expect(updateComponent(repo, ID, 0, { button: { action: 'link' } })).rejects.toThrow(
      InvalidChartError,
    );
  });

  it('checks lines, embeds, arrange and pages', async () => {
    const repo = fakeRepo();
    await addLine(repo, ID, { from: { x: 0, y: 10 }, to: { x: 100, y: 10 } });
    await expect(addLine(repo, ID, { from: { x: 5, y: 5 }, to: { x: 5, y: 5 } })).rejects.toThrow(
      InvalidChartError,
    );
    await addEmbed(repo, ID, 'https://example.com');
    await expect(arrangeComponents(repo, ID, [1, 2], 'distribute_horizontally')).rejects.toThrow(
      InvalidChartError,
    );
    await arrangeComponents(repo, ID, [1, 1, 2], 'align_left');
    expect(repo.arrangeComponents).toHaveBeenCalledWith(ID, [1, 2], 'align_left', undefined);
    await expect(managePage(repo, ID, 0, 'delete')).rejects.toThrow(InvalidChartError);
  });

  it('needs something to set on a page and an edit for a filter', async () => {
    const repo = fakeRepo();
    await expect(setScopeSettings(repo, ID, 'page', {})).rejects.toThrow(InvalidChartError);
    await setScopeSettings(repo, ID, 'report', { dateRange: 'Last 28 days' });
    await expect(manageFilter(repo, ID, 'edit', 'Mobile')).rejects.toThrow(InvalidChartError);
    await manageFilter(repo, ID, 'delete', ' Mobile ');
    expect(repo.manageFilter).toHaveBeenCalledWith(ID, 'delete', 'Mobile', undefined);
  });

  it('checks parameters, groups, bins and blends', async () => {
    const repo = fakeRepo();
    await expect(addParameter(repo, ID, { name: 'Goal', id: '1bad' })).rejects.toThrow(
      InvalidChartError,
    );
    await addParameter(repo, ID, { name: 'Goal', id: 'goal', dataType: 'Number (whole)' });
    await expect(
      addGroupField(repo, ID, { name: 'G', field: 'platform', groups: [] }),
    ).rejects.toThrow(InvalidChartError);
    await expect(addBinField(repo, ID, { name: 'B', field: 'ms', size: 0 })).rejects.toThrow(
      InvalidChartError,
    );
    const tables = [
      { dataSource: 'a', dimensions: ['uid'], metrics: [] },
      { dataSource: 'b', dimensions: ['uid'], metrics: ['Record Count'] },
    ];
    await expect(createBlend(repo, ID, { name: 'AB', tables, joins: [] })).rejects.toThrow(
      InvalidChartError,
    );
    await createBlend(repo, ID, {
      name: 'AB',
      tables,
      joins: [{ type: 'inner', keys: [['uid', 'uid']] }],
    });
    expect(repo.createBlend).toHaveBeenCalled();
  });
});
