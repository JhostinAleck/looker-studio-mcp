import type { ZodObject, ZodRawShape } from 'zod';
import { ZodError } from 'zod';

import type { ReportRepository } from '@/contexts/reports/domain/ReportRepository.js';
import * as schemas from '@/mcp/schemas.js';
import { errorMessage, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';
import type { AuditLogger } from '@/shared-kernel/audit/AuditLogger.js';
import { DomainError } from '@/shared-kernel/errors/DomainError.js';
import type { WritesGate } from '@/shared-kernel/writes/WritesGate.js';

import { handleAddBinField } from './add-bin-field.tool.js';
import { handleAddCalculatedField } from './add-calculated-field.tool.js';
import { handleAddChart } from './add-chart.tool.js';
import { handleAddControl } from './add-control.tool.js';
import { handleAddDataSource } from './add-data-source.tool.js';
import { handleAddEmbed } from './add-embed.tool.js';
import { handleAddGroupField } from './add-group-field.tool.js';
import { handleAddImage } from './add-image.tool.js';
import { handleAddLine } from './add-line.tool.js';
import { handleAddPage } from './add-page.tool.js';
import { handleAddParameter } from './add-parameter.tool.js';
import { handleAddShape } from './add-shape.tool.js';
import { handleAddText } from './add-text.tool.js';
import { handleArrangeComponents } from './arrange-components.tool.js';
import { handleCreateBlend } from './create-blend.tool.js';
import { handleDeleteComponent } from './delete-component.tool.js';
import { handleDescribeComponent } from './describe-component.tool.js';
import { handleDuplicateComponent } from './duplicate-component.tool.js';
import { handleListComponents } from './list-components.tool.js';
import { handleListReportPages } from './list-report-pages.tool.js';
import { handleManageFilter } from './manage-filter.tool.js';
import { handleManagePage } from './manage-page.tool.js';
import { handleRefreshDataSource } from './refresh-data-source.tool.js';
import { handleRenamePage } from './rename-page.tool.js';
import { handleRenameReport } from './rename-report.tool.js';
import { handleSetPageSettings } from './set-page-settings.tool.js';
import { handleSetTheme } from './set-theme.tool.js';
import { handleUpdateComponent } from './update-component.tool.js';
import type { ReportToolDeps } from './reports-deps.js';

export type BatchDeps = ReportToolDeps & WriteDeps;

interface BatchableTool {
  schema: ZodObject<ZodRawShape>;
  run: (deps: BatchDeps, raw: unknown) => Promise<ToolResult> | ToolResult;
}

// The tools apply_actions runs, by tool name. A tool joins with one line here:
// every call it makes to the report repository then shares the batch's editor visit.
export const BATCHABLE_TOOLS: Record<string, BatchableTool> = {
  add_chart: { schema: schemas.addChartSchema, run: handleAddChart },
  add_text: { schema: schemas.addTextSchema, run: handleAddText },
  add_shape: { schema: schemas.addShapeSchema, run: handleAddShape },
  add_control: { schema: schemas.addControlSchema, run: handleAddControl },
  add_image: { schema: schemas.addImageSchema, run: handleAddImage },
  add_line: { schema: schemas.addLineSchema, run: handleAddLine },
  add_embed: { schema: schemas.addEmbedSchema, run: handleAddEmbed },
  update_component: { schema: schemas.updateComponentSchema, run: handleUpdateComponent },
  duplicate_component: { schema: schemas.duplicateComponentSchema, run: handleDuplicateComponent },
  arrange_components: { schema: schemas.arrangeComponentsSchema, run: handleArrangeComponents },
  delete_component: { schema: schemas.deleteComponentSchema, run: handleDeleteComponent },
  set_theme: { schema: schemas.setThemeSchema, run: handleSetTheme },
  add_calculated_field: { schema: schemas.addCalculatedFieldSchema, run: handleAddCalculatedField },
  add_parameter: { schema: schemas.addParameterSchema, run: handleAddParameter },
  add_group_field: { schema: schemas.addGroupFieldSchema, run: handleAddGroupField },
  add_bin_field: { schema: schemas.addBinFieldSchema, run: handleAddBinField },
  create_blend: { schema: schemas.createBlendSchema, run: handleCreateBlend },
  add_data_source: { schema: schemas.addDataSourceSchema, run: handleAddDataSource },
  refresh_data_source: { schema: schemas.refreshDataSourceSchema, run: handleRefreshDataSource },
  manage_filter: { schema: schemas.manageFilterSchema, run: handleManageFilter },
  set_page_settings: { schema: schemas.setPageSettingsSchema, run: handleSetPageSettings },
  add_page: { schema: schemas.addPageSchema, run: handleAddPage },
  rename_page: { schema: schemas.renamePageSchema, run: handleRenamePage },
  manage_page: { schema: schemas.managePageSchema, run: handleManagePage },
  rename_report: { schema: schemas.renameReportSchema, run: handleRenameReport },
  list_components: { schema: schemas.listComponentsSchema, run: handleListComponents },
  describe_component: { schema: schemas.describeComponentSchema, run: handleDescribeComponent },
  list_report_pages: { schema: schemas.listReportPagesSchema, run: handleListReportPages },
};

export interface BatchAction {
  tool: string;
  args: Record<string, unknown>;
}

export interface ActionResult {
  tool: string;
  status: 'ok' | 'error' | 'skipped';
  text: string;
  ms: number;
}

export class InvalidActionsError extends DomainError {
  readonly code = 'INVALID_ACTIONS';
  readonly userMessage: string;

  constructor(problems: string[]) {
    super(problems.join('\n'));
    this.userMessage = `Nothing was run; fix these actions first:\n${problems.join('\n')}`;
  }
}

// Thrown by the probe repository: the tool reached the browser step, so its input is valid.
const REACHED = Symbol('reached the repository');

const probeRepo = new Proxy({} as ReportRepository, {
  get: () => () => Promise.reject(REACHED),
});

// The batch is audited once, as apply_actions; its actions are not audited again.
const quietAudit = { recordWriteAttempt: () => undefined } as unknown as AuditLogger;
const openGate = { allowsWrites: true, isDryRun: false } as WritesGate;

function describeError(err: unknown): string {
  if (err instanceof ZodError)
    return err.issues
      .map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`)
      .join('; ');
  return errorMessage(err);
}

function withReport(reportId: string, action: BatchAction): Record<string, unknown> {
  return { ...action.args, report_id: reportId };
}

// Checks every action, with its tool's schema and the use case rules, before
// the browser opens: the tools run against a repository that stops them at
// their first editor step.
export async function checkActions(
  deps: BatchDeps,
  reportId: string,
  actions: BatchAction[],
): Promise<void> {
  const problems: string[] = [];
  const probe: BatchDeps = {
    ...deps,
    reportRepo: probeRepo,
    writesGate: openGate,
    auditLogger: quietAudit,
  };
  for (const [i, action] of actions.entries()) {
    const at = `${i + 1}. ${action.tool}`;
    const tool = BATCHABLE_TOOLS[action.tool];
    if (!tool) {
      problems.push(
        `${at}: not a tool apply_actions runs (it runs ${Object.keys(BATCHABLE_TOOLS).join(', ')})`,
      );
      continue;
    }
    const given = action.args['report_id'];
    if (given !== undefined && given !== reportId) {
      problems.push(`${at}: every action edits the batch's report; drop its report_id`);
      continue;
    }
    try {
      await tool.run(probe, withReport(reportId, action));
    } catch (err) {
      if (err !== REACHED) problems.push(`${at}: ${describeError(err)}`);
    }
  }
  if (problems.length) throw new InvalidActionsError(problems);
}

function resultText(result: ToolResult): string {
  return result.content
    .flatMap((c) => (c.type === 'text' ? [c.text] : []))
    .join('\n')
    .replace(/^Error: /, '');
}

// Runs the actions in order. Call it inside inOneVisit so they share one editor visit.
export async function runActions(
  deps: BatchDeps,
  reportId: string,
  actions: BatchAction[],
  continueOnError: boolean,
): Promise<ActionResult[]> {
  const inner: BatchDeps = { ...deps, auditLogger: quietAudit };
  const results: ActionResult[] = [];
  let failed = false;
  for (const action of actions) {
    if (failed && !continueOnError) {
      results.push({ tool: action.tool, status: 'skipped', text: '', ms: 0 });
      continue;
    }
    const started = Date.now();
    try {
      const result = await BATCHABLE_TOOLS[action.tool]!.run(inner, withReport(reportId, action));
      const status = result.isError ? 'error' : 'ok';
      results.push({
        tool: action.tool,
        status,
        text: resultText(result),
        ms: Date.now() - started,
      });
    } catch (err) {
      results.push({
        tool: action.tool,
        status: 'error',
        text: describeError(err),
        ms: Date.now() - started,
      });
    }
    failed ||= results.at(-1)!.status === 'error';
  }
  return results;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function formatResults(results: ActionResult[], totalMs: number): string {
  const ok = results.filter((r) => r.status === 'ok').length;
  const lines = [
    `${ok} of ${results.length} actions done in one editor visit (${seconds(totalMs)}).`,
  ];
  for (const [i, r] of results.entries()) {
    const head = `${i + 1}. ${r.tool}: ${r.status}`;
    if (r.status === 'skipped') lines.push(`${head} (after an error)`);
    else
      lines.push(
        `${head} (${seconds(r.ms)})${r.text ? `\n   ${r.text.replace(/\n/g, '\n   ')}` : ''}`,
      );
  }
  return lines.join('\n');
}
