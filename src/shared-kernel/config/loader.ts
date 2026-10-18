import { parse as parseYaml } from 'yaml';
import type { Config } from './schema.js';
import { ConfigSchema } from './schema.js';

export interface LoadConfigInput {
  fileContent: string | null;
  env: Record<string, string | undefined>;
  cliOverrides?: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isObject(value) && isObject(current) ? deepMerge(current, value) : value;
  }
  return out;
}

// Environment variables win over the YAML file; CLI flags win over both.
function fromEnv(env: Record<string, string | undefined>): Record<string, unknown> {
  const auth: Record<string, unknown> = {};
  if (env.LOOKER_STUDIO_MCP_CREDENTIALS_FILE) {
    auth.credentials = 'file';
    auth.credentials_file = env.LOOKER_STUDIO_MCP_CREDENTIALS_FILE;
  }
  if (env.LOOKER_STUDIO_MCP_HEADLESS) auth.headless = env.LOOKER_STUDIO_MCP_HEADLESS !== 'false';
  return {
    ...(env.LOOKER_STUDIO_MCP_PROJECT ? { project_id: env.LOOKER_STUDIO_MCP_PROJECT } : {}),
    ...(Object.keys(auth).length > 0 ? { auth } : {}),
  };
}

export function loadConfig(input: LoadConfigInput): Config {
  const parsed: unknown = input.fileContent ? parseYaml(input.fileContent) : {};
  const fromFile = isObject(parsed) ? parsed : {};
  const merged = deepMerge(deepMerge(fromFile, fromEnv(input.env)), input.cliOverrides ?? {});
  return ConfigSchema.parse(merged);
}
