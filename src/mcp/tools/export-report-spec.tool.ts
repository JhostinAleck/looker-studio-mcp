import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { readReport } from '@/contexts/reports/application/reportUseCases.js';
import { type ImageSink, snapshotToSpec } from '@/mcp/report-spec.js';
import { exportReportSpecSchema } from '@/mcp/schemas.js';
import { text, type ToolResult } from '@/mcp/tool-helpers.js';
import { expandPath } from '@/shared-kernel/path/expandPath.js';

import type { ReportToolDeps } from './reports-deps.js';

// Images embedded as data: URIs when no `path` is given (base64 characters).
const MAX_INLINE_IMAGE = 512 * 1024;

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

export async function handleExportReportSpec(
  deps: ReportToolDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = exportReportSpecSchema.parse(raw);
  const snapshot = await readReport(deps.reportRepo, input.report_id, input.style);
  const files: Array<{ path: string; data: Buffer }> = [];
  const target = input.path ? resolve(expandPath(input.path)) : undefined;
  // Uploaded images go next to the spec file, referenced relative to it.
  const sink: ImageSink = target
    ? (file, where) => {
        const folder = `${basename(target).replace(/\.json$/i, '')}-images`;
        const ext = EXTENSION[file.type] ?? 'png';
        const name = `page${where.page}-${where.index}.${ext}`;
        files.push({
          path: join(dirname(target), folder, name),
          data: Buffer.from(file.base64, 'base64'),
        });
        return { image: `${folder}/${name}` };
      }
    : (file) =>
        file.base64.length <= MAX_INLINE_IMAGE
          ? { image: `data:${file.type};base64,${file.base64}` }
          : {
              skipped: `${Math.round((file.base64.length * 3) / 4 / 1024)} KB: pass path to save it as a file`,
            };
  const spec = snapshotToSpec(snapshot, sink);
  const skipped = spec.pages.flatMap((p) =>
    (p.components ?? []).filter((c) => c.component === 'other'),
  );
  const json = JSON.stringify(spec, null, 2);
  const lines: string[] = [];
  if (target) {
    mkdirSync(dirname(target), { recursive: true });
    for (const f of files) {
      mkdirSync(dirname(f.path), { recursive: true });
      writeFileSync(f.path, f.data);
    }
    writeFileSync(target, `${json}\n`);
    lines.push(
      `Wrote the spec to ${target}${files.length ? ` and ${files.length} image file(s) next to it` : ''}; apply_report_spec takes it as \`spec_path\`.`,
    );
  }
  lines.push(
    'Report spec (apply_report_spec takes it as `spec`; docs/report-spec.md describes it):',
    '```json',
    json,
    '```',
  );
  if (skipped.length)
    lines.push(
      `${skipped.length} component(s) are kept as "other" and would be skipped by apply_report_spec.`,
    );
  for (const note of snapshot.notes ?? []) lines.push(`Note: ${note}`);
  return text(lines.join('\n'));
}
