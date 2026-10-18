import { GoogleAuthTokenProvider } from '@/contexts/authentication/infrastructure/GoogleAuthTokenProvider.js';
import { PlaywrightBrowserSession } from '@/contexts/authentication/infrastructure/PlaywrightBrowserSession.js';

import { readConfig, resolveCredentialsFile, resolveProfileDir } from './shared.js';

export interface AuthTestOptions {
  config?: string;
}

export async function runAuthTest(opts: AuthTestOptions): Promise<void> {
  const config = readConfig(opts.config);
  const keyFile = resolveCredentialsFile(config);
  const tokens = new GoogleAuthTokenProvider(keyFile ? { keyFile } : {});

  let ok = true;
  try {
    await tokens.getAccessToken();
    const who = await tokens.describeIdentity();
    process.stdout.write(`✔ Google APIs: token OK${who ? ` (${who})` : ''}\n`);
  } catch (err) {
    ok = false;
    process.stdout.write(`✘ Google APIs: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  const session = new PlaywrightBrowserSession({
    profileDir: resolveProfileDir(config),
    channel: config.auth.browser_channel,
    headless: true,
  });
  try {
    if (await session.isSignedIn()) {
      process.stdout.write('✔ Looker Studio: browser profile signed in\n');
    } else {
      ok = false;
      process.stdout.write('✘ Looker Studio: not signed in. Run `looker-studio-mcp login`.\n');
    }
  } catch (err) {
    ok = false;
    process.stdout.write(`✘ Looker Studio: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    await session.close();
  }

  if (!config.project_id) {
    process.stdout.write('! No project_id in config: pass project_id to the BigQuery tools.\n');
  }
  if (!ok) process.exitCode = 1;
}
