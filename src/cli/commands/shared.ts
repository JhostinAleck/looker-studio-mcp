import { existsSync, readFileSync } from 'node:fs';

import { loadConfig } from '@/shared-kernel/config/loader.js';
import { Paths } from '@/shared-kernel/config/paths.js';
import type { Config } from '@/shared-kernel/config/schema.js';
import { expandPath } from '@/shared-kernel/path/expandPath.js';

export function readConfig(path?: string, cliOverrides?: Record<string, unknown>): Config {
  const file = expandPath(path ?? process.env.LOOKER_STUDIO_MCP_CONFIG ?? Paths.configYaml());
  const fileContent = existsSync(file) ? readFileSync(file, 'utf8') : null;
  return loadConfig({ fileContent, env: process.env, ...(cliOverrides ? { cliOverrides } : {}) });
}

export function resolveProfileDir(config: Config): string {
  return expandPath(config.auth.browser_profile_dir ?? Paths.browserProfileDir());
}

export function resolveCredentialsFile(config: Config): string | undefined {
  return config.auth.credentials === 'file' && config.auth.credentials_file
    ? expandPath(config.auth.credentials_file)
    : undefined;
}
