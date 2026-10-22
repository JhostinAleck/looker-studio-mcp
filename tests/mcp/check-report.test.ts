import { describe, expect, it, vi } from 'vitest';

import { checkReport } from '@/contexts/reports/application/reportUseCases.js';
import { InvalidChartError, classifyChartError } from '@/contexts/reports/domain/Report.js';
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
});
