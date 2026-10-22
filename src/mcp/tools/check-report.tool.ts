import { checkReport } from '@/contexts/reports/application/reportUseCases.js';
import type { ChartProblem, ReportCheck } from '@/contexts/reports/domain/Report.js';
import { checkReportSchema } from '@/mcp/schemas.js';
import { text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

const PROBLEM_LABEL: Record<ChartProblem['problem'], string> = {
  no_data: 'no data',
  configuration: 'configuration',
  data_set: 'data set',
  consent: 'consent',
  loading: 'loading',
  error: 'error',
};

const CONSENT_NOTE =
  "Charts marked consent read a data source with viewer's credentials (or the viewer email parameter): Looker Studio only loads their data after each viewer grants consent. The check declined that prompt instead of granting it on your behalf, so their data could not be checked. Open the report and click Allow to see it, or set the data source's credentials to owner with update_data_source.";

function formatProblem(p: ChartProblem): string {
  const page = p.pageName ? `page ${p.page} "${p.pageName}"` : `page ${p.page}`;
  const what = [p.kind, p.title ? `"${p.title}"` : null].filter(Boolean).join(' ');
  const fields = p.fields?.length ? ` (${p.fields.join(', ')})` : '';
  const details = p.details ? `\n  Details: ${p.details}` : '';
  return `- ${page}, #${p.index} ${what}${fields}: **${PROBLEM_LABEL[p.problem]}**: ${p.message}${details}`;
}

export function formatReportCheck(check: ReportCheck): string {
  const ok = check.components - check.problems.length;
  const pages = check.pages.length === 1 ? '1 page' : `${check.pages.length} pages`;
  const head = `Checked ${pages}: ${ok} of ${check.components} charts and controls OK.`;
  if (check.problems.length === 0) return head;
  const list = `${head}\n\n${check.problems.length} with problems:\n${check.problems.map(formatProblem).join('\n')}`;
  return check.problems.some((p) => p.problem === 'consent') ? `${list}\n\n${CONSENT_NOTE}` : list;
}

export async function handleCheckReport(deps: ReportToolDeps, raw: unknown): Promise<ToolResult> {
  const input = checkReportSchema.parse(raw);
  const check = await checkReport(deps.reportRepo, input.report_id, {
    ...(input.page ? { page: input.page } : {}),
    timeoutSeconds: input.timeout_seconds,
  });
  return text(formatReportCheck(check));
}
