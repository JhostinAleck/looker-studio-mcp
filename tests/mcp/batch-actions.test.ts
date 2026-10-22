import { describe, expect, it, vi } from 'vitest';

import type { ReportRepository } from '@/contexts/reports/domain/ReportRepository.js';
import { handleApplyActions } from '@/mcp/tools/apply-actions.tool.js';
import {
  BATCHABLE_TOOLS,
  type BatchDeps,
  InvalidActionsError,
  checkActions,
  formatResults,
  runActions,
} from '@/mcp/tools/batch-actions.js';
import type { AuditLogger } from '@/shared-kernel/audit/AuditLogger.js';
import { WritesGate } from '@/shared-kernel/writes/WritesGate.js';

const ID = '1a2b3c4d-0000-4000-8000-1234567890ab';
const placed = { index: 0, kind: 'Text properties', layout: { x: 0, y: 0, width: 10, height: 10 } };

function deps(overrides: Partial<Record<keyof ReportRepository, unknown>> = {}) {
  const calls: string[] = [];
  const repo = new Proxy({} as ReportRepository, {
    get: (_t, name: string) =>
      name in overrides
        ? overrides[name as keyof ReportRepository]
        : name === 'inOneVisit'
          ? async (_id: string, work: () => Promise<unknown>) => {
              calls.push('visit');
              return work();
            }
          : async () => {
              calls.push(name);
              return name === 'addPage' ? { index: 2, name: 'Two' } : placed;
            },
  });
  const audit = { recordWriteAttempt: vi.fn() };
  const d: BatchDeps = {
    reportRepo: repo,
    defaultProject: 'p',
    writesGate: new WritesGate({ configEnabled: true, cliFlag: true }),
    auditLogger: audit as unknown as AuditLogger,
  };
  return { d, calls, audit };
}

describe('apply_actions', () => {
  it('runs the editing tools it lists', () => {
    for (const tool of ['add_chart', 'add_page', 'manage_page', 'set_theme', 'update_component'])
      expect(BATCHABLE_TOOLS[tool]).toBeDefined();
  });

  it('checks every action before the browser, with the tool schema and use case rules', async () => {
    const { d, calls } = deps();
    const err = await checkActions(d, ID, [
      { tool: 'add_text', args: { text: 'ok' } },
      { tool: 'nope', args: {} },
      { tool: 'add_text', args: {} },
      { tool: 'add_chart', args: { type: 'bar', dimensions: [], metrics: [] } },
      { tool: 'add_text', args: { text: 'x', report_id: '2a2b3c4d-0000-4000-8000-1234567890ab' } },
    ]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidActionsError);
    const message = (err as InvalidActionsError).userMessage;
    expect(message).toMatch(/2\. nope: not a tool/);
    expect(message).toMatch(/3\. add_text: text:/);
    expect(message).toMatch(/4\. add_chart: A bar chart takes exactly 1 dimension/);
    expect(message).toMatch(/5\. add_text: every action edits the batch's report/);
    expect(message).not.toMatch(/1\. add_text/);
    expect(calls).toEqual([]);
  });

  it('runs the actions in one visit, audited once, and stops at the first error', async () => {
    const { d, calls, audit } = deps({
      addShape: async () => {
        throw new Error('shape failed');
      },
    });
    const result = await handleApplyActions(d, {
      report_id: ID,
      actions: [
        { tool: 'add_text', args: { text: 'Title' } },
        { tool: 'add_shape', args: { shape: 'rectangle' } },
        { tool: 'add_page', args: { name: 'Two' } },
      ],
    });
    expect(calls).toEqual(['visit', 'addText']);
    expect(audit.recordWriteAttempt).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    const body = result.content[0]!.type === 'text' ? result.content[0]!.text : '';
    expect(body).toMatch(/1 of 3 actions done/);
    expect(body).toMatch(/2\. add_shape: error .*\n {3}shape failed/);
    expect(body).toMatch(/3\. add_page: skipped/);
  });

  it('goes on after an error with continue_on_error', async () => {
    const { d } = deps({
      addShape: async () => {
        throw new Error('shape failed');
      },
    });
    const results = await runActions(
      d,
      ID,
      [
        { tool: 'add_shape', args: { shape: 'rectangle' } },
        { tool: 'add_page', args: { name: 'Two' } },
      ],
      true,
    );
    expect(results.map((r) => r.status)).toEqual(['error', 'ok']);
    expect(results[1]!.text).toBe('Page 2 "Two" added.');
    expect(formatResults(results, 1500)).toMatch(
      /^1 of 2 actions done in one editor visit \(1\.5 s\)/,
    );
  });

  it('only reports what it would do in a dry run', async () => {
    const { d, calls } = deps();
    const dry = {
      ...d,
      writesGate: new WritesGate({ configEnabled: true, cliFlag: true, configDryRun: true }),
    };
    const result = await handleApplyActions(dry, {
      report_id: ID,
      actions: [{ tool: 'add_text', args: { text: 'Title' } }],
    });
    expect(result.content[0]).toMatchObject({ text: expect.stringMatching(/^Dry run/) });
    expect(calls).toEqual([]);
  });
});
