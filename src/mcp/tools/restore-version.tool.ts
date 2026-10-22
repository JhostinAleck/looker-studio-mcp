import { restoreVersion } from '@/contexts/reports/application/reportUseCases.js';
import { restoreVersionSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleRestoreVersion(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = restoreVersionSchema.parse(raw);
  return runWrite(
    deps,
    'restore_version',
    { ...input },
    `restore version ${JSON.stringify(input.version)} of the report`,
    async () => {
      const version = await restoreVersion(deps.reportRepo, input.report_id, input.version);
      return text(`Report restored to the version of ${version.label}.`);
    },
  );
}
