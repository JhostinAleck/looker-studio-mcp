import { setLinkSharing } from '@/contexts/reports/application/reportUseCases.js';
import { parseReportId, reportUrl } from '@/contexts/reports/domain/Report.js';
import { setLinkSharingSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleSetLinkSharing(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = setLinkSharingSchema.parse(raw);
  const sharing = { access: input.access, ...(input.role ? { role: input.role } : {}) };
  return runWrite(
    deps,
    'set_link_sharing',
    { ...input },
    `set link sharing to ${input.access}${input.role ? ` (${input.role})` : ''}`,
    async () => {
      const now = await setLinkSharing(deps.reportRepo, input.report_id, sharing);
      const url = reportUrl(parseReportId(input.report_id));
      return text(
        `Link sharing: ${now.access}${now.role ? `, people with the link are ${now.role}s` : ''}.\n${url}`,
      );
    },
  );
}
