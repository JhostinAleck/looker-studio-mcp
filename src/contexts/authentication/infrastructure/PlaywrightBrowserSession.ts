import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

import type * as Playwright from 'playwright';
import type { BrowserContext, Page } from 'playwright';

import type { BrowserSession } from '@/contexts/authentication/domain/BrowserSession.js';
import { NotSignedInError } from '@/contexts/authentication/domain/errors.js';

export interface PlaywrightBrowserSessionOptions {
  profileDir: string;
  channel: 'chrome' | 'chromium' | 'msedge';
  headless: boolean;
}

export const LOOKER_STUDIO_HOME = 'https://lookerstudio.google.com/navigation/reporting';

// Looker Studio still answers on its old Data Studio host for some accounts.
export function isLookerStudioUrl(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === 'lookerstudio.google.com' || hostname === 'datastudio.google.com';
}

function loadPlaywright(): typeof Playwright {
  try {
    // createRequire keeps playwright an optional CJS dependency.
    return createRequire(import.meta.url)('playwright') as typeof Playwright;
  } catch (err) {
    throw new Error(
      'Playwright is not installed. Run "npm install playwright" to use the Looker Studio report tools.',
      { cause: err },
    );
  }
}

// Reuses one persistent Chrome profile, so the Google sign-in done once with
// `looker-studio-mcp login` keeps working across server restarts.
export class PlaywrightBrowserSession implements BrowserSession<Page> {
  private context: Promise<BrowserContext> | null = null;
  private headless: boolean;

  constructor(private readonly opts: PlaywrightBrowserSessionOptions) {
    this.headless = opts.headless;
  }

  // The profile allows one browser at a time: switching between headless and
  // visible relaunches it.
  private async open(visible = false): Promise<BrowserContext> {
    const headless = visible ? false : this.opts.headless;
    if (this.context && headless !== this.headless) await this.close();
    this.headless = headless;
    if (!this.context) {
      mkdirSync(this.opts.profileDir, { recursive: true });
      const { chromium } = loadPlaywright();
      this.context = chromium
        .launchPersistentContext(this.opts.profileDir, {
          ...(this.opts.channel === 'chromium' ? {} : { channel: this.opts.channel }),
          headless,
          // Chrome rejects Playwright's viewport emulation on a real profile; size the window instead.
          viewport: null,
          // --enable-automation makes Google treat the window as a bot. The mock
          // keychain and basic password store would hide the cookies that the
          // sign-in saved with the real macOS keychain.
          ignoreDefaultArgs: [
            '--enable-automation',
            '--use-mock-keychain',
            '--password-store=basic',
          ],
          args: [
            '--disable-blink-features=AutomationControlled',
            '--window-size=1600,1000',
            '--lang=en-US',
          ],
        })
        .catch((err: unknown) => {
          this.context = null;
          throw err;
        });
    }
    return this.context;
  }

  async withPage<T>(
    work: (page: Page) => Promise<T>,
    opts: { visible?: boolean } = {},
  ): Promise<T> {
    const context = await this.open(opts.visible);
    const page = await context.newPage();
    try {
      return await work(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async isSignedIn(): Promise<boolean> {
    return this.withPage(async (page) => {
      await page.goto(LOOKER_STUDIO_HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      return isLookerStudioUrl(page.url());
    });
  }

  async requireSignedIn(): Promise<void> {
    if (!(await this.isSignedIn())) throw new NotSignedInError();
  }

  async close(): Promise<void> {
    const context = this.context;
    this.context = null;
    if (context) await (await context).close().catch(() => undefined);
  }
}
