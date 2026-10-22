import { inOneVisit } from '@/contexts/reports/application/reportUseCases.js';
import { parseReportId } from '@/contexts/reports/domain/Report.js';
import { applyActionsSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult } from '@/mcp/tool-helpers.js';

import { type BatchDeps, checkActions, formatResults, runActions } from './batch-actions.js';

export async function handleApplyActions(deps: BatchDeps, raw: unknown): Promise<ToolResult> {
  const input = applyActionsSchema.parse(raw);
  const reportId = parseReportId(input.report_id);
  await checkActions(deps, reportId, input.actions);
  const what = `run ${input.actions.length} actions (${input.actions.map((a) => a.tool).join(', ')}) in one editor visit`;
  return runWrite(deps, 'apply_actions', { ...input }, what, async () => {
    const started = Date.now();
    const results = await inOneVisit(deps.reportRepo, reportId, (id) =>
      runActions(deps, id, input.actions, input.continue_on_error),
    );
    const result = text(formatResults(results, Date.now() - started));
    return results.some((r) => r.status === 'error') ? { ...result, isError: true } : result;
  });
}
