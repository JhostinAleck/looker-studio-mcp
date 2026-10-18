import { describe, expect, it, vi } from 'vitest';

import {
  ReportNameMismatchError,
  addCalculatedField,
  addChart,
  addControl,
  addImage,
  addShape,
  addText,
  deleteReport,
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
      { id: ID, name: 'CampusFind - BQs', url: 'u1' },
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
    listComponents: vi.fn(async () => [placed]),
    describeComponent: vi.fn(),
    updateComponent: vi.fn(async () => placed),
    deleteComponent: vi.fn(async () => undefined),
    setTheme: vi.fn(async () => undefined),
    addPage: vi.fn(),
    listPages: vi.fn(),
    renameReport: vi.fn(),
    shareReport: vi.fn(async () => undefined),
    screenshot: vi.fn(),
    deleteReport: vi.fn(async () => undefined),
  };
}

describe('report use cases', () => {
  it('filters reports by name, ignoring case', async () => {
    expect((await listReports(fakeRepo(), 'campus')).map((r) => r.name)).toEqual([
      'CampusFind - BQs',
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
    await deleteReport(repo, ID, 'CampusFind - BQs');
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
});
