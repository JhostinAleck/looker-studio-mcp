import { describe, expect, it } from 'vitest';

import {
  InvalidChartError,
  InvalidReportIdError,
  parseReportId,
  reportUrl,
  validateChart,
  validateControl,
} from '@/contexts/reports/domain/Report.js';
import { datePresetPath } from '@/contexts/reports/infrastructure/ui/selectors.js';
import { buildLinkingUrl } from '@/contexts/reports/domain/linking.js';

const ID = '1a2b3c4d-0000-4000-8000-1234567890ab';

describe('parseReportId', () => {
  it('reads the id from a report URL', () => {
    expect(parseReportId(`https://lookerstudio.google.com/u/0/reporting/${ID}/page/p_x/edit`)).toBe(
      ID,
    );
  });

  it('accepts a bare id and rejects anything else', () => {
    expect(parseReportId(ID.toUpperCase())).toBe(ID);
    expect(() => parseReportId('not-a-report')).toThrow(InvalidReportIdError);
  });

  it('builds view and edit URLs', () => {
    expect(reportUrl(ID)).toBe(`https://lookerstudio.google.com/reporting/${ID}`);
    expect(reportUrl(ID, 'edit')).toBe(`https://lookerstudio.google.com/reporting/${ID}/edit`);
  });
});

describe('validateChart', () => {
  const metric = [{ field: 'Record Count' }];

  it('accepts a bar chart with one dimension and a breakdown', () => {
    const spec = {
      type: 'bar' as const,
      dimensions: ['feature'],
      metrics: metric,
      breakdown: 'platform',
    };
    expect(validateChart(spec)).toBe(spec);
  });

  it('rejects shapes the chart cannot show', () => {
    expect(() => validateChart({ type: 'bar', dimensions: [], metrics: metric })).toThrow(
      InvalidChartError,
    );
    expect(() => validateChart({ type: 'scorecard', dimensions: ['x'], metrics: metric })).toThrow(
      InvalidChartError,
    );
    expect(() => validateChart({ type: 'table', dimensions: [], metrics: metric })).toThrow(
      InvalidChartError,
    );
    expect(() => validateChart({ type: 'pie', dimensions: ['x'], metrics: [] })).toThrow(
      InvalidChartError,
    );
    expect(() =>
      validateChart({ type: 'pie', dimensions: ['x'], metrics: metric, breakdown: 'y' }),
    ).toThrow(InvalidChartError);
  });
});

describe('chart shapes beyond the basics', () => {
  const metric = [{ field: 'Record Count' }];

  it('takes a histogram without metrics and a sankey with two dimensions', () => {
    expect(validateChart({ type: 'histogram', dimensions: ['age'], metrics: [] }).type).toBe(
      'histogram',
    );
    expect(() =>
      validateChart({ type: 'histogram', dimensions: ['age'], metrics: metric }),
    ).toThrow(/exactly 0 metrics/);
    expect(() => validateChart({ type: 'sankey', dimensions: ['a'], metrics: metric })).toThrow(
      /at least 2 dimensions/,
    );
  });

  it('lets maps and timelines fill their own slots, but not stay empty', () => {
    const timeline = {
      type: 'timeline' as const,
      dimensions: [],
      metrics: [],
      fields: { 'Row label': ['event_id'], 'Start time': ['occurred_at'] },
    };
    expect(validateChart(timeline)).toBe(timeline);
    expect(() => validateChart({ type: 'bubble_map', dimensions: [], metrics: [] })).toThrow(
      /needs fields/,
    );
  });

  it('checks filters, series and value colors', () => {
    const base = { type: 'combo' as const, dimensions: ['day'], metrics: metric };
    expect(() =>
      validateChart({ ...base, filters: [{ name: 'Android', field: 'platform' }] }),
    ).toThrow(/no condition/);
    expect(() =>
      validateChart({ ...base, filters: [{ name: 'Android', condition: 'equals' }] }),
    ).toThrow(/no field/);
    expect(() => validateChart({ ...base, series: [{ metric: 'Uses', color: 'red' }] })).toThrow(
      /#RRGGBB/,
    );
    expect(() => validateChart({ ...base, valueColors: { android: '#12345' } })).toThrow(/#RRGGBB/);
    expect(
      validateChart({
        ...base,
        filters: [{ name: 'Android only' }],
        series: [{ metric: 'Uses', type: 'line', axis: 'right', color: '#FF6D00' }],
      }).series,
    ).toHaveLength(1);
  });
});

describe('validateControl', () => {
  it('needs a field except for date range, data control, button and preset filter', () => {
    expect(() => validateControl({ kind: 'drop_down' })).toThrow(/needs the field/);
    expect(validateControl({ kind: 'drop_down', field: 'platform' }).kind).toBe('drop_down');
    expect(validateControl({ kind: 'date_range', dateRange: 'Last 28 days' }).kind).toBe(
      'date_range',
    );
    expect(() =>
      validateControl({ kind: 'drop_down', field: 'x', comparison: 'Previous period' }),
    ).toThrow(InvalidChartError);
  });
});

describe('datePresetPath', () => {
  it('finds presets in their submenu, ignoring case', () => {
    expect(datePresetPath('last 28 days')).toEqual(['Last 7 days', 'Last 28 days']);
    expect(datePresetPath('This month')).toEqual(['This month', 'This month']);
    expect(datePresetPath('Yesterday')).toEqual(['Yesterday']);
    expect(() => datePresetPath('Last 3 days')).toThrow(/not a date range preset/);
  });
});

describe('buildLinkingUrl', () => {
  const source = { projectId: 'p-12345', datasetId: 'd', tableId: 't', name: 'BQ' };

  it('uses the wildcard alias without a template', () => {
    const url = new URL(buildLinkingUrl({ reportName: 'Dash', sources: [source] }));
    expect(url.searchParams.get('ds.*.connector')).toBe('bigQuery');
    expect(url.searchParams.get('ds.*.tableId')).toBe('t');
    expect(url.searchParams.get('c.reportId')).toBeNull();
    expect(url.searchParams.get('r.reportName')).toBe('Dash');
  });

  it('maps sources to template aliases', () => {
    const url = new URL(
      buildLinkingUrl({
        reportName: 'Copy',
        templateReportId: 'abc',
        sources: [source, { ...source, alias: 'ds7' }],
      }),
    );
    expect(url.searchParams.get('c.reportId')).toBe('abc');
    expect(url.searchParams.get('ds.ds0.datasetId')).toBe('d');
    expect(url.searchParams.get('ds.ds7.projectId')).toBe('p-12345');
  });
});
