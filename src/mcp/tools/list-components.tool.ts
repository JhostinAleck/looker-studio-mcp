import { listComponents } from '@/contexts/reports/application/reportUseCases.js';
import { listComponentsSchema } from '@/mcp/schemas.js';
import { text, type ToolResult } from '@/mcp/tool-helpers.js';

import { formatComponent } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleListComponents(
  deps: ReportToolDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = listComponentsSchema.parse(raw);
  const components = await listComponents(deps.reportRepo, input.report_id, input.page);
  if (components.length === 0) return text('The page is empty.');
  return text(`Components, back to front:\n${components.map(formatComponent).join('\n')}`);
}
