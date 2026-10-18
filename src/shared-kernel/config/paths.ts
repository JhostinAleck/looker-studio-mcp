import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT_DIR_NAME = '.looker-studio-mcp';

function root(): string {
  return join(homedir(), ROOT_DIR_NAME);
}

export const Paths = {
  rootDir: root,
  configYaml: (): string => join(root(), 'config.yaml'),
  browserProfileDir: (): string => join(root(), 'browser-profile'),
  credentialsJson: (): string => join(root(), 'credentials.json'),
  auditLog: (): string => join(root(), 'audit.ndjson'),
  screenshotsDir: (): string => join(root(), 'screenshots'),
} as const;
