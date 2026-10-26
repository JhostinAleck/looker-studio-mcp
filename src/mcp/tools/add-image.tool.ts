import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { addImage } from '@/contexts/reports/application/reportUseCases.js';
import { addImageSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { placedMessage, toLayout } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

// A data: URI (as export_report_spec embeds small images) becomes a temp file to upload.
function localCopy(image: string): string {
  const data = /^data:(image\/[\w+.-]+);base64,(.*)$/s.exec(image);
  if (!data) return image;
  const ext = EXTENSION[data[1]!.toLowerCase()];
  if (!ext) throw new Error(`Images of type ${data[1]} cannot be uploaded.`);
  const path = join(mkdtempSync(join(tmpdir(), 'looker-image-')), `image.${ext}`);
  writeFileSync(path, Buffer.from(data[2]!, 'base64'));
  return path;
}

export async function handleAddImage(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addImageSchema.parse(raw);
  const byUrl = /^https:\/\//i.test(input.image);
  const what = `the image ${input.image.startsWith('data:') ? '(embedded)' : basename(input.image)}`;
  return runWrite(deps, 'add_image', { ...input }, `add ${what}`, async () => {
    const path = byUrl ? input.image : localCopy(input.image);
    const placed = await addImage(
      deps.reportRepo,
      input.report_id,
      {
        path,
        ...(byUrl ? { byUrl: true } : {}),
        ...(input.alt_text ? { altText: input.alt_text } : {}),
      },
      {
        ...(input.layout ? { layout: toLayout(input.layout) } : {}),
        ...(input.style ? { style: input.style } : {}),
        ...(input.page ? { page: input.page } : {}),
      },
      (file) => statSync(file, { throwIfNoEntry: false })?.size ?? null,
    );
    return text(placedMessage(what, placed));
  });
}
