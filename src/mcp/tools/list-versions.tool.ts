import { listVersions } from '@/contexts/reports/application/reportUseCases.js';
import { listVersionsSchema } from '@/mcp/schemas.js';
import { text, type ToolResult } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleListVersions(deps: ReportToolDeps, raw: unknown): Promise<ToolResult> {
  const input = listVersionsSchema.parse(raw);
  const versions = await listVersions(deps.reportRepo, input.report_id);
  return text(
    versions
      .map(
        (v) =>
          `${v.index}. ${v.label}${v.current ? ' (current version)' : ''}${v.authors.length ? ` — ${v.authors.join(', ')}` : ''}`,
      )
      .join('\n') || 'The report has no saved versions.',
  );
}
