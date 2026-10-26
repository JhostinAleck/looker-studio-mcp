import { describe, expect, it, vi } from 'vitest';

import { checkReport } from '@/contexts/reports/application/reportUseCases.js';
import {
  InvalidChartError,
  chartProblem,
  classifyChartError,
} from '@/contexts/reports/domain/Report.js';
import type { ReportRepository } from '@/contexts/reports/domain/ReportRepository.js';
import { formatReportCheck } from '@/mcp/tools/check-report.tool.js';

const ID = '05f7e8c3-e216-4d82-953f-467036b5c484';

describe('classifyChartError', () => {
  it('sorts Looker Studio error titles', () => {
    expect(classifyChartError('Too Many Rows')).toBe('data_set');
    expect(classifyChartError('User Configuration Error')).toBe('data_set');
    expect(classifyChartError('Data Set Configuration Error')).toBe('data_set');
    expect(classifyChartError('System error')).toBe('data_set');
    expect(classifyChartError('Invalid dimension')).toBe('configuration');
    expect(classifyChartError('Invalid configuration')).toBe('configuration');
    expect(classifyChartError('Missing fields')).toBe('configuration');
    expect(classifyChartError('Consent required')).toBe('consent');
    expect(classifyChartError('Something new')).toBe('error');
  });
});

describe('chartProblem', () => {
  const ok = { loading: false, noData: false };

  it('reports a chart still loading when the wait ended, before anything else', () => {
    expect(chartProblem({ ...ok, loading: true, noData: true }, 5_000)).toEqual({
      problem: 'loading',
      message: 'Still loading after 5 s',
    });
  });

  it('sorts an error card by its title and joins title and description', () => {
    expect(
      chartProblem(
        {
          ...ok,
          error: {
            title: 'Consent required',
            description: 'This component requires your consent to load data.',
          },
        },
        30_000,
      ),
    ).toEqual({
      problem: 'consent',
      message: 'Consent required: This component requires your consent to load data.',
    });
    expect(chartProblem({ ...ok, error: { title: 'Too Many Rows', description: '' } }, 1)).toEqual({
      problem: 'data_set',
      message: 'Too Many Rows',
    });
  });

  it('reports "No data" and a Vega chart that drew no points', () => {
    expect(chartProblem({ ...ok, noData: true }, 1)).toEqual({
      problem: 'no_data',
      message: 'No data',
    });
    expect(chartProblem({ ...ok, points: 0 }, 1)).toEqual({
      problem: 'no_data',
      message: 'No data: the chart draws empty axes',
    });
  });

  it('passes charts with data, or whose points could not be read', () => {
    expect(chartProblem({ ...ok, points: 5 }, 1)).toBeNull();
    expect(chartProblem(ok, 1)).toBeNull();
  });
});

describe('checkReport', () => {
  it('passes the timeout in ms and the page', async () => {
    const repo = { checkReport: vi.fn(async () => ({ pages: [], components: 0, problems: [] })) };
    await checkReport(repo as unknown as ReportRepository, ID, { page: 2, timeoutSeconds: 30 });
    expect(repo.checkReport).toHaveBeenCalledWith(ID, { page: 2, timeoutMs: 30_000 });
  });

  it('refuses a timeout out of range', async () => {
    await expect(checkReport({} as ReportRepository, ID, { timeoutSeconds: 1 })).rejects.toThrow(
      InvalidChartError,
    );
  });
});

describe('formatReportCheck', () => {
  it('says when every chart is fine', () => {
    expect(formatReportCheck({ pages: [{ index: 1 }], components: 3, problems: [] })).toBe(
      'Checked 1 page: 3 of 3 charts and controls OK.',
    );
  });

  it('lists each problem with its place, fields, message and details', () => {
    const out = formatReportCheck({
      pages: [
        { index: 1, name: 'Overview' },
        { index: 2, name: 'Detail' },
      ],
      components: 4,
      problems: [
        {
          page: 2,
          pageName: 'Detail',
          index: 1,
          kind: 'Table',
          title: 'Uses',
          fields: ['Dimension: feature'],
          problem: 'data_set',
          message: 'User Configuration Error: This data source was improperly configured.',
          details: 'The query returned an error. / boom',
        },
      ],
    });
    expect(out).toBe(
      'Checked 2 pages: 3 of 4 charts and controls OK.\n\n1 with problems:\n' +
        '- page 2 "Detail", #1 Table "Uses" (Dimension: feature): **data set**: User Configuration Error: This data source was improperly configured.\n' +
        '  Details: The query returned an error. / boom',
    );
  });

  it('explains consent problems once, after the list, for both kinds of source', () => {
    const consent = {
      page: 1,
      kind: 'Scorecard',
      problem: 'consent' as const,
      message: 'Consent required: This component requires your consent to load data.',
    };
    const out = formatReportCheck({
      pages: [{ index: 1 }],
      components: 2,
      consentDeclined: true,
      problems: [consent, { ...consent, index: 1 }].map((p, i) => ({ ...p, index: i })),
    });
    expect(out.match(/viewer's credentials, or a custom query/g)).toHaveLength(1);
    expect(out).toContain('@DS_USER_EMAIL');
    expect(out).toContain('declined the consent prompt instead of granting it');
    expect(out).toContain('update_data_source can set the credentials to owner');
    expect(out.endsWith('asks every viewer for consent whatever its credentials.')).toBe(true);
  });

  it('does not claim a declined prompt the check never saw', () => {
    const out = formatReportCheck({
      pages: [{ index: 1 }],
      components: 1,
      problems: [
        { page: 1, index: 0, kind: 'Table', problem: 'consent', message: 'Consent required' },
      ],
    });
    expect(out).not.toContain('declined');
    expect(out).toContain('does not grant consent on your behalf');
  });

  it('names the data source before the Setup fields', () => {
    const out = formatReportCheck({
      pages: [{ index: 1 }],
      components: 1,
      problems: [
        {
          page: 1,
          index: 0,
          kind: 'Bar chart',
          dataSource: 'events',
          fields: ['Dimension: feature'],
          problem: 'no_data',
          message: 'No data: the chart draws empty axes',
        },
      ],
    });
    expect(out).toContain(
      '#0 Bar chart (Data source: events, Dimension: feature): **no data**: No data: the chart draws empty axes',
    );
  });

  it('adds no consent note to other problems', () => {
    const out = formatReportCheck({
      pages: [{ index: 1 }],
      components: 1,
      problems: [{ page: 1, index: 0, kind: 'Table', problem: 'no_data', message: 'No data' }],
    });
    expect(out).not.toContain('consent');
  });
});
