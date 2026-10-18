import { describe, expect, it } from 'vitest';

import { loadConfig } from '@/shared-kernel/config/loader.js';

describe('loadConfig', () => {
  it('fills defaults when there is no file', () => {
    const c = loadConfig({ fileContent: null, env: {} });
    expect(c).toMatchObject({
      location: 'US',
      auth: { credentials: 'adc', browser_channel: 'chrome', headless: true },
      writes: { enabled: false },
      query: { max_rows: 500 },
    });
  });

  it('lets env override the file and CLI override both', () => {
    const c = loadConfig({
      fileContent: 'project_id: from-file\nauth:\n  headless: true\n',
      env: { LOOKER_STUDIO_MCP_PROJECT: 'from-env', LOOKER_STUDIO_MCP_HEADLESS: 'false' },
      cliOverrides: { project_id: 'from-cli' },
    });
    expect(c.project_id).toBe('from-cli');
    expect(c.auth.headless).toBe(false);
  });

  it('requires a credentials file for credentials=file', () => {
    expect(() => loadConfig({ fileContent: 'auth:\n  credentials: file\n', env: {} })).toThrow(
      /credentials_file is required/,
    );
  });
});
