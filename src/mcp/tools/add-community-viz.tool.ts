import { addCommunityViz } from '@/contexts/reports/application/reportUseCases.js';
import {
  type CommunityVizSource,
  describeCommunityViz,
} from '@/contexts/reports/domain/community.js';
import { InvalidChartError } from '@/contexts/reports/domain/Report.js';
import { addCommunityVizSchema, toDataSettings } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { placedMessage, toLayout } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

export async function handleAddCommunityViz(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addCommunityVizSchema.parse(raw);
  if (!input.name === !input.manifest_path)
    throw new InvalidChartError('Give either name (a gallery visualization) or manifest_path.');
  const source: CommunityVizSource = input.name
    ? { gallery: input.name }
    : { manifestPath: input.manifest_path!.trim() };
  const viz = {
    source,
    dimensions: input.dimensions,
    metrics: input.metrics.map((m) => ({
      field: m.field,
      ...(m.aggregation ? { aggregation: m.aggregation } : {}),
      ...(m.label ? { label: m.label } : {}),
    })),
    ...(input.title ? { title: input.title } : {}),
    ...toDataSettings(input),
  };
  const what = describeCommunityViz(source);
  return runWrite(deps, 'add_community_viz', { ...input }, `add a ${what}`, async () => {
    const placed = await addCommunityViz(deps.reportRepo, input.report_id, viz, {
      ...(input.layout ? { layout: toLayout(input.layout) } : {}),
      ...(input.style ? { style: input.style } : {}),
      ...(input.page ? { page: input.page } : {}),
      ...(input.data_source ? { dataSource: input.data_source } : {}),
    });
    return text(placedMessage(`a ${what}`, placed));
  });
}
