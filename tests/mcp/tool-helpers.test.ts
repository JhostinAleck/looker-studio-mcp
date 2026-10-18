import { describe, expect, it, vi } from 'vitest';

import {
  MissingProjectError,
  errorResult,
  fieldsToMarkdown,
  formatBytes,
  resolveProject,
  rowsToMarkdown,
  runWrite,
  text,
} from '@/mcp/tool-helpers.js';
import { InvalidChartError } from '@/contexts/reports/domain/Report.js';
import { WritesGate } from '@/shared-kernel/writes/WritesGate.js';
import type { AuditLogger } from '@/shared-kernel/audit/AuditLogger.js';

describe('tool helpers', () => {
  it('renders rows as a markdown table and escapes pipes', () => {
    const md = rowsToMarkdown({
      schema: [
        { name: 'feature', type: 'STRING', mode: 'NULLABLE', description: null, fields: [] },
        { name: 'uses', type: 'INTEGER', mode: 'NULLABLE', description: null, fields: [] },
      ],
      rows: [{ feature: 'a|b', uses: 3 }],
      totalRows: 1,
      bytesProcessed: 0,
      cacheHit: false,
      truncated: false,
    });
    expect(md).toBe('| feature | uses |\n|---|---|\n| a\\|b | 3 |');
  });

  it('nests record fields', () => {
    expect(
      fieldsToMarkdown([
        {
          name: 'r',
          type: 'RECORD',
          mode: 'REPEATED',
          description: 'x',
          fields: [{ name: 'y', type: 'STRING', mode: 'NULLABLE', description: null, fields: [] }],
        },
      ]),
    ).toBe('- `r` RECORD REPEATED — x\n  - `y` STRING');
  });

  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });

  it('uses the default project and fails without one', () => {
    expect(resolveProject('p', undefined)).toBe('p');
    expect(resolveProject('p', 'q')).toBe('q');
    expect(() => resolveProject(undefined, undefined)).toThrow(MissingProjectError);
  });

  it('shows the user message of domain errors', () => {
    const result = errorResult(new InvalidChartError('A chart needs at least one metric.'));
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: A chart needs at least one metric.' }],
      isError: true,
    });
  });
});

describe('runWrite', () => {
  const audit = () => ({ recordWriteAttempt: vi.fn() }) as unknown as AuditLogger;

  it('audits and runs the write', async () => {
    const auditLogger = audit();
    const work = vi.fn(async () => text('done'));
    const out = await runWrite(
      { writesGate: new WritesGate({ configEnabled: true, cliFlag: true }), auditLogger },
      'create_view',
      { view_id: 'v' },
      'create v',
      work,
    );
    expect(out).toEqual(text('done'));
    expect(auditLogger.recordWriteAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'create_view', args: { view_id: 'v' } }),
    );
  });

  it('only describes the write in dry-run mode', async () => {
    const work = vi.fn();
    const out = await runWrite(
      {
        writesGate: new WritesGate({ configEnabled: true, cliFlag: true, configDryRun: true }),
        auditLogger: audit(),
      },
      'delete_view',
      {},
      'delete v',
      work,
    );
    expect(work).not.toHaveBeenCalled();
    expect(out).toEqual(text('Dry run: would delete v. Nothing was changed.'));
  });
});
