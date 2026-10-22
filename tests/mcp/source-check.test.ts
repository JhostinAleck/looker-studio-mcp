import { describe, expect, it, vi } from 'vitest';

import type { BigQueryRepository } from '@/contexts/bigquery/domain/BigQueryRepository.js';
import { SourceQueryRejectedError } from '@/contexts/bigquery/domain/sql.js';
import { GoogleApiError } from '@/contexts/google-api/domain/GoogleApiError.js';
import type { ReportRepository } from '@/contexts/reports/domain/ReportRepository.js';
import { QueryParameterError } from '@/contexts/reports/domain/Report.js';
import { handleCreateReport } from '@/mcp/tools/create-report.tool.js';
import { checkQuerySource } from '@/mcp/tools/source-check.js';
import type { AuditLogger } from '@/shared-kernel/audit/AuditLogger.js';
import { WritesGate } from '@/shared-kernel/writes/WritesGate.js';

const queryLimits = { location: 'US', maxRows: 100, maxBytesBilled: 10 };
const dryRunResult = {
  schema: [],
  rows: [],
  totalRows: 0,
  bytesProcessed: 0,
  cacheHit: false,
  truncated: false,
};

function fakeRepo(query: BigQueryRepository['query'] = vi.fn(async () => dryRunResult)) {
  const repo: BigQueryRepository = {
    listDatasets: vi.fn(),
    listTables: vi.fn(),
    getTable: vi.fn(),
    query,
    createOrReplaceView: vi.fn(),
    deleteTable: vi.fn(),
  };
  return repo;
}

describe('checkQuerySource', () => {
  it('dry-runs a custom query', async () => {
    const bigQueryRepo = fakeRepo();
    await checkQuerySource(
      { bigQueryRepo, queryLimits },
      { projectId: 'p-12345', sql: 'SELECT 1' },
    );
    expect(bigQueryRepo.query).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, sql: 'SELECT 1', projectId: 'p-12345' }),
    );
  });

  it('skips tables and views', async () => {
    const bigQueryRepo = fakeRepo();
    await checkQuerySource(
      { bigQueryRepo, queryLimits },
      { projectId: 'p-12345', datasetId: 'd', tableId: 't' },
    );
    expect(bigQueryRepo.query).not.toHaveBeenCalled();
  });

  it('refuses anything but one SELECT without asking BigQuery', async () => {
    const bigQueryRepo = fakeRepo();
    for (const sql of ['DELETE FROM t WHERE true', 'SELECT 1; SELECT 2']) {
      await expect(
        checkQuerySource({ bigQueryRepo, queryLimits }, { projectId: 'p-12345', sql }),
      ).rejects.toThrow(SourceQueryRejectedError);
    }
    expect(bigQueryRepo.query).not.toHaveBeenCalled();
  });

  it("returns BigQuery's own message for an invalid query", async () => {
    const bigQueryRepo = fakeRepo(
      vi.fn(async () => {
        throw new GoogleApiError(400, 'invalidQuery', 'Unrecognized name: nope at [1:8]');
      }),
    );
    const err = await checkQuerySource(
      { bigQueryRepo, queryLimits },
      { projectId: 'p-12345', sql: 'SELECT nope FROM `p-12345.d.t`' },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceQueryRejectedError);
    expect((err as SourceQueryRejectedError).userMessage).toContain(
      'Unrecognized name: nope at [1:8]',
    );
  });

  it('passes stand-ins for the parameters that are on', async () => {
    const bigQueryRepo = fakeRepo();
    await checkQuerySource(
      { bigQueryRepo, queryLimits },
      {
        projectId: 'p-12345',
        sql: 'SELECT @DS_USER_EMAIL AS who',
        viewerEmailParam: true,
      },
    );
    expect(bigQueryRepo.query).toHaveBeenCalledWith(
      expect.objectContaining({ parameters: { DS_USER_EMAIL: 'viewer@example.com' } }),
    );
  });

  it('refuses a parameter whose option is off', async () => {
    await expect(
      checkQuerySource(
        { bigQueryRepo: fakeRepo(), queryLimits },
        { projectId: 'p-12345', sql: 'SELECT 1 WHERE @DS_START_DATE > "20260101"' },
      ),
    ).rejects.toThrow(QueryParameterError);
  });
});

describe('create_report with a broken custom query', () => {
  it('never opens Looker Studio', async () => {
    const reportRepo = { createReport: vi.fn() } as unknown as ReportRepository;
    const bigQueryRepo = fakeRepo(
      vi.fn(async () => {
        throw new GoogleApiError(400, 'invalidQuery', 'Unrecognized name: nope');
      }),
    );
    await expect(
      handleCreateReport(
        {
          reportRepo,
          bigQueryRepo,
          queryLimits,
          defaultProject: 'p-12345',
          writesGate: new WritesGate({ configEnabled: true, cliFlag: true }),
          auditLogger: { recordWriteAttempt: vi.fn() } as unknown as AuditLogger,
        },
        { name: 'R', sql: 'SELECT nope FROM `p-12345.d.t`' },
      ),
    ).rejects.toThrow(SourceQueryRejectedError);
    expect(reportRepo.createReport).not.toHaveBeenCalled();
  });
});
