import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { stringify } from 'yaml';

import { atomicWrite } from '@/shared-kernel/fs/atomicWrite.js';
import { Paths } from '@/shared-kernel/config/paths.js';
import { ConfigSchema } from '@/shared-kernel/config/schema.js';
import { expandPath } from '@/shared-kernel/path/expandPath.js';

export interface InitOptions {
  project: string;
  location?: string;
  credentialsFile?: string;
  enableWrites?: boolean;
  config?: string;
  force?: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const file = expandPath(opts.config ?? Paths.configYaml());
  if (existsSync(file) && !opts.force) {
    throw new Error(`${file} already exists. Use --force to overwrite it.`);
  }
  const config = ConfigSchema.parse({
    project_id: opts.project,
    location: opts.location ?? 'US',
    auth: opts.credentialsFile
      ? { credentials: 'file', credentials_file: opts.credentialsFile }
      : { credentials: 'adc' },
    writes: { enabled: opts.enableWrites ?? false },
  });
  mkdirSync(dirname(file), { recursive: true });
  await atomicWrite(file, stringify(config), { mode: 0o600 });
  process.stdout.write(`Wrote ${file}\n`);
}
