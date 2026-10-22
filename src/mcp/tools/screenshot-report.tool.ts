import { readFile } from 'node:fs/promises';

import { screenshotReport } from '@/contexts/reports/application/reportUseCases.js';
import { screenshotReportSchema } from '@/mcp/schemas.js';
import type { ToolResult } from '@/mcp/tool-helpers.js';

import type { ReportToolDeps } from './reports-deps.js';

export async function handleScreenshotReport(
  deps: ReportToolDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = screenshotReportSchema.parse(raw);
  const { path, notes } = await screenshotReport(deps.reportRepo, input.report_id, input.page);
  const data = (await readFile(path)).toString('base64');
  return {
    content: [
      { type: 'image', data, mimeType: 'image/png' },
      { type: 'text', text: [`Saved at ${path}`, ...notes].join('\n') },
    ],
  };
}
