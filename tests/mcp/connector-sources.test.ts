import { describe, expect, it } from 'vitest';

import { InvalidDataSourceError } from '@/contexts/reports/domain/connectors.js';
import { addDataSourceSchema, buildReportLinkSchema } from '@/mcp/schemas.js';
import { resolveSource } from '@/mcp/tool-helpers.js';
import { handleAddDataSource } from '@/mcp/tools/add-data-source.tool.js';
import { handleBuildReportLink } from '@/mcp/tools/build-report-link.tool.js';
import { AuditLogger } from '@/shared-kernel/audit/AuditLogger.js';
import type { Logger } from '@/shared-kernel/logging/Logger.js';
import { WritesGate } from '@/shared-kernel/writes/WritesGate.js';

const ID = '1a2b3c4d-0000-4000-8000-1234567890ab';
const SHEET = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc';
const URL_777 = `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=777`;

describe('resolveSource with connectors', () => {
  it('keeps BigQuery the default', () => {
    expect(resolveSource('p', { dataset_id: 'd', table_id: 't' })).toEqual({
      projectId: 'p',
      datasetId: 'd',
      tableId: 't',
    });
    expect(resolveSource('p', { connector: 'bigquery', sql: 'SELECT 1' })).toEqual({
      projectId: 'p',
      sql: 'SELECT 1',
    });
  });

  it('reads a Google Sheets source with default options', () => {
    expect(
      resolveSource(undefined, {
        connector: 'google_sheets',
        spreadsheet: URL_777,
        worksheet: 'Data',
        source_name: 'Tasks',
      }),
    ).toEqual({
      connector: 'google_sheets',
      spreadsheetId: SHEET,
      worksheet: 'Data',
      worksheetId: '777',
      hasHeader: true,
      includeHiddenAndFiltered: true,
      name: 'Tasks',
    });
    expect(
      resolveSource(undefined, {
        connector: 'google_sheets',
        spreadsheet: SHEET,
        worksheet_id: 3,
        use_first_row_as_headers: false,
        include_hidden_and_filtered_cells: false,
        range: ' A1:B9 ',
      }),
    ).toMatchObject({
      worksheetId: '3',
      hasHeader: false,
      includeHiddenAndFiltered: false,
      range: 'A1:B9',
    });
  });

  it('reads a database source without needing a Google Cloud project', () => {
    expect(
      resolveSource(undefined, {
        connector: 'mysql',
        host: 'h',
        port: 3306,
        database: 'db',
        user: 'u',
        password: 'pw',
        ssl: { server_certificate: '/ca.pem' },
        sql: ' SELECT 1 ',
      }),
    ).toEqual({
      connector: 'mysql',
      host: 'h',
      port: 3306,
      database: 'db',
      user: 'u',
      password: 'pw',
      ssl: { serverCertificate: '/ca.pem' },
      sql: 'SELECT 1',
    });
  });

  it('rejects fields of another connector', () => {
    expect(() => resolveSource('p', { dataset_id: 'd', table_id: 't', host: 'h' })).toThrow(
      /host do not apply to a BigQuery source/,
    );
    expect(() =>
      resolveSource(undefined, { connector: 'google_sheets', spreadsheet: SHEET, table_id: 't' }),
    ).toThrow(InvalidDataSourceError);
    expect(() =>
      resolveSource(undefined, { connector: 'postgresql', host: 'h', worksheet: 'w' }),
    ).toThrow(/worksheet/);
    expect(() =>
      resolveSource(undefined, { connector: 'mysql', project_id: 'p', host: 'h' }),
    ).toThrow(/project_id/);
    expect(() => resolveSource(undefined, { connector: 'google_sheets' })).toThrow(/spreadsheet/);
  });
});

describe('connector schemas and tools', () => {
  it('parses connector fields and keeps old BigQuery input valid', () => {
    expect(addDataSourceSchema.parse({ report_id: ID, dataset_id: 'd', table_id: 't' })).toEqual({
      report_id: ID,
      dataset_id: 'd',
      table_id: 't',
    });
    expect(() =>
      addDataSourceSchema.parse({ report_id: ID, connector: 'oracle', host: 'h' }),
    ).toThrow();
    expect(() =>
      addDataSourceSchema.parse({ report_id: ID, connector: 'mysql', port: -1 }),
    ).toThrow();
    expect(
      buildReportLinkSchema.parse({
        report_name: 'R',
        sources: [{ connector: 'google_sheets', spreadsheet: URL_777 }],
      }).sources[0]?.connector,
    ).toBe('google_sheets');
  });

  it('never writes the database password to the audit log', async () => {
    const lines: string[] = [];
    const logger: Logger = {
      debug: () => {},
      info: () => {},
      warn: (msg, ctx) => lines.push(JSON.stringify({ msg, ctx })),
      error: () => {},
    };
    const out = await handleAddDataSource(
      {
        reportRepo: {} as never,
        defaultProject: undefined,
        writesGate: new WritesGate({ configEnabled: true, cliFlag: true, configDryRun: true }),
        auditLogger: new AuditLogger({ logger }),
      } as never,
      {
        report_id: ID,
        connector: 'postgresql',
        host: 'db.example.com',
        database: 'shop',
        user: 'reader',
        password: 'p4ss-w0rd-value',
        table_id: 'orders',
      },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('p4ss-w0rd-value');
    expect(lines[0]).toContain('[redacted]');
    expect(JSON.stringify(out)).not.toContain('p4ss-w0rd-value');
    expect(JSON.stringify(out)).toContain('reader@db.example.com/shop table orders');
  });

  it('builds a Sheets link from a URL with its gid', async () => {
    // Only custom queries reach BigQuery: a Sheets source never uses these.
    const out = await handleBuildReportLink(
      { defaultProject: undefined, bigQueryRepo: {} as never, queryLimits: {} as never },
      { report_name: 'R', sources: [{ connector: 'google_sheets', spreadsheet: URL_777 }] },
    );
    const link = /https:\/\/\S+/.exec(out.content[0]?.type === 'text' ? out.content[0].text : '')!;
    const url = new URL(link[0]);
    expect(url.searchParams.get('ds.*.connector')).toBe('googleSheets');
    expect(url.searchParams.get('ds.*.worksheetId')).toBe('777');
  });
});
