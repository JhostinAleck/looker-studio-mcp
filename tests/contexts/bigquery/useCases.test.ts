import { describe, expect, it, vi } from 'vitest';

import { createView, runQuery } from '@/contexts/bigquery/application/bigqueryUseCases.js';
import type { BigQueryRepository } from '@/contexts/bigquery/domain/BigQueryRepository.js';
import { WriteQueryRejectedError } from '@/contexts/bigquery/domain/sql.js';

const limits = { location: 'US', maxRows: 100, maxBytesBilled: 10 };
const empty = {
  schema: [],
  rows: [],
  totalRows: 0,
  bytesProcessed: 42,
  cacheHit: false,
  truncated: false,
};

function fakeRepo(): BigQueryRepository {
  return {
    listDatasets: vi.fn(),
    listTables: vi.fn(),
    getTable: vi.fn(),
    query: vi.fn(async () => empty),
    createOrReplaceView: vi.fn(async () => undefined),
    deleteTable: vi.fn(),
  };
}

describe('runQuery', () => {
  it('caps the rows at the configured limit', async () => {
    const repo = fakeRepo();
    await runQuery(repo, { projectId: 'p-12345', sql: 'SELECT 1', maxRows: 5000 }, limits);
    expect(repo.query).toHaveBeenCalledWith(
      expect.objectContaining({ maxRows: 100, maxBytesBilled: 10 }),
    );
  });

  it('refuses statements that write', async () => {
    await expect(
      runQuery(fakeRepo(), { projectId: 'p-12345', sql: 'DROP TABLE x' }, limits),
    ).rejects.toThrow(WriteQueryRejectedError);
  });
});

describe('createView', () => {
  it('dry-runs the SELECT before saving the view', async () => {
    const repo = fakeRepo();
    const out = await createView(
      repo,
      { projectId: 'p-12345', datasetId: 'd', tableId: 'v', sql: 'SELECT 1', description: 'x' },
      limits,
    );
    expect(repo.query).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(repo.createOrReplaceView).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 'v', description: 'x', location: 'US' }),
    );
    expect(out.bytesProcessed).toBe(42);
  });

  it('does not save a view whose SELECT fails', async () => {
    const repo = fakeRepo();
    vi.mocked(repo.query).mockRejectedValueOnce(new Error('Unrecognized name'));
    await expect(
      createView(
        repo,
        { projectId: 'p-12345', datasetId: 'd', tableId: 'v', sql: 'SELECT nope' },
        limits,
      ),
    ).rejects.toThrow('Unrecognized name');
    expect(repo.createOrReplaceView).not.toHaveBeenCalled();
  });
});
