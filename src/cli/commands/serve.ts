import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDependencies } from '@/composition-root.js';
import { startServer } from '@/mcp/server.js';

import { readConfig } from './shared.js';

export interface ServeOptions {
  config?: string;
  project?: string;
  enableWrites?: boolean;
  headed?: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runServe(opts: ServeOptions): Promise<void> {
  const config = readConfig(opts.config, opts.project ? { project_id: opts.project } : undefined);
  const deps = buildDependencies({
    config,
    enableWritesFlag: opts.enableWrites ?? false,
    ...(opts.headed ? { headed: true } : {}),
  });
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
  ) as {
    version: string;
  };
  await startServer({ ...deps, version: pkg.version });

  const shutdown = async (): Promise<void> => {
    await deps.dispose();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.stdin.on('close', () => void shutdown());
}
