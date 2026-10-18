import { describe, expect, it, vi } from 'vitest';

import { GoogleApiClient } from '@/contexts/google-api/infrastructure/GoogleApiClient.js';
import {
  RestBigQueryRepository,
  decodeRow,
} from '@/contexts/bigquery/infrastructure/RestBigQueryRepository.js';
import type { Field } from '@/contexts/bigquery/domain/BigQuery.js';

const tokens = { getAccessToken: async () => 'tok', describeIdentity: async () => null };

function repoWith(answers: unknown[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  });
  return { repo: new RestBigQueryRepository(new GoogleApiClient({ tokens, fetchFn })), calls };
}

const field = (name: string, type: string, extra: Partial<Field> = {}): Field => ({
  name,
  type,
  mode: 'NULLABLE',
  description: null,
  fields: [],
  ...extra,
});

describe('decodeRow', () => {
  it('restores numbers, booleans, timestamps, records and arrays', () => {
    const schema = [
      field('n', 'INTEGER'),
      field('f', 'FLOAT'),
      field('b', 'BOOLEAN'),
      field('t', 'TIMESTAMP'),
      field('r', 'RECORD', { fields: [field('x', 'STRING')] }),
      field('a', 'STRING', { mode: 'REPEATED' }),
      field('z', 'STRING'),
    ];
    const row = decodeRow(schema, {
      f: [
        { v: '74' },
        { v: '1.5' },
        { v: 'true' },
        { v: '1792278222.0' },
        { v: { f: [{ v: 'hi' }] } },
        { v: [{ v: 'a' }, { v: 'b' }] },
        { v: null },
      ],
    });
    expect(row).toEqual({
      n: 74,
      f: 1.5,
      b: true,
      t: '2026-10-17T23:03:42.000Z',
      r: { x: 'hi' },
      a: ['a', 'b'],
      z: null,
    });
  });
});

describe('RestBigQueryRepository', () => {
  it('pages through datasets', async () => {
    const { repo, calls } = repoWith([
      { datasets: [{ datasetReference: { datasetId: 'a' }, location: 'US' }], nextPageToken: 'n' },
      { datasets: [{ datasetReference: { datasetId: 'b' } }] },
    ]);
    const out = await repo.listDatasets('p-12345');
    expect(out.map((d) => d.datasetId)).toEqual(['a', 'b']);
    expect(calls[1]!.url).toContain('pageToken=n');
  });

  it('runs a query with the byte limit and polls an unfinished job', async () => {
    const { repo, calls } = repoWith([
      { jobComplete: false, jobReference: { jobId: 'j1', location: 'US' } },
      {
        jobComplete: true,
        schema: { fields: [{ name: 'uses', type: 'INTEGER' }] },
        rows: [{ f: [{ v: '3' }] }, { f: [{ v: '2' }] }],
        totalRows: '5',
        totalBytesProcessed: '1024',
      },
    ]);
    const result = await repo.query({
      projectId: 'p-12345',
      sql: 'SELECT 1',
      location: 'US',
      maxRows: 2,
      maxBytesBilled: 1000,
    });
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      maximumBytesBilled: '1000',
      maxResults: 2,
    });
    expect(calls[1]!.url).toContain('/queries/j1?');
    expect(result).toMatchObject({
      rows: [{ uses: 3 }, { uses: 2 }],
      totalRows: 5,
      truncated: true,
      bytesProcessed: 1024,
    });
  });

  it('creates a view with DDL', async () => {
    const { repo, calls } = repoWith([{}]);
    await repo.createOrReplaceView({
      projectId: 'p-12345',
      datasetId: 'd',
      tableId: 'v',
      sql: 'SELECT 1',
      location: 'US',
    });
    expect(JSON.parse(calls[0]!.init.body as string).query).toBe(
      'CREATE OR REPLACE VIEW `p-12345.d.v`\nAS\nSELECT 1',
    );
  });

  it('reads a view with its schema', async () => {
    const { repo } = repoWith([
      {
        type: 'VIEW',
        numRows: '0',
        schema: { fields: [{ name: 'f', type: 'STRING' }] },
        view: { query: 'SELECT f' },
      },
    ]);
    const t = await repo.getTable({ projectId: 'p-12345', datasetId: 'd', tableId: 'v' });
    expect(t).toMatchObject({ type: 'VIEW', rowCount: 0, viewQuery: 'SELECT f' });
    expect(t.schema[0]!.name).toBe('f');
  });
});
