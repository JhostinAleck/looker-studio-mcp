import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { addImage } from '@/contexts/reports/application/reportUseCases.js';
import { addImageSchema } from '@/mcp/schemas.js';
import { runWrite, text, type ToolResult, type WriteDeps } from '@/mcp/tool-helpers.js';

import { placedMessage, toLayout } from './component-format.js';
import type { ReportToolDeps } from './reports-deps.js';

// The editor only uploads files: an https image is downloaded to a temp folder first.
async function localCopy(image: string): Promise<string> {
  if (!/^https:\/\//i.test(image)) return image;
  const res = await fetch(image);
  if (!res.ok) throw new Error(`Could not download ${image}: HTTP ${res.status}`);
  const name = basename(new URL(image).pathname) || 'image.png';
  const path = join(mkdtempSync(join(tmpdir(), 'looker-image-')), name);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

export async function handleAddImage(
  deps: ReportToolDeps & WriteDeps,
  raw: unknown,
): Promise<ToolResult> {
  const input = addImageSchema.parse(raw);
  const what = `the image ${basename(input.image)}`;
  return runWrite(deps, 'add_image', { ...input }, `add ${what}`, async () => {
    const path = await localCopy(input.image);
    const placed = await addImage(
      deps.reportRepo,
      input.report_id,
      { path, ...(input.alt_text ? { altText: input.alt_text } : {}) },
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
