import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

import {
  LOOKER_STUDIO_HOME,
  PlaywrightBrowserSession,
} from '@/contexts/authentication/infrastructure/PlaywrightBrowserSession.js';

import { readConfig, resolveProfileDir } from './shared.js';

export interface LoginOptions {
  config?: string;
  chromePath?: string;
}

const CHROME_PATHS: Record<string, string[]> = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'],
  win32: [
    `${process.env['PROGRAMFILES'] ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['LOCALAPPDATA'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
};

function findChrome(explicit?: string): string {
  const candidates = explicit ? [explicit] : (CHROME_PATHS[process.platform] ?? []);
  const found = candidates.find((path) => existsSync(path));
  if (!found)
    throw new Error('Google Chrome was not found. Pass --chrome-path <path to the Chrome binary>.');
  return found;
}

// Google refuses to sign in inside a browser driven by Playwright, so the
// sign-in happens in a plain Chrome window on the MCP's own profile. The
// report tools later reuse that profile's cookies.
export async function runLogin(opts: LoginOptions): Promise<void> {
  const config = readConfig(opts.config);
  const profileDir = resolveProfileDir(config);
  mkdirSync(profileDir, { recursive: true });

  process.stderr.write(
    'Sign in with your Google account in the Chrome window, open Looker Studio, then close the window.\n',
  );
  await new Promise<void>((resolve, reject) => {
    const chrome = spawn(
      findChrome(opts.chromePath),
      [
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        LOOKER_STUDIO_HOME,
      ],
      { stdio: 'ignore' },
    );
    chrome.on('error', reject);
    chrome.on('exit', () => resolve());
  });

  const session = new PlaywrightBrowserSession({
    profileDir,
    channel: config.auth.browser_channel,
    headless: true,
  });
  try {
    if (!(await session.isSignedIn())) {
      throw new Error(
        'Still not signed in. Run `looker-studio-mcp login` again and finish the Google sign-in.',
      );
    }
    process.stderr.write('Signed in. The Looker Studio report tools can use this profile now.\n');
  } finally {
    await session.close();
  }
}
