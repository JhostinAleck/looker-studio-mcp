import { describe, expect, it, vi } from 'vitest';

import {
  addCommunityViz,
  addDataSource,
  createReport,
} from '@/contexts/reports/application/reportUseCases.js';
import { validateCommunityViz } from '@/contexts/reports/domain/community.js';
import {
  type DatabaseSource,
  InvalidDataSourceError,
  connectorOf,
  describeDataSource,
  parseSpreadsheet,
  validateDataSource,
} from '@/contexts/reports/domain/connectors.js';
import { buildLinkingUrl } from '@/contexts/reports/domain/linking.js';
import { InvalidChartError } from '@/contexts/reports/domain/Report.js';
import type { ReportRepository } from '@/contexts/reports/domain/ReportRepository.js';

const ID = '1a2b3c4d-0000-4000-8000-1234567890ab';
const SHEET = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc';

const sheets = {
  connector: 'google_sheets' as const,
  spreadsheetId: SHEET,
  worksheet: 'Data',
  hasHeader: true,
  includeHiddenAndFiltered: true,
};

const db: DatabaseSource = {
  connector: 'postgresql',
  host: 'db.example.com',
  port: 5432,
  database: 'shop',
  user: 'reader',
  password: 's3cret-pass',
  table: 'orders',
};

describe('parseSpreadsheet', () => {
  it('reads the id and the gid of a Sheets URL', () => {
    expect(parseSpreadsheet(`https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=42`)).toEqual(
      { spreadsheetId: SHEET, worksheetId: '42' },
    );
    expect(parseSpreadsheet(`https://docs.google.com/spreadsheets/d/${SHEET}/edit`)).toEqual({
      spreadsheetId: SHEET,
    });
  });

  it('accepts a bare id and rejects anything else', () => {
    expect(parseSpreadsheet(` ${SHEET} `)).toEqual({ spreadsheetId: SHEET });
    expect(() => parseSpreadsheet('https://example.com/sheet')).toThrow(InvalidDataSourceError);
    expect(() => parseSpreadsheet('short')).toThrow(InvalidDataSourceError);
  });
});

describe('data source validation', () => {
  it('treats sources without a connector as BigQuery', () => {
    expect(connectorOf({ projectId: 'p', datasetId: 'd', tableId: 't' })).toBe('bigquery');
    expect(connectorOf(db)).toBe('postgresql');
  });

  it('needs a worksheet and an A1 range for Google Sheets', () => {
    expect(validateDataSource({ ...sheets, range: 'A1:C20' })).toBeTruthy();
    expect(validateDataSource({ ...sheets, worksheet: undefined, worksheetId: '0' })).toBeTruthy();
    expect(() => validateDataSource({ ...sheets, worksheet: undefined })).toThrow(
      InvalidDataSourceError,
    );
    expect(() => validateDataSource({ ...sheets, range: 'first rows' })).toThrow(
      InvalidDataSourceError,
    );
    expect(() => validateDataSource({ ...sheets, worksheetId: 'abc' })).toThrow(
      InvalidDataSourceError,
    );
  });

  it('needs connection fields and exactly one of table and sql for databases', () => {
    expect(validateDataSource(db)).toBe(db);
    expect(validateDataSource({ ...db, table: undefined, sql: 'SELECT 1' })).toBeTruthy();
    expect(() => validateDataSource({ ...db, sql: 'SELECT 1' })).toThrow(/not both/);
    expect(() => validateDataSource({ ...db, table: undefined })).toThrow(/not both/);
    expect(() => validateDataSource({ ...db, host: ' ' })).toThrow(/needs host/);
    expect(() => validateDataSource({ ...db, password: '' })).toThrow(/needs password/);
    expect(() => validateDataSource({ ...db, port: 0 })).toThrow(InvalidDataSourceError);
    expect(() => validateDataSource({ ...db, ssl: { clientCertificate: '/c.pem' } })).toThrow(
      /client_key/,
    );
  });

  it('never puts the password in the description', () => {
    expect(describeDataSource(db)).toBe('PostgreSQL reader@db.example.com:5432/shop table orders');
    expect(
      describeDataSource({ ...db, connector: 'mysql', table: undefined, sql: 'SELECT 1' }),
    ).toBe('MySQL reader@db.example.com:5432/shop custom query: SELECT 1');
    expect(describeDataSource(sheets)).toBe(`Google Sheets ${SHEET} › Data`);
  });

  it('validates before the repository is called', async () => {
    const repo = {
      createReport: vi.fn(async () => ({ id: ID, name: 'r', url: 'u' })),
      addDataSource: vi.fn(async () => undefined),
    } as unknown as ReportRepository;
    await expect(createReport(repo, 'r', { ...db, table: undefined })).rejects.toThrow(
      InvalidDataSourceError,
    );
    await addDataSource(repo, ID, sheets);
    expect(repo.createReport).not.toHaveBeenCalled();
    expect(repo.addDataSource).toHaveBeenCalledWith(ID, sheets);
  });
});

describe('buildLinkingUrl with other connectors', () => {
  it('passes Google Sheets as googleSheets with its worksheet gid and options', () => {
    const url = new URL(
      buildLinkingUrl({
        reportName: 'S',
        sources: [
          {
            ...sheets,
            worksheetId: '42',
            hasHeader: false,
            includeHiddenAndFiltered: false,
            range: 'A1:D20',
            name: 'Tasks',
          },
        ],
      }),
    );
    expect(url.searchParams.get('ds.*.connector')).toBe('googleSheets');
    expect(url.searchParams.get('ds.*.spreadsheetId')).toBe(SHEET);
    expect(url.searchParams.get('ds.*.worksheetId')).toBe('42');
    expect(url.searchParams.get('ds.*.hasHeader')).toBe('false');
    expect(url.searchParams.get('ds.*.includeHiddenCells')).toBe('false');
    expect(url.searchParams.get('ds.*.includeFilteredCells')).toBe('false');
    expect(url.searchParams.get('ds.*.range')).toBe('A1:D20');
    expect(url.searchParams.get('ds.*.datasourceName')).toBe('Tasks');
    expect(url.searchParams.get('ds.*.projectId')).toBeNull();
  });

  it('needs the gid for Sheets and refuses databases', () => {
    expect(() => buildLinkingUrl({ reportName: 'S', sources: [sheets] })).toThrow(/worksheet_id/);
    expect(() => buildLinkingUrl({ reportName: 'D', sources: [db] })).toThrow(
      /no PostgreSQL connector/,
    );
  });
});

describe('community visualizations', () => {
  const base = { dimensions: ['platform'], metrics: [{ field: 'Record Count' }] };

  it('takes a gallery name or a gs:// manifest', () => {
    expect(validateCommunityViz({ ...base, source: { gallery: 'Gauge' } })).toBeTruthy();
    expect(
      validateCommunityViz({
        ...base,
        source: { manifestPath: 'gs://my-bucket/viz' },
      }),
    ).toBeTruthy();
    expect(() => validateCommunityViz({ ...base, source: { gallery: ' ' } })).toThrow(
      InvalidChartError,
    );
    expect(() =>
      validateCommunityViz({ ...base, source: { manifestPath: 'https://example.com/x' } }),
    ).toThrow(/gs:\/\//);
    expect(() =>
      validateCommunityViz({ ...base, dimensions: [''], source: { gallery: 'Gauge' } }),
    ).toThrow(InvalidChartError);
  });

  it('parses the report id before calling the repository', async () => {
    const placed = { index: 0, kind: 'Community', layout: { x: 0, y: 0, width: 1, height: 1 } };
    const repo = { addCommunityViz: vi.fn(async () => placed) } as unknown as ReportRepository;
    const viz = { ...base, source: { gallery: 'Gauge' } };
    await addCommunityViz(repo, `https://lookerstudio.google.com/reporting/${ID}/edit`, viz);
    expect(repo.addCommunityViz).toHaveBeenCalledWith(ID, viz, {});
  });
});
